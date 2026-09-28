// tests/f3b-tecnicos.js - Suite F3B: cuadrilla ServiceVT completa
// Uso: node tests/f3b-tecnicos.js
// Solo lectura + fixtures de agenda con cleanup. NUNCA crea usuarios ni tecnicos.
// Si Marian no existe como usuario, reporta MARIAN_BLOQUEADO y sale con codigo 2.
require('dotenv').config();

const assert = require('assert');

const db = require('../config/db');
const TurnoModel = require('../models/turnoModel');
const ServiceModel = require('../models/serviceModel');
const AgendaModel = require('../models/agendaModel');
const CuadrillaModel = require('../models/cuadrillaModel');
const TecnicoModel = require('../models/tecnicoModel');

let pasados = 0;
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};

const fechaFutura = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

(async () => {
    const fixtures = { usuarios: [], turnos: [] };

    try {
        // 1-2. PabloVT registrado y con rol admin intacto.
        const [pab] = await db.query(
            `SELECT t.tecnico_id, t.usuarios_id, t.nombre, t.activo, u.telefono, u.rol
              FROM tecnicos t
              INNER JOIN usuarios u ON u.usuarios_id = t.usuarios_id
              WHERE t.usuarios_id = 2`
        );
        assert.strictEqual(pab.length, 1, 'PabloVT registrado una sola vez');
        assert.strictEqual(pab[0].nombre, 'PabloVT', 'nombre PabloVT');
        assert.strictEqual(pab[0].telefono, '1161137178', 'telefono PabloVT');
        assert.strictEqual(pab[0].rol, 'admin', 'rol admin conservado');
        assert.strictEqual(pab[0].activo, 1, 'tecnico activo');
        ok('pablovt-registrado-rol-admin');

        // 3. Marian: solo verificar, jamas crear.
        const [mar] = await db.query(
            `SELECT usuarios_id, telefono, rol FROM usuarios WHERE telefono = ?`,
            ['1112211223']
        );

        if (mar.length === 0) {
            console.log('MARIAN_BLOQUEADO:no existe usuario con telefono 1112211223; se requiere decision de rol/autenticacion antes de crearlo. No se creo nada.');
            process.exitCode = 2;
        } else {
            const [tecMar] = await db.query(
                `SELECT tecnico_id FROM tecnicos WHERE usuarios_id = ?`,
                [mar[0].usuarios_id]
            );
            assert.strictEqual(tecMar.length, 1, 'Marian registrado una sola vez');
            assert.notStrictEqual(mar[0].rol, 'admin', 'Marian no es admin');
            const [asMar] = await db.query(
                `SELECT cuadrilla_id FROM cuadrilla_tecnicos WHERE tecnico_id = ?`,
                [tecMar[0].tecnico_id]
            );
            assert.ok(asMar.some((r) => r.cuadrilla_id === 1), 'Marian en ServiceVT');
            ok('marian-registrado-en-servicevt');
        }

        // 4-7. Asociaciones, cuadrilla activa, FK consistentes, sin duplicados.
        const [asoc] = await db.query(
            `SELECT ct.cuadrilla_id, ct.tecnico_id, c.activa
              FROM cuadrilla_tecnicos ct
              INNER JOIN cuadrillas c ON c.cuadrilla_id = ct.cuadrilla_id
              WHERE ct.cuadrilla_id = 1`
        );
        assert.ok(asoc.length >= 1, 'al menos un tecnico en cuadrilla 1');
        assert.ok(asoc.every((r) => r.activa === 1), 'cuadrilla activa');
        const [dupTec] = await db.query(
            `SELECT usuarios_id, COUNT(*) AS n FROM tecnicos GROUP BY usuarios_id HAVING n > 1`
        );
        assert.strictEqual(dupTec.length, 0, 'sin tecnicos duplicados');
        const [dupCt] = await db.query(
            `SELECT cuadrilla_id, tecnico_id, COUNT(*) AS n FROM cuadrilla_tecnicos GROUP BY cuadrilla_id, tecnico_id HAVING n > 1`
        );
        assert.strictEqual(dupCt.length, 0, 'sin asociaciones duplicadas');
        ok('cuadrilla-asociaciones-consistentes');

        // 8-12. Ciclo agenda sobre cuadrilla 1 con pago intacto y capacidad liberada.
        const serviceVT = await CuadrillaModel.buscarServiceVT();
        assert.ok(serviceVT && serviceVT.activa === 1, 'ServiceVT activa');
        const tecnicos = await TecnicoModel.listarPorCuadrilla(1);
        assert.ok(tecnicos.length >= 1, 'cuadrilla con tecnicos');

        const servicios = await ServiceModel.getAll();
        const [cli] = await db.query(`SELECT usuarios_id FROM usuarios WHERE rol = 'cliente' LIMIT 1`);
        // F4-B: estado programable oficial pendiente_programacion
        // (pendiente_pago ya no es programable via agenda).
        const rTurno = await TurnoModel.crear(cli[0].usuarios_id, servicios[0].servicios_id, 'mercado_pago', 'pendiente', 'pendiente_programacion');
        const turnoId = rTurno.insertId;
        fixtures.turnos.push(turnoId);

        const fecha = fechaFutura(7);
        await AgendaModel.programar(turnoId, 1, fecha, '14:00', '17:00', 2);
        await AgendaModel.iniciar(turnoId, 2);
        const pagoAntes = (await db.query(`SELECT estado_pago FROM turnos WHERE turnos_id = ?`, [turnoId]))[0][0].estado_pago;
        await AgendaModel.finalizar(turnoId, 2);
        const [fin] = await db.query(`SELECT estado_turno, estado_pago FROM turnos WHERE turnos_id = ?`, [turnoId]);
        assert.strictEqual(fin[0].estado_turno, 'finalizado', 'finalizado');
        assert.strictEqual(fin[0].estado_pago, pagoAntes, 'pago intacto');
        const [lib] = await db.query(`SELECT estado FROM agenda_bloques WHERE turnos_id = ? ORDER BY bloque_id DESC LIMIT 1`, [turnoId]);
        assert.strictEqual(lib[0].estado, 'liberado', 'capacidad liberada');
        ok('ciclo-agenda-cuadrilla-1');

        console.log(`\nF3B-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF3B-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    } finally {
        try {
            if (fixtures.turnos.length > 0) {
                const ph = fixtures.turnos.map(() => '?').join(',');
                await db.query(`DELETE FROM turno_historial WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM agenda_bloques WHERE turnos_id IN (${ph})`, fixtures.turnos);
                await db.query(`DELETE FROM turnos WHERE turnos_id IN (${ph})`, fixtures.turnos);
            }

            const [restos] = await db.query(`SELECT COUNT(*) AS n FROM turno_historial WHERE turnos_id NOT IN (SELECT turnos_id FROM turnos)`);
            console.log(`F3B-CLEANUP-HUERFANOS:${restos[0].n}`);
        } catch (cleanupError) {
            console.error(`F3B-CLEANUP-FAIL:${cleanupError.message}`);
            process.exitCode = 1;
        }

        try { await db.end(); } catch (_) {}
    }
})();
