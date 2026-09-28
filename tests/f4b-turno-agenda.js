// tests/f4b-turno-agenda.js - Suite F4-B: endurecer flujo turno -> agenda.
// Uso: node tests/f4b-turno-agenda.js
// Verifica que ningun turno llegue a en_progreso sin bloque valido en
// agenda_bloques (reservado/en_progreso), que el legacy no auto-promueva,
// y que estado_pago permanezca intacto. Incluye regresiones F2/F3A/F3B.
// Fixtures con telefono prefijo F4BTEST y cleanup estricto. No toca datos
// reales (usuarios/tecnicos/cuadrillas/servicios). No imprime secretos.
require('dotenv').config();

const assert = require('assert');
const jwt = require('jsonwebtoken');
const { execFileSync } = require('child_process');
const path = require('path');

const db = require('../config/db');
const TurnoModel = require('../models/turnoModel');
const ServiceModel = require('../models/serviceModel');
const AgendaModel = require('../models/agendaModel');
const CuadrillaModel = require('../models/cuadrillaModel');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('Falta JWT_SECRET para firmar tokens de prueba.');
}

let pasados = 0;
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};

const fechaFutura = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

const firmar = (usuariosId, rol) => jwt.sign(
    { usuariosId, rol },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'serviceVT', audience: 'serviceVT-client' }
);

const estadoDe = async (turnosId) => {
    const [rows] = await db.query(
        `SELECT estado_pago, estado_turno FROM turnos WHERE turnos_id = ?`,
        [turnosId]
    );
    return rows[0];
};

const bloqueDe = async (turnosId) => {
    const [rows] = await db.query(
        `SELECT bloque_id, estado FROM agenda_bloques WHERE turnos_id = ? ORDER BY bloque_id DESC`,
        [turnosId]
    );
    return rows;
};

