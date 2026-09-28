// tests/f2-agenda.js - Suite F2 (fixtures controlados + cleanup, sin tocar datos reales)
// Uso: node tests/f2-agenda.js
// Crea usuarios/turnos/bloques de prueba con telefono prefijo F2TEST y los elimina al final.
// No modifica los 9 usuarios ni los 5 servicios existentes. No imprime secretos.
require('dotenv').config();

const assert = require('assert');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const TurnoModel = require('../models/turnoModel');
const ServiceModel = require('../models/serviceModel');
const AgendaModel = require('../models/agendaModel');
const CuadrillaModel = require('../models/cuadrillaModel');
const TurnoHistorialModel = require('../models/turnoHistorialModel');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('Falta JWT_SECRET para firmar tokens de prueba.');
}

const resultados = [];
const ok = (nombre) => {
    resultados.push(`PASS:${nombre}`);
    console.log(`PASS:${nombre}`);
};

const fechaFutura = (dias) => {
    const d = new Date(Date.now() + dias * 86400000);
    return d.toISOString().slice(0, 10);
};

const firmar = (usuariosId, rol) => jwt.sign(
    { usuariosId, rol },
    JWT_SECRET,
    { expiresIn: '1h', issuer: 'serviceVT', audience: 'serviceVT-client' }
);

