// tests/f3-turnos-pagos.js - Suite F3A: PAGO != TRABAJO
// Uso: node tests/f3-turnos-pagos.js
// Fixtures con telefono prefijo F3TEST y mp_payment_id F3A-*, con cleanup.
// No modifica usuarios/servicios existentes. No imprime secretos.
require('dotenv').config();

const assert = require('assert');
const jwt = require('jsonwebtoken');

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

const tieneBloque = async (turnosId) => {
    const [rows] = await db.query(
        `SELECT bloque_id FROM agenda_bloques WHERE turnos_id = ? LIMIT 1`,
        [turnosId]
    );
    return rows.length > 0;
};

(async () => {
    const fixtures = { usuarios: [], turnos: [] };
    let servidor = null;

    const crearUsuarioTest = async (sufijo) => {
        const telefono = `F3TEST${Date.now()}${sufijo}`.slice(0, 20);
        const [r] = await db.query(
            `INSERT INTO usuarios (telefono, rol) VALUES (?, 'cliente')`,
            [telefono]
        );
        fixtures.usuarios.push(r.insertId);
        return r.insertId;
    };

    // F4-B: inserta turno legacy preexistente SIN pasar por TurnoModel.crear
    // (crear con en_progreso esta bloqueado para flujo nuevo). Representa
    // datos anteriores a F4-B; solo finalizacion legacy, jamas flujo nuevo.
    const insertarLegacyEnProgreso = async (usuariosId, serviciosId) => {
        const [r] = await db.query(
            `INSERT INTO turnos (usuarios_id, servicios_id, metodo_pago, estado_pago, estado_turno)
             VALUES (?, ?, 'efectivo_whatsapp', 'efectivo_en_destino', 'en_progreso')`,
            [usuariosId, serviciosId]
        );
        fixtures.turnos.push(r.insertId);
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

        const clienteId = await crearUsuarioTest('C');
        const tokenCliente = firmar(clienteId, 'cliente');
        const tokenAdmin = firmar(adminId, 'admin');

        const app = require('../app');
        servidor = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const base = `http://127.0.0.1:${servidor.address().port}`;
        const post = (path, token, body) => fetch(`${base}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: JSON.stringify(body)
        });

        // 1+11. Efectivo: pendiente_programacion, sin en_progreso ni en_lista_espera ni bloque.
        const rEf = await post('/api/pagos/solicitar', tokenCliente, { idServicio: serviciosId, metodoPago: 'efectivo_whatsapp' });
        assert.strictEqual(rEf.status, 201, 'efectivo 201');
        const dEf = await rEf.json();
        assert.strictEqual(dEf.tipo, 'whatsapp', 'tipo whatsapp');
        assert.ok(dEf.url, 'url whatsapp');
        const [tEf] = await db.query(`SELECT turnos_id FROM turnos WHERE usuarios_id = ? ORDER BY turnos_id DESC LIMIT 1`, [clienteId]);
        const turnoEf = tEf[0].turnos_id;
        fixtures.turnos.push(turnoEf);
        const estEf = await estadoDe(turnoEf);
        assert.strictEqual(estEf.estado_pago, 'efectivo_en_destino', 'pago efectivo');
        assert.strictEqual(estEf.estado_turno, 'pendiente_programacion', 'no inicia trabajo');
        assert.notStrictEqual(estEf.estado_turno, 'en_progreso', 'no en_progreso');
        assert.notStrictEqual(estEf.estado_turno, 'en_lista_espera', 'no en_lista_espera');
        assert.strictEqual(await tieneBloque(turnoEf), false, 'sin bloque');
        ok('efectivo-pendiente-programacion');

        // 2. MP pendiente.
        const rPend = await TurnoModel.crearPendientePago(clienteId, serviciosId);
        const turnoPend = rPend.insertId;
        fixtures.turnos.push(turnoPend);
        const estPend = await estadoDe(turnoPend);
        assert.strictEqual(estPend.estado_pago, 'pendiente', 'pago pendiente');
        assert.strictEqual(estPend.estado_turno, 'pendiente_pago', 'turno pendiente_pago');
        ok('mp-pendiente');

        // 3. MP aprobado: aprobado + pendiente_programacion, sin bloque ni en_progreso.
        const payId = `PAY-F3A-${Date.now()}-1`;
        const ap = await TurnoModel.aprobarPagoMercadoPago(turnoPend, payId);
        assert.strictEqual(ap.yaProcesado, false, 'procesado');
        assert.strictEqual(ap.estadoPago, 'aprobado', 'pago aprobado');
        assert.strictEqual(ap.estadoTurno, 'pendiente_programacion', 'no inicia trabajo');
        const estAp = await estadoDe(turnoPend);
        assert.strictEqual(estAp.estado_turno, 'pendiente_programacion', 'turno pendiente_programacion');
        assert.strictEqual(await tieneBloque(turnoPend), false, 'sin bloque');
        const ap2 = await TurnoModel.aprobarPagoMercadoPago(turnoPend, payId);
        assert.strictEqual(ap2.yaProcesado, true, 'idempotente');
        ok('mp-aprobado-no-inicia');

        // 10. Aprobado no auto-inicia ni encola aunque haya otro en_progreso legacy.
        const turnoLeg = await insertarLegacyEnProgreso(clienteId, serviciosId);
        const rPend2 = await TurnoModel.crearPendientePago(clienteId, serviciosId);
        const turnoPend2 = rPend2.insertId;
        fixtures.turnos.push(turnoPend2);
        const ap3 = await TurnoModel.aprobarPagoMercadoPago(turnoPend2, `PAY-F3A-${Date.now()}-2`);
        assert.strictEqual(ap3.estadoTurno, 'pendiente_programacion', 'no en_lista_espera ni en_progreso');
        await TurnoModel.marcarComoFinalizado(turnoLeg);
        ok('aprobado-no-auto-inicia');

        // 4-6. Ciclo agenda sobre turno efectivo: programar -> iniciar -> finalizar.
        const fecha = fechaFutura(7);
        const prog = await AgendaModel.programar(turnoEf, serviceVT.cuadrilla_id, fecha, '14:00', '17:00', adminId);
        assert.ok(prog.bloqueId > 0, 'bloque reservado');
        assert.strictEqual((await estadoDe(turnoEf)).estado_turno, 'programado', 'programado');
        await AgendaModel.iniciar(turnoEf, adminId);
        assert.strictEqual((await estadoDe(turnoEf)).estado_turno, 'en_progreso', 'en_progreso solo via iniciar');
        const pagoAntes = (await estadoDe(turnoEf)).estado_pago;
        const fin = await AgendaModel.finalizar(turnoEf, adminId);
        assert.strictEqual(fin.yaFinalizado, false, 'finalizado');
        const [bFin] = await db.query(`SELECT estado FROM agenda_bloques WHERE bloque_id = ?`, [prog.bloqueId]);
        assert.strictEqual(bFin[0].estado, 'liberado', 'bloque liberado');
        assert.strictEqual((await estadoDe(turnoEf)).estado_pago, pagoAntes, 'pago intacto');
        ok('ciclo-agenda-completo');

        // 7. Legacy finalizar turno SIN agenda: compatible 200.
        const turnoLeg2 = await insertarLegacyEnProgreso(clienteId, serviciosId);
        const rFinLeg = await post('/api/pagos/finalizar-trabajo', tokenAdmin, { turnoId: turnoLeg2 });
        assert.strictEqual(rFinLeg.status, 200, 'legacy sin agenda 200');
        assert.strictEqual((await estadoDe(turnoLeg2)).estado_turno, 'finalizado', 'legacy finaliza');
        ok('legacy-sin-agenda-compatible');

        // 8. Legacy finalizar CON bloque activo: 409, turno y bloque intactos.
        const turnoAg = await crearTurnoParaAgenda();
        async function crearTurnoParaAgenda() {
            // F4-B: estado programable oficial pendiente_programacion.
            const r = await TurnoModel.crear(clienteId, serviciosId, 'efectivo_whatsapp', 'efectivo_en_destino', 'pendiente_programacion');
            fixtures.turnos.push(r.insertId);
            return r.insertId;
        }
        await AgendaModel.programar(turnoAg, serviceVT.cuadrilla_id, fechaFutura(8), '10:00', '12:00', adminId);
        await AgendaModel.iniciar(turnoAg, adminId);
        const rFinAg = await post('/api/pagos/finalizar-trabajo', tokenAdmin, { turnoId: turnoAg });
        assert.strictEqual(rFinAg.status, 409, 'legacy con agenda 409');
        const estAg = await estadoDe(turnoAg);
        assert.strictEqual(estAg.estado_turno, 'en_progreso', 'turno intacto');
        const [bAg] = await db.query(`SELECT estado FROM agenda_bloques WHERE turnos_id = ? AND estado = 'en_progreso'`, [turnoAg]);
        assert.strictEqual(bAg.length, 1, 'bloque intacto');
        await AgendaModel.finalizar(turnoAg, adminId);
        ok('legacy-con-agenda-409');

        // 14. Auth se mantiene.
        const r401 = await post('/api/turnos/programar', null, { turnosId: 1, cuadrillaId: 1, fecha, horaInicio: '10:00', horaFin: '11:00' });
        assert.strictEqual(r401.status, 401, 'sin token 401');
        const r403 = await post('/api/turnos/programar', tokenCliente, { turnosId: 1, cuadrillaId: 1, fecha, horaInicio: '10:00', horaFin: '11:00' });
        assert.strictEqual(r403.status, 403, 'cliente 403');
        ok('auth-401-403');

        console.log(`\nF3A-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF3A-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    } finally {
        if (servidor) {
            await new Promise((resolve) => servidor.close(resolve));
        }

        try {
            if (fixtures.turnos.length > 0) {
                const ph = fixtures.turnos.map(() => '?').join(',');
                await db.query(`DELETE FROM turno_historial WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM agenda_bloques WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM turnos WHERE turnos_id IN (${ph})`, fixtures.turnos);
            }

            if (fixtures.usuarios.length > 0) {
                const ph = fixtures.usuarios.map(() => '?').join(',');
                await db.query(`DELETE FROM usuarios WHERE usuarios_id IN (${ph})`, fixtures.usuarios);
            }

            const [restos] = await db.query(`SELECT COUNT(*) AS n FROM usuarios WHERE telefono LIKE 'F3TEST%'`);
            console.log(`F3A-CLEANUP-RESTOS:${restos[0].n}`);
        } catch (cleanupError) {
            console.error(`F3A-CLEANUP-FAIL:${cleanupError.message}`);
            process.exitCode = 1;
        }

        try { await db.end(); } catch (_) {}
    }
})();