(async () => {
    const fixtures = { usuarios: [], turnos: [] };
    let servidor = null;

    const crearUsuarioTest = async (sufijo) => {
        const telefono = `F4BTEST${Date.now()}${sufijo}`.slice(0, 20);
        const [r] = await db.query(
            `INSERT INTO usuarios (telefono, rol) VALUES (?, 'cliente')`,
            [telefono]
        );
        fixtures.usuarios.push(r.insertId);
        return r.insertId;
    };

    // Inserta directo un turno en_lista_espera/aprobado SIN bloque (simula
    // dato legacy anterior a F4-B). No pasa por TurnoModel.crear (bloqueado).
    const insertarEnListaEsperaSinBloque = async (usuariosId, serviciosId) => {
        const [r] = await db.query(
            `INSERT INTO turnos (usuarios_id, servicios_id, metodo_pago, estado_pago, estado_turno)
             VALUES (?, ?, 'mercado_pago', 'aprobado', 'en_lista_espera')`,
            [usuariosId, serviciosId]
        );
        fixtures.turnos.push(r.insertId);
        return r.insertId;
    };

    const insertarEnProgresoSinBloque = async (usuariosId, serviciosId) => {
        const [r] = await db.query(
            `INSERT INTO turnos (usuarios_id, servicios_id, metodo_pago, estado_pago, estado_turno)
             VALUES (?, ?, 'efectivo_whatsapp', 'efectivo_en_destino', 'en_progreso')`,
            [usuariosId, serviciosId]
        );
        fixtures.turnos.push(r.insertId);
        return r.insertId;
    };

    try {
        const [baseTurnos] = await db.query(`SELECT COUNT(*) AS n FROM turnos`);
        const [baseBloques] = await db.query(`SELECT COUNT(*) AS n FROM agenda_bloques`);
        const [baseHist] = await db.query(`SELECT COUNT(*) AS n FROM turno_historial`);

        const serviceVT = await CuadrillaModel.buscarServiceVT();
        assert.ok(serviceVT && serviceVT.activa, 'cuadrilla ServiceVT activa');

        const servicios = await ServiceModel.getAll();
        assert.ok(servicios.length > 0, 'hay servicios');
        const serviciosId = servicios[0].servicios_id;

        const [admins] = await db.query(`SELECT usuarios_id FROM usuarios WHERE rol = 'admin' LIMIT 1`);
        assert.ok(admins.length > 0, 'hay admin');
        const adminId = admins[0].usuarios_id;
        const tokenAdmin = firmar(adminId, 'admin');

        const clienteId = await crearUsuarioTest('C');

        const app = require('../app');
        servidor = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const post = (urlPath, token, body) => fetch(`${base}${urlPath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(body)
        });

        // TEST 1: crear con en_progreso debe ser rechazado/controlado.
        await assert.rejects(
            TurnoModel.crear(clienteId, serviciosId, 'efectivo_whatsapp', 'efectivo_en_destino', 'en_progreso'),
            (e) => e && e.code === 'ESTADO_TURNO_NO_PERMITIDO',
            'crear en_progreso rechazado'
        );
        await assert.rejects(
            TurnoModel.crear(clienteId, serviciosId, 'mercado_pago', 'aprobado', 'en_lista_espera'),
            (e) => e && e.code === 'ESTADO_TURNO_NO_PERMITIDO',
            'crear en_lista_espera rechazado'
        );
        ok('t1-crear-en-progreso-rechazado');

        // TEST 2: crear con pendiente_programacion funciona.
        const rOk = await TurnoModel.crear(clienteId, serviciosId, 'efectivo_whatsapp', 'efectivo_en_destino', 'pendiente_programacion');
        assert.ok(rOk.insertId > 0, 'turno creado');
        fixtures.turnos.push(rOk.insertId);
        const turnoProg = rOk.insertId;
        assert.strictEqual((await estadoDe(turnoProg)).estado_turno, 'pendiente_programacion');
        ok('t2-crear-pendiente-programacion-ok');

        // TEST 3: programar estado no permitido -> error controlado.
        const rPend = await TurnoModel.crearPendientePago(clienteId, serviciosId);
        fixtures.turnos.push(rPend.insertId);
        await assert.rejects(
            AgendaModel.programar(rPend.insertId, serviceVT.cuadrilla_id, fechaFutura(21), '10:00', '12:00', adminId),
            (e) => e && e.code === 'TURNO_NO_PROGRAMABLE',
            'pendiente_pago no programable'
        );
        const turnoEspera = await insertarEnListaEsperaSinBloque(clienteId, serviciosId);
        await assert.rejects(
            AgendaModel.programar(turnoEspera, serviceVT.cuadrilla_id, fechaFutura(21), '13:00', '15:00', adminId),
            (e) => e && e.code === 'TURNO_NO_PROGRAMABLE',
            'en_lista_espera no programable'
        );
        ok('t3-programar-estado-no-permitido-409');

        // TEST 4: pendiente_programacion puede programarse.
        const fecha46 = fechaFutura(22);
        const prog = await AgendaModel.programar(turnoProg, serviceVT.cuadrilla_id, fecha46, '14:00', '17:00', adminId);
        assert.ok(prog.bloqueId > 0, 'bloque reservado');
        assert.strictEqual((await estadoDe(turnoProg)).estado_turno, 'programado');
        ok('t4-pendiente-programacion-programable');

        // TEST 5: programado puede iniciarse (INVARIANTE B).
        await AgendaModel.iniciar(turnoProg, adminId);
        assert.strictEqual((await estadoDe(turnoProg)).estado_turno, 'en_progreso');
        const [bProg] = await db.query(`SELECT estado FROM agenda_bloques WHERE bloque_id = ?`, [prog.bloqueId]);
        assert.strictEqual(bProg[0].estado, 'en_progreso');
        ok('t5-programado-inicia');

        // TEST 6: iniciado puede finalizarse (INVARIANTE C).
        const pagoAntesT6 = (await estadoDe(turnoProg)).estado_pago;
        const fin6 = await AgendaModel.finalizar(turnoProg, adminId);
        assert.strictEqual(fin6.yaFinalizado, false);
        assert.strictEqual((await estadoDe(turnoProg)).estado_turno, 'finalizado');
        assert.strictEqual((await estadoDe(turnoProg)).estado_pago, pagoAntesT6, 'pago intacto');
        ok('t6-iniciado-finaliza');

        // TEST 7: activarTurnoPendiente sin bloque -> rechazado, intacto.
        const turnoSinBloque = await insertarEnListaEsperaSinBloque(clienteId, serviciosId);
        const estAntes7 = await estadoDe(turnoSinBloque);
        await assert.rejects(
            TurnoModel.activarTurnoPendiente(turnoSinBloque),
            (e) => e && e.code === 'SIN_BLOQUE_AGENDA',
            'sin bloque rechazado'
        );
        assert.deepStrictEqual(await estadoDe(turnoSinBloque), estAntes7, 'turno intacto');
        ok('t7-activar-sin-bloque-rechazado');

        // TEST 8a: finalizar-trabajo sobre turno en_lista_espera sin agenda -> 409 intacto.
        const estAntes8a = await estadoDe(turnoSinBloque);
        const r8a = await post('/api/pagos/finalizar-trabajo', tokenAdmin, { turnoId: turnoSinBloque });
        assert.strictEqual(r8a.status, 409, 'sin agenda 409');
        assert.deepStrictEqual(await estadoDe(turnoSinBloque), estAntes8a, 'sin cambios');
        // TEST 8b: finalizar legacy en_progreso sin agenda NO promueve al siguiente.
        const turnoLegFin = await insertarEnProgresoSinBloque(clienteId, serviciosId);
        const siguienteEspera = await insertarEnListaEsperaSinBloque(clienteId, serviciosId);
        const r8b = await post('/api/pagos/finalizar-trabajo', tokenAdmin, { turnoId: turnoLegFin });
        assert.strictEqual(r8b.status, 200, 'legacy sin agenda sigue 200');
        const d8b = await r8b.json();
        assert.strictEqual(d8b.siguienteTurno, null, 'sin auto-promocion');
        assert.strictEqual((await estadoDe(turnoLegFin)).estado_turno, 'finalizado', 'solicitado finaliza');
        assert.strictEqual((await estadoDe(siguienteEspera)).estado_turno, 'en_lista_espera', 'siguiente NO promovido');
        assert.strictEqual((await estadoDe(siguienteEspera)).estado_pago, 'aprobado', 'pago siguiente intacto');
        ok('t8-finalizar-trabajo-no-autopromueve');

        // TEST 9/10/11: ciclo completo con agenda + bloque liberado + pago intacto.
        const rCiclo = await TurnoModel.crear(clienteId, serviciosId, 'efectivo_whatsapp', 'efectivo_en_destino', 'pendiente_programacion');
        fixtures.turnos.push(rCiclo.insertId);
        const turnoCiclo = rCiclo.insertId;
        const pagoCicloAntes = (await estadoDe(turnoCiclo)).estado_pago;
        const fechaC = fechaFutura(23);
        const progC = await AgendaModel.programar(turnoCiclo, serviceVT.cuadrilla_id, fechaC, '09:00', '11:00', adminId);
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_turno, 'programado');
        await AgendaModel.iniciar(turnoCiclo, adminId);
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_turno, 'en_progreso');
        const finC = await AgendaModel.finalizar(turnoCiclo, adminId);
        assert.strictEqual(finC.yaFinalizado, false);
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_turno, 'finalizado');
        ok('t9-ciclo-programado-enprogreso-finalizado');
        const [bC] = await db.query(`SELECT estado FROM agenda_bloques WHERE bloque_id = ?`, [progC.bloqueId]);
        assert.strictEqual(bC[0].estado, 'liberado', 'bloque liberado');
        ok('t10-bloque-liberado');
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_pago, pagoCicloAntes, 'pago intacto');
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_pago, 'efectivo_en_destino');
        ok('t11-estado-pago-intacto');

        // TEST 12: doble finalizar idempotente.
        const finDoble = await AgendaModel.finalizar(turnoCiclo, adminId);
        assert.strictEqual(finDoble.yaFinalizado, true, 'idempotente');
        assert.strictEqual((await estadoDe(turnoCiclo)).estado_turno, 'finalizado');
        ok('t12-doble-finalizar-idempotente');

        // TEST 13/14/15: regresiones como subprocesos.
        const correrSuite = (archivo, marcador) => {
            const salida = execFileSync('node', [path.join(__dirname, archivo)], {
                encoding: 'utf8',
                timeout: 180000
            });
            assert.ok(
                salida.includes(marcador),
                `${archivo} debe contener ${marcador}. Salida: ${salida.slice(-500)}`
            );
            return salida;
        };
        correrSuite('f2-agenda.js', 'F2-TESTS-OK:19');
        ok('t13-regresion-f2-19-19');
        correrSuite('f3-turnos-pagos.js', 'F3A-TESTS-OK:8');
        ok('t14-regresion-f3a-8-8');
        correrSuite('f3b-tecnicos.js', 'F3B-TESTS-OK:4');
        ok('t15-regresion-f3b-4-4');

        console.log(`\nF4B-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF4B-TEST-FAIL:${error.message}`);
        if (error.stack) {
            console.error(error.stack.split('\n').slice(0, 4).join('\n'));
        }
        process.exitCode = 1;
    } finally {
        if (servidor) {
            await new Promise((resolve) => servidor.close(resolve));
        }

        // TEST 16: cleanup completo, cero filas de test, datos reales intactos.
        try {
            if (fixtures.turnos.length > 0) {
                const ph = fixtures.turnos.map(() => '?').join(',');
                await db.query(`DELETE FROM turno_historial WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM agenda_bloques WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM turnos WHERE turnos_id IN (${ph})`, fixtures.turnos);
            }

            if (fixtures.usuarios.length > 0) {
                const phu = fixtures.usuarios.map(() => '?').join(',');
                await db.query(`DELETE FROM usuarios WHERE usuarios_id IN (${phu})`, fixtures.usuarios);
            }

            const [rU] = await db.query(`SELECT COUNT(*) AS n FROM usuarios WHERE telefono LIKE 'F4BTEST%'`);
            const [rT] = await db.query(`SELECT COUNT(*) AS n FROM turnos t INNER JOIN usuarios u ON u.usuarios_id = t.usuarios_id WHERE u.telefono LIKE 'F4BTEST%'`);
            const [rH] = await db.query(
                `SELECT COUNT(*) AS n FROM turno_historial h LEFT JOIN turnos t ON t.turnos_id = h.turnos_id WHERE t.turnos_id IS NULL`
            );
            console.log(`F4B-CLEANUP-RESTOS-USUARIOS:${rU[0].n}`);
            console.log(`F4B-CLEANUP-RESTOS-TURNOS:${rT[0].n}`);
            console.log(`F4B-CLEANUP-HUERFANOS-HIST:${rH[0].n}`);
            assert.strictEqual(rU[0].n, 0, 'cero usuarios de test');
            assert.strictEqual(rT[0].n, 0, 'cero turnos de test');

            const [cU] = await db.query(`SELECT COUNT(*) AS n FROM usuarios`);
            const [cTec] = await db.query(`SELECT COUNT(*) AS n FROM tecnicos`);
            const [cCua] = await db.query(`SELECT COUNT(*) AS n FROM cuadrillas`);
            const [cCt] = await db.query(`SELECT COUNT(*) AS n FROM cuadrilla_tecnicos`);
            const [cS] = await db.query(`SELECT COUNT(*) AS n FROM servicios`);
            console.log(`F4B-DATOS-REALES:usuarios=${cU[0].n} tecnicos=${cTec[0].n} cuadrillas=${cCua[0].n} ct=${cCt[0].n} servicios=${cS[0].n}`);
            assert.strictEqual(cU[0].n, 10, 'usuarios reales intactos');
            assert.strictEqual(cTec[0].n, 2, 'tecnicos intactos');
            assert.strictEqual(cCua[0].n, 1, 'cuadrillas intactas');
            assert.strictEqual(cCt[0].n, 2, 'asociaciones intactas');
            assert.strictEqual(cS[0].n, 5, 'servicios intactos');
            ok('t16-cleanup-cero-restos');
            console.log(`\nF4B-TESTS-OK:${pasados}`);
        } catch (cleanupError) {
            console.error(`F4B-CLEANUP-FAIL:${cleanupError.message}`);
            process.exitCode = 1;
        }

        try { await db.end(); } catch (_) {}
    }
})();
