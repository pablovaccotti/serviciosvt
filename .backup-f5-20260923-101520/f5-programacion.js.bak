// tests/f5-programacion.js - Suite F5: panel de pendientes de programacion.
// Uso: node tests/f5-programacion.js
// Verifica GET /api/turnos/pendientes (solo lectura, admin) y su integracion
// con POST /api/turnos/programar. Incluye regresiones F2/F3A/F3B/F4B
// secuenciales (una sola cuadrilla: en paralelo colisionarian).
// Fixtures con telefono prefijo F5TEST y cleanup estricto. No toca datos
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

(async () => {
    const fixtures = { usuarios: [], turnos: [] };
    let servidor = null;

    const crearUsuarioTest = async (sufijo) => {
        const telefono = `F5TEST${Date.now()}${sufijo}`.slice(0, 20);
        const [r] = await db.query(
            `INSERT INTO usuarios (telefono, rol) VALUES (?, 'cliente')`,
            [telefono]
        );
        fixtures.usuarios.push(r.insertId);
        return { id: r.insertId, telefono };
    };

    const crearPendiente = async (usuariosId, serviciosId) => {
        const r = await TurnoModel.crear(usuariosId, serviciosId, 'efectivo_whatsapp', 'efectivo_en_destino', 'pendiente_programacion');
        fixtures.turnos.push(r.insertId);
        return r.insertId;
    };

    // Inserta directo un bloque con estado dado sobre un turno pendiente
    // (simula borde legacy; programar() cambiaria el estado del turno y no
    // serviria para probar el NOT EXISTS). Solo fixtures de prueba.
    const insertarBloqueDirecto = async (cuadrillaId, turnosId, fecha, estado) => {
        const [r] = await db.query(
            `INSERT INTO agenda_bloques (cuadrilla_id, turnos_id, fecha, hora_inicio, hora_fin, estado)
             VALUES (?, ?, ?, '10:00', '12:00', ?)`,
            [cuadrillaId, turnosId, fecha, estado]
        );
        return r.insertId;
    };

    try {
        const serviceVT = await CuadrillaModel.buscarServiceVT();
        assert.ok(serviceVT && serviceVT.activa, 'cuadrilla ServiceVT activa');

        const servicios = await ServiceModel.getAll();
        assert.ok(servicios.length > 0, 'hay servicios');
        const serviciosId = servicios[0].servicios_id;

        const [admins] = await db.query(`SELECT usuarios_id FROM usuarios WHERE rol = 'admin' LIMIT 1`);
        assert.ok(admins.length > 0, 'hay admin');
        const adminId = admins[0].usuarios_id;
        const tokenAdmin = firmar(adminId, 'admin');

        // T9: regresiones secuenciales ANTES de crear fixtures propios, porque
        // F4B verifica conteos globales (usuarios=10) y cualquier fixture F5TEST
        // vivo haria fallar su T16. Una sola cuadrilla: secuencial, nunca paralelo.
        const correrSuite = (archivo, marcador) => {
            const salida = execFileSync('node', [path.join(__dirname, archivo)], {
                encoding: 'utf8',
                timeout: 240000
            });
            assert.ok(
                salida.includes(marcador),
                `${archivo} debe contener ${marcador}. Salida: ${salida.slice(-500)}`
            );
        };
        correrSuite('f2-agenda.js', 'F2-TESTS-OK:19');
        ok('t9a-regresion-f2-19-19');
        correrSuite('f3-turnos-pagos.js', 'F3A-TESTS-OK:8');
        ok('t9b-regresion-f3a-8-8');
        correrSuite('f3b-tecnicos.js', 'F3B-TESTS-OK:4');
        ok('t9c-regresion-f3b-4-4');
        correrSuite('f4b-turno-agenda.js', 'F4B-TESTS-OK:16');
        ok('t9d-regresion-f4b-16-16');

        const cli = await crearUsuarioTest('C');
        const tokenCliente = firmar(cli.id, 'cliente');

        const app = require('../app');
        servidor = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const get = (urlPath, token) => fetch(`${base}${urlPath}`, {
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
        });
        const post = (urlPath, token, body) => fetch(`${base}${urlPath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(body)
        });
        const listaPendientes = async () => {
            const r = await get('/api/turnos/pendientes', tokenAdmin);
            assert.strictEqual(r.status, 200, 'pendientes 200 admin');
            const d = await r.json();
            assert.ok(Array.isArray(d.turnos), 'turnos es arreglo');
            return d.turnos;
        };
        const idsPendientes = async () => (await listaPendientes()).map((t) => t.turnos_id);

        // T1: autenticacion y autorizacion.
        const r401 = await get('/api/turnos/pendientes', null);
        assert.strictEqual(r401.status, 401, 'sin token 401');
        const r403 = await get('/api/turnos/pendientes', tokenCliente);
        assert.strictEqual(r403.status, 403, 'cliente 403');
        const r200 = await get('/api/turnos/pendientes', tokenAdmin);
        assert.strictEqual(r200.status, 200, 'admin 200');
        ok('t1-pendientes-auth-401-403-200');

        // T2: pendiente visible con todos los campos.
        const turnoVis = await crearPendiente(cli.id, serviciosId);
        const lista2 = await listaPendientes();
        const fila2 = lista2.find((t) => t.turnos_id === turnoVis);
        assert.ok(fila2, 'pendiente visible');
        for (const campo of ['turnos_id', 'usuarios_id', 'telefono', 'servicios_id', 'equipo', 'falla', 'precio', 'metodo_pago', 'estado_pago', 'estado_turno', 'fecha_creacion']) {
            assert.ok(fila2[campo] !== undefined && fila2[campo] !== null, `campo ${campo}`);
        }
        assert.strictEqual(fila2.estado_turno, 'pendiente_programacion', 'estado oficial');
        ok('t2-pendiente-visible');

        // T3: estados no visibles (una sola capacidad: un unico en_progreso
        // por vez; se finaliza antes del siguiente inicio).
        const tProg = await crearPendiente(cli.id, serviciosId);
        await AgendaModel.programar(tProg, serviceVT.cuadrilla_id, fechaFutura(30), '10:00', '12:00', adminId);
        const tRepr = await crearPendiente(cli.id, serviciosId);
        await AgendaModel.programar(tRepr, serviceVT.cuadrilla_id, fechaFutura(31), '10:00', '12:00', adminId);
        await AgendaModel.reprogramar(tRepr, null, fechaFutura(32), '10:00', '12:00', adminId);
        const tFin = await crearPendiente(cli.id, serviciosId);
        await AgendaModel.programar(tFin, serviceVT.cuadrilla_id, fechaFutura(34), '10:00', '12:00', adminId);
        await AgendaModel.iniciar(tFin, adminId);
        await AgendaModel.finalizar(tFin, adminId);
        const tCanc = await crearPendiente(cli.id, serviciosId);
        await AgendaModel.programar(tCanc, serviceVT.cuadrilla_id, fechaFutura(35), '10:00', '12:00', adminId);
        await AgendaModel.cancelar(tCanc, adminId, 'test f5');
        const tProg2 = await crearPendiente(cli.id, serviciosId);
        await AgendaModel.programar(tProg2, serviceVT.cuadrilla_id, fechaFutura(33), '10:00', '12:00', adminId);
        await AgendaModel.iniciar(tProg2, adminId);
        const rPp = await TurnoModel.crearPendientePago(cli.id, serviciosId);
        fixtures.turnos.push(rPp.insertId);
        const [rLe] = await db.query(
            `INSERT INTO turnos (usuarios_id, servicios_id, metodo_pago, estado_pago, estado_turno)
             VALUES (?, ?, 'mercado_pago', 'aprobado', 'en_lista_espera')`,
            [cli.id, serviciosId]
        );
        fixtures.turnos.push(rLe.insertId);
        const ids3 = await idsPendientes();
        for (const [nombre, id] of [['programado', tProg], ['reprogramado', tRepr], ['en_progreso', tProg2], ['finalizado', tFin], ['cancelado', tCanc], ['pendiente_pago', rPp.insertId], ['en_lista_espera', rLe.insertId]]) {
            assert.ok(!ids3.includes(id), `${nombre} no visible`);
        }
        ok('t3-estados-no-visibles');

        // T4: pendiente con bloque activo (reservado / en_progreso) no aparece.
        const tBloq = await crearPendiente(cli.id, serviciosId);
        await insertarBloqueDirecto(serviceVT.cuadrilla_id, tBloq, fechaFutura(36), 'reservado');
        assert.ok(!(await idsPendientes()).includes(tBloq), 'con reservado no aparece');
        await db.query(`UPDATE agenda_bloques SET estado = 'en_progreso' WHERE turnos_id = ?`, [tBloq]);
        assert.ok(!(await idsPendientes()).includes(tBloq), 'con en_progreso no aparece');
        ok('t4-bloque-activo-excluye');

        // T5: pendiente con bloque liberado (o cancelado) sigue apareciendo.
        await db.query(`UPDATE agenda_bloques SET estado = 'liberado' WHERE turnos_id = ?`, [tBloq]);
        assert.ok((await idsPendientes()).includes(tBloq), 'con liberado aparece');
        await db.query(`UPDATE agenda_bloques SET estado = 'cancelado' WHERE turnos_id = ?`, [tBloq]);
        assert.ok((await idsPendientes()).includes(tBloq), 'con cancelado aparece');
        ok('t5-bloque-liberado-incluye');

        // T6: orden fecha_creacion ASC.
        const tO1 = await crearPendiente(cli.id, serviciosId);
        const tO2 = await crearPendiente(cli.id, serviciosId);
        const tO3 = await crearPendiente(cli.id, serviciosId);
        await db.query(`UPDATE turnos SET fecha_creacion = NOW() - INTERVAL 3 DAY WHERE turnos_id = ?`, [tO1]);
        await db.query(`UPDATE turnos SET fecha_creacion = NOW() - INTERVAL 2 DAY WHERE turnos_id = ?`, [tO2]);
        await db.query(`UPDATE turnos SET fecha_creacion = NOW() - INTERVAL 1 DAY WHERE turnos_id = ?`, [tO3]);
        const ids6 = await idsPendientes();
        assert.ok(ids6.indexOf(tO1) < ids6.indexOf(tO2) && ids6.indexOf(tO2) < ids6.indexOf(tO3), 'orden ASC');
        ok('t6-orden-antiguedad');

        // T7: joins correctos (telefono, equipo, falla, precio, estado_pago).
        const lista7 = await listaPendientes();
        const fila7 = lista7.find((t) => t.turnos_id === turnoVis);
        assert.strictEqual(String(fila7.telefono), cli.telefono, 'telefono del usuario');
        assert.strictEqual(fila7.equipo, servicios[0].equipo, 'equipo del servicio');
        assert.strictEqual(fila7.falla, servicios[0].falla, 'falla del servicio');
        assert.strictEqual(Number(fila7.precio), Number(servicios[0].precio), 'precio del servicio');
        assert.strictEqual(fila7.estado_pago, 'efectivo_en_destino', 'estado_pago intacto');
        assert.strictEqual(fila7.metodo_pago, 'efectivo_whatsapp', 'metodo_pago');
        ok('t7-joins-correctos');

        // T8: flujo real pendientes -> programar -> ya no aparece.
        const tCiclo = await crearPendiente(cli.id, serviciosId);
        assert.ok((await idsPendientes()).includes(tCiclo), 'aparece antes de programar');
        const fechaC = fechaFutura(37);
        const rProg = await post('/api/turnos/programar', tokenAdmin, {
            turnosId: tCiclo, cuadrillaId: serviceVT.cuadrilla_id,
            fecha: fechaC, horaInicio: '14:00', horaFin: '17:00'
        });
        assert.strictEqual(rProg.status, 201, 'programar 201');
        const [estC] = await db.query(`SELECT estado_turno FROM turnos WHERE turnos_id = ?`, [tCiclo]);
        assert.strictEqual(estC[0].estado_turno, 'programado', 'turno programado');
        const [blC] = await db.query(`SELECT estado FROM agenda_bloques WHERE turnos_id = ? ORDER BY bloque_id DESC LIMIT 1`, [tCiclo]);
        assert.strictEqual(blC[0].estado, 'reservado', 'bloque reservado');
        const [hiC] = await db.query(
            `SELECT estado_anterior, estado_nuevo FROM turno_historial WHERE turnos_id = ? ORDER BY historial_id DESC LIMIT 1`,
            [tCiclo]
        );
        assert.strictEqual(hiC[0].estado_anterior, 'pendiente_programacion', 'historial desde pendiente');
        assert.strictEqual(hiC[0].estado_nuevo, 'programado', 'historial a programado');
        assert.ok(!(await idsPendientes()).includes(tCiclo), 'ya no aparece tras programar');
        ok('t8-programar-desde-pendientes');

        // Liberar la cuadrilla al cierre de los fixtures propios: el fixture
        // en_progreso de T3 ocupa la capacidad global (ya fue verificado como
        // excluido en T3). Las regresiones corrieron antes (DB limpia).
        await AgendaModel.finalizar(tProg2, adminId);

        console.log(`\nF5-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF5-TEST-FAIL:${error.message}`);
        if (error.stack) {
            console.error(error.stack.split('\n').slice(0, 4).join('\n'));
        }
        process.exitCode = 1;
    } finally {
        if (servidor) {
            await new Promise((resolve) => servidor.close(resolve));
        }

        // T10: cleanup completo, cero filas de test, datos reales intactos.
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

            const [rU] = await db.query(`SELECT COUNT(*) AS n FROM usuarios WHERE telefono LIKE 'F5TEST%'`);
            const [rT] = await db.query(`SELECT COUNT(*) AS n FROM turnos t INNER JOIN usuarios u ON u.usuarios_id = t.usuarios_id WHERE u.telefono LIKE 'F5TEST%'`);
            const [rH] = await db.query(`SELECT COUNT(*) AS n FROM turno_historial h LEFT JOIN turnos t ON t.turnos_id = h.turnos_id WHERE t.turnos_id IS NULL`);
            const [rB] = await db.query(`SELECT COUNT(*) AS n FROM agenda_bloques b LEFT JOIN turnos t ON t.turnos_id = b.turnos_id WHERE t.turnos_id IS NULL`);
            console.log(`F5-CLEANUP-RESTOS-USUARIOS:${rU[0].n}`);
            console.log(`F5-CLEANUP-RESTOS-TURNOS:${rT[0].n}`);
            console.log(`F5-CLEANUP-HUERFANOS-HIST:${rH[0].n}`);
            console.log(`F5-CLEANUP-HUERFANOS-BLOQ:${rB[0].n}`);
            assert.strictEqual(rU[0].n, 0, 'cero usuarios de test');
            assert.strictEqual(rT[0].n, 0, 'cero turnos de test');
            assert.strictEqual(rH[0].n, 0, 'cero historial huerfano');
            assert.strictEqual(rB[0].n, 0, 'cero bloques huerfanos');

            const [cU] = await db.query(`SELECT COUNT(*) AS n FROM usuarios`);
            const [cTec] = await db.query(`SELECT COUNT(*) AS n FROM tecnicos`);
            const [cCua] = await db.query(`SELECT COUNT(*) AS n FROM cuadrillas`);
            const [cCt] = await db.query(`SELECT COUNT(*) AS n FROM cuadrilla_tecnicos`);
            const [cS] = await db.query(`SELECT COUNT(*) AS n FROM servicios`);
            console.log(`F5-DATOS-REALES:usuarios=${cU[0].n} tecnicos=${cTec[0].n} cuadrillas=${cCua[0].n} ct=${cCt[0].n} servicios=${cS[0].n}`);
            assert.strictEqual(cU[0].n, 10, 'usuarios reales intactos');
            assert.strictEqual(cTec[0].n, 2, 'tecnicos intactos');
            assert.strictEqual(cCua[0].n, 1, 'cuadrillas intactas');
            assert.strictEqual(cCt[0].n, 2, 'asociaciones intactas');
            assert.strictEqual(cS[0].n, 5, 'servicios intactos');
            ok('t10-cleanup-cero-restos');
            console.log(`\nF5-TESTS-OK:${pasados}`);
        } catch (cleanupError) {
            console.error(`F5-CLEANUP-FAIL:${cleanupError.message}`);
            process.exitCode = 1;
        }

        try { await db.end(); } catch (_) {}
    }
})();