(async () => {
    const fixtures = { usuarios: [], turnos: [] };
    let servidor = null;

    const crearUsuarioTest = async (sufijo) => {
        const telefono = `F2TEST${Date.now()}${sufijo}`.slice(0, 20);
        const [r] = await db.query(
            `INSERT INTO usuarios (telefono, rol) VALUES (?, 'cliente')`,
            [telefono]
        );
        fixtures.usuarios.push(r.insertId);
        return r.insertId;
    };

    const crearTurnoProgramable = async (usuariosId, serviciosId) => {
        // F4-B: el estado programable oficial es pendiente_programacion.
        // (Antes F2 usaba pendiente_pago; sigue permitido en crear() por
        // compatibilidad pero ya no es programable via agenda.)
        const r = await TurnoModel.crear(usuariosId, serviciosId, 'mercado_pago', 'pendiente', 'pendiente_programacion');
        fixtures.turnos.push(r.insertId);
        return r.insertId;
    };

    // F4-B: inserta un turno legacy preexistente SIN pasar por el modelo
    // endurecido (TurnoModel.crear rechaza en_progreso). Representa datos
    // anteriores a F4-B; solo lectura/finalizacion legacy, jamas flujo nuevo.
    const insertarTurnoLegacyEnProgreso = async (usuariosId, serviciosId) => {
        const [r] = await db.query(
            `INSERT INTO turnos (usuarios_id, servicios_id, metodo_pago, estado_pago, estado_turno)
             VALUES (?, ?, 'efectivo_whatsapp', 'efectivo_en_destino', 'en_progreso')`,
            [usuariosId, serviciosId]
        );
        fixtures.turnos.push(r.insertId);
        return r.insertId;
    };

    const estadoPagoDe = async (turnosId) => {
        const [rows] = await db.query(
            `SELECT estado_pago FROM turnos WHERE turnos_id = ?`,
            [turnosId]
        );
        return rows[0].estado_pago;
    };

    try {
        // Base: cuadrilla seed + servicio existente.
        const serviceVT = await CuadrillaModel.buscarServiceVT();
        assert.ok(serviceVT && serviceVT.activa, 'cuadrilla ServiceVT activa');
        ok('cuadrilla-ServiceVT-activa');

        const servicios = await ServiceModel.getAll();
        assert.ok(servicios.length > 0, 'hay servicios');
        const serviciosId = servicios[0].servicios_id;

        const [admins] = await db.query(`SELECT usuarios_id FROM usuarios WHERE rol = 'admin' LIMIT 1`);
        assert.ok(admins.length > 0, 'hay admin');
        const adminId = admins[0].usuarios_id;

        const clienteId = await crearUsuarioTest('1');
        const fecha = fechaFutura(7);

        // 1. Programacion valida.
        const turnoA = await crearTurnoProgramable(clienteId, serviciosId);
        const pagoAntesA = await estadoPagoDe(turnoA);
        const progA = await AgendaModel.programar(turnoA, serviceVT.cuadrilla_id, fecha, '14:00', '17:00', adminId);
        assert.ok(progA.bloqueId > 0, 'bloque creado');
        const histA1 = await TurnoHistorialModel.listarPorTurno(turnoA);
        assert.strictEqual(histA1.length, 1, 'un historial');
        assert.strictEqual(histA1[0].estado_nuevo, 'programado', 'historial programado');
        ok('programacion-valida');

        // 2. Solapamientos rechazados (4 variantes, cada una con turno propio).
        for (const [suf, ini, fin] of [['2', '13:00', '15:00'], ['3', '15:00', '18:00'], ['4', '14:30', '15:30'], ['5', '16:00', '17:30']]) {
            const t = await crearTurnoProgramable(await crearUsuarioTest(suf), serviciosId);
            await assert.rejects(
                AgendaModel.programar(t, serviceVT.cuadrilla_id, fecha, ini, fin, adminId),
                (e) => e.code === 'CONFLICTO_AGENDA',
                `solape ${ini}-${fin}`
            );
        }
        ok('solapamiento-rechazado-x4');

        // 3. Limite contiguo permitido.
        const turnoB = await crearTurnoProgramable(await crearUsuarioTest('6'), serviciosId);
        await AgendaModel.programar(turnoB, serviceVT.cuadrilla_id, fecha, '17:00', '19:00', adminId);
        ok('limite-contiguo-permitido');

        // 4. Iniciar registra inicio_real.
        const ini = await AgendaModel.iniciar(turnoA, adminId);
        assert.strictEqual(ini.bloqueId, progA.bloqueId, 'mismo bloque');
        const [bIni] = await db.query(`SELECT inicio_real FROM agenda_bloques WHERE bloque_id = ?`, [progA.bloqueId]);
        assert.ok(bIni[0].inicio_real, 'inicio_real seteado');
        ok('iniciar-registra-inicio');

        // 5. Doble iniciar rechazado.
        await assert.rejects(AgendaModel.iniciar(turnoA, adminId), (e) => e.code === 'TURNO_NO_INICIABLE');
        ok('doble-iniciar-rechazado');

        // 6. Dos EN_PROGRESO impedidos + sin auto-inicio posterior.
        await assert.rejects(AgendaModel.iniciar(turnoB, adminId), (e) => e.code === 'CUADRILLA_OCUPADA');
        ok('dos-en-progreso-impedidos');

        // Simular trabajo real de 82 minutos antes de finalizar.
        await db.query(`UPDATE agenda_bloques SET inicio_real = NOW() - INTERVAL 82 MINUTE WHERE bloque_id = ?`, [progA.bloqueId]);

        // 7. Finalizar: fin_real + duracion 82.
        const fin = await AgendaModel.finalizar(turnoA, adminId);
        assert.strictEqual(fin.yaFinalizado, false, 'no era repetido');
        assert.strictEqual(fin.duracionMin, 82, 'duracion 82 minutos');
        assert.ok(fin.finReal, 'fin_real seteado');
        const [tA] = await db.query(`SELECT estado_turno FROM turnos WHERE turnos_id = ?`, [turnoA]);
        assert.strictEqual(tA[0].estado_turno, 'finalizado', 'turno finalizado');
        ok('finalizar-fin-y-duracion');

        // 8. El siguiente sigue programado (sin auto-inicio) y ahora si puede iniciar.
        const [tB] = await db.query(`SELECT estado_turno FROM turnos WHERE turnos_id = ?`, [turnoB]);
        assert.strictEqual(tB[0].estado_turno, 'programado', 'siguiente sigue programado');
        await AgendaModel.iniciar(turnoB, adminId);
        await AgendaModel.finalizar(turnoB, adminId);
        ok('sin-auto-inicio');

        // 9. Capacidad liberada: el rango 15:00-16:00 del bloque liberado se puede reservar.
        const turnoC = await crearTurnoProgramable(await crearUsuarioTest('7'), serviciosId);
        await AgendaModel.programar(turnoC, serviceVT.cuadrilla_id, fecha, '15:00', '16:00', adminId);
        ok('capacidad-liberada-reutilizable');

        // 10. Doble finalizar idempotente.
        const fin2 = await AgendaModel.finalizar(turnoA, adminId);
        assert.strictEqual(fin2.yaFinalizado, true, 'idempotente');
        const histA = await TurnoHistorialModel.listarPorTurno(turnoA);
        assert.strictEqual(histA.filter((h) => h.estado_nuevo === 'finalizado').length, 1, 'un solo finalizado');
        ok('doble-finalizar-idempotente');

        // 11. Historial completo programado -> en_progreso -> finalizado.
        assert.deepStrictEqual(histA.map((h) => h.estado_nuevo), ['programado', 'en_progreso', 'finalizado']);
        ok('historial-completo');

        // 12. estado_pago intacto.
        assert.strictEqual(await estadoPagoDe(turnoA), pagoAntesA, 'pago intacto');
        ok('estado-pago-intacto');

        // 13. Cancelar sin tocar pagos.
        const turnoD = await crearTurnoProgramable(await crearUsuarioTest('8'), serviciosId);
        const pagoAntesD = await estadoPagoDe(turnoD);
        await AgendaModel.programar(turnoD, serviceVT.cuadrilla_id, fechaFutura(8), '10:00', '12:00', adminId);
        await AgendaModel.cancelar(turnoD, adminId, 'cliente reprograma');
        const [tD] = await db.query(`SELECT estado_turno, estado_pago FROM turnos WHERE turnos_id = ?`, [turnoD]);
        assert.strictEqual(tD[0].estado_turno, 'cancelado', 'turno cancelado');
        assert.strictEqual(tD[0].estado_pago, pagoAntesD, 'pago intacto en cancelar');
        ok('cancelar-sin-tocar-pagos');

        // 14. Reprogramar: un solo bloque activo, turno reprogramado, iniciable.
        const turnoE = await crearTurnoProgramable(await crearUsuarioTest('9'), serviciosId);
        const fechaE = fechaFutura(9);
        const rep1 = await AgendaModel.programar(turnoE, serviceVT.cuadrilla_id, fechaE, '10:00', '12:00', adminId);
        const rep2 = await AgendaModel.reprogramar(turnoE, null, fechaE, '13:00', '15:00', adminId);
        const [blqE] = await db.query(
            `SELECT bloque_id, estado FROM agenda_bloques WHERE turnos_id = ? ORDER BY bloque_id ASC`,
            [turnoE]
        );
        assert.deepStrictEqual(blqE.map((b) => b.estado), ['cancelado', 'reservado'], 'viejo cancelado, nuevo reservado');
        assert.strictEqual(rep2.bloqueAnteriorId, rep1.bloqueId, 'trazabilidad');
        const [tE] = await db.query(`SELECT estado_turno FROM turnos WHERE turnos_id = ?`, [turnoE]);
        assert.strictEqual(tE[0].estado_turno, 'reprogramado', 'turno reprogramado');
        await AgendaModel.iniciar(turnoE, adminId);
        await AgendaModel.finalizar(turnoE, adminId);
        ok('reprogramar-un-solo-bloque-activo');

        // 15. Concurrencia: dos reservas simultaneas del mismo slot.
        const turnoF1 = await crearTurnoProgramable(await crearUsuarioTest('A'), serviciosId);
        const turnoF2 = await crearTurnoProgramable(await crearUsuarioTest('B'), serviciosId);
        const fechaF = fechaFutura(10);
        const resultadosConc = await Promise.allSettled([
            AgendaModel.programar(turnoF1, serviceVT.cuadrilla_id, fechaF, '09:00', '11:00', adminId),
            AgendaModel.programar(turnoF2, serviceVT.cuadrilla_id, fechaF, '09:00', '11:00', adminId)
        ]);
        const exitosas = resultadosConc.filter((r) => r.status === 'fulfilled');
        const rechazadas = resultadosConc.filter((r) => r.status === 'rejected' && r.reason && r.reason.code === 'CONFLICTO_AGENDA');
        assert.strictEqual(exitosas.length, 1, 'una sola reserva gana');
        assert.strictEqual(rechazadas.length, 1, 'la otra choca');
        ok('concurrencia-doble-reserva');

        // 16. Compatibilidad legacy: finalizar clasico intacto sobre dato
        // preexistente (insert directo; crear() con en_progreso esta
        // bloqueado desde F4-B para flujo nuevo).
        const turnoLeg = await insertarTurnoLegacyEnProgreso(clienteId, serviciosId);
        const activos = await TurnoModel.verificarTrabajoActivo();
        assert.ok(activos.length > 0, 'verificarTrabajoActivo responde');
        const finLeg = await TurnoModel.marcarComoFinalizado(turnoLeg);
        assert.strictEqual(finLeg.affectedRows, 1, 'legacy finaliza');
        ok('compatibilidad-turnos-legacy');

        // 17-18. HTTP: sin token 401, cliente 403 (servidor efimero, se cierra al final).
        const app = require('../app');
        servidor = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const puerto = servidor.address().port;
        const base = `http://127.0.0.1:${puerto}`;

        let rSinToken = await fetch(`${base}/api/turnos/programar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turnosId: 1, cuadrillaId: 1, fecha, horaInicio: '10:00', horaFin: '11:00' })
        });
        assert.strictEqual(rSinToken.status, 401, 'sin token 401');

        const tokenCliente = firmar(clienteId, 'cliente');
        let rCliente = await fetch(`${base}/api/turnos/programar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenCliente}` },
            body: JSON.stringify({ turnosId: 1, cuadrillaId: 1, fecha, horaInicio: '10:00', horaFin: '11:00' })
        });
        assert.strictEqual(rCliente.status, 403, 'cliente 403');
        ok('auth-401-403');

        // 19. HTTP admin: actual/proximos responden 200.
        const tokenAdmin = firmar(adminId, 'admin');
        const headersAdmin = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` };
        let rActual = await fetch(`${base}/api/turnos/actual?cuadrillaId=1`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
        assert.strictEqual(rActual.status, 200, 'actual 200');
        let rProx = await fetch(`${base}/api/turnos/proximos?cuadrillaId=1&limite=5`, { headers: { Authorization: `Bearer ${tokenAdmin}` } });
        assert.strictEqual(rProx.status, 200, 'proximos 200');
        void headersAdmin;
        ok('endpoints-lectura-200');

        console.log(`\nF2-TESTS-OK:${resultados.length}`);
    } catch (error) {
        console.error(`\nF2-TEST-FAIL:${error.message} code=${error.code || '-'}`);
        process.exitCode = 1;
    } finally {
        if (servidor) {
            await new Promise((resolve) => servidor.close(resolve));
        }

        // Cleanup de fixtures (orden inverso por FK). No toca datos reales.
        try {
            if (fixtures.turnos.length > 0) {
                await db.query(`DELETE FROM turno_historial WHERE turnos_id IN (${fixtures.turnos.map(() => '?').join(',')})`, fixtures.turnos);
                await db.query(`DELETE FROM agenda_bloques WHERE turnos_id IN (${fixtures.turnos.map(() => '?').join(',')})`, fixtures.turnos);
                await db.query(`DELETE FROM turnos WHERE turnos_id IN (${fixtures.turnos.map(() => '?').join(',')})`, fixtures.turnos);
            }

            if (fixtures.usuarios.length > 0) {
                await db.query(`DELETE FROM usuarios WHERE usuarios_id IN (${fixtures.usuarios.map(() => '?').join(',')})`, fixtures.usuarios);
            }

            const [restos] = await db.query(`SELECT COUNT(*) AS n FROM usuarios WHERE telefono LIKE 'F2TEST%'`);
            console.log(`F2-CLEANUP-RESTOS:${restos[0].n}`);
        } catch (cleanupError) {
            console.error(`F2-CLEANUP-FAIL:${cleanupError.message}`);
            process.exitCode = 1;
        }

        try { await db.end(); } catch (_) {}
    }
})();
