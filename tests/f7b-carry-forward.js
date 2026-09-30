// tests/f7b-carry-forward.js — Carry-forward de datos estructurados F7B.
// Uso: node tests/f7b-carry-forward.js
// - Ollama SIMULADO (stub de fetch). Sin Ollama real.
// - MySQL real solo en lectura (SELECT de servicios).
// - Motor y manuales reales. Manual Lavarropas para fusión genérica;
//   piloto Heladera para integración end-to-end con eco.
// Verifica: acumulación entre turnos, precedencia actual>previos>texto,
// revalidación contra el manual, sin duplicación textual, independencia
// entre conversaciones y cierre con contrato intacto.
// NO toca turnos/pagos/agenda/auth, NO crea fixtures, NO modifica DB,
// NO modifica ningún test existente.
require('dotenv').config();
console.log('[F7B-CARRY] FILE-START');

// ANTES de importar el controller: sin precalentamiento de embeddings.
process.env.CHAT_SIN_EMBEDDINGS = '1';

const assert = require('assert');
const path = require('path');

const chat = require('../controllers/chatController');
console.log('[F7B-CARRY] CHAT-REQUIRE-OK');
const motor = require('../utils/motorDiagnostico');
console.log('[F7B-CARRY] MOTOR-REQUIRE-OK');

const RUTA_LAVARROPAS = path.join(
    __dirname,
    '..',
    'knowledge',
    'diagnostico_lavarropas_no_centrifuga.json'
);

let pasados = 0;
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};

function mockRes(captura) {
    return {
        status: (codigo) => ({
            json: (cuerpo) => {
                captura.codigo = codigo;
                captura.cuerpo = cuerpo;
            }
        })
    };
}

// Simula un turno del piloto a nivel fusión (previos + texto + actual),
// replicando el orden de handleChatPiloto: actual > previos > texto.
function turno(manual, previos, extraidos, actual) {
    const previosValidos = chat.validarDatosDiagnostico(manual, previos);
    const fusion = chat.incorporarRespuestaEstructurada(
        manual, { ...extraidos, ...previosValidos }, actual
    );
    return fusion.datos;
}

const CUERPO_BASE = {
    equipoSeleccionado: 'Heladera',
    fallaSeleccionada: 'No enfría'
};

(async () => {
    const fetchOriginal = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ response: 'Pregunta redactada simulada.' })
    });

    try {
        const manualLav = motor.cargarManual(RUTA_LAVARROPAS);

        // TEST 1 — primer click.
        assert.deepStrictEqual(
            turno(manualLav, undefined, {}, { clave: 'tambor_gira_lavado', valor: true }),
            { tambor_gira_lavado: true },
            'primer click incorporado'
        );
        ok('TEST1-primer-click');

        // TEST 2 — segundo click conserva el primero.
        const t1 = turno(manualLav, undefined, {}, { clave: 'tambor_gira_lavado', valor: true });
        const t2 = turno(manualLav, t1, {}, { clave: 'motor_zumba', valor: false });
        assert.deepStrictEqual(
            t2,
            { tambor_gira_lavado: true, motor_zumba: false },
            'acumulado, no solo lo último'
        );
        ok('TEST2-segundo-conserva-primero');

        // TEST 3 — tercer dato.
        const t3 = turno(manualLav, t2, {}, { clave: 'ruido_anormal', valor: true });
        assert.deepStrictEqual(
            t3,
            { tambor_gira_lavado: true, motor_zumba: false, ruido_anormal: true },
            'tres datos acumulados'
        );
        ok('TEST3-tercer-dato');

        // TEST 4 — sobrescritura (más reciente y explícito prevalece).
        const t4 = turno(manualLav, t3, {}, { clave: 'tambor_gira_lavado', valor: false });
        assert.strictEqual(t4.tambor_gira_lavado, false, 'sobrescrito a false');
        assert.strictEqual(Object.keys(t4).filter((k) => k === 'tambor_gira_lavado').length, 1, 'sin duplicar');
        ok('TEST4-sobrescritura');

        // TEST 5 — texto libre + estructurado (estructurada prevalece, resto vive).
        const t5 = turno(
            manualLav,
            {},
            { tambor_gira_lavado: true, ruido_anormal: true },
            { clave: 'tambor_gira_lavado', valor: false }
        );
        assert.deepStrictEqual(
            t5,
            { tambor_gira_lavado: false, ruido_anormal: true },
            'precedencia sin perder el resto'
        );
        ok('TEST5-texto-mas-estructurado');

        // TEST 6 — clave inválida rechazada, no se incorpora.
        assert.strictEqual(
            chat.validarRespuestaEstructurada(manualLav, { clave: 'causa_inventada', valor: true }).ok,
            false,
            'clave inventada rechazada'
        );
        const t6 = turno(manualLav, t3, {}, { clave: 'causa_inventada', valor: true });
        assert.deepStrictEqual(t6, t3, 'diagnóstico inalterado');
        assert.strictEqual('causa_inventada' in t6, false, 'no incorporada');
        ok('TEST6-clave-invalida');

        // TEST 7 — tipo inválido rechazado.
        assert.strictEqual(
            chat.validarRespuestaEstructurada(manualLav, { clave: 'tambor_gira_lavado', valor: 'si' }).ok,
            false,
            '"si" rechazado'
        );
        ok('TEST7-tipo-invalido');

        // TEST 8 — click no genera mensaje textual (integración sin "Sí").
        const cap8 = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: '',
                    historial: [{ rol: 'usuario', contenido: 'Quiero diagnosticar esta falla.' }],
                    datosDiagnostico: {},
                    respuestaEstructurada: { clave: 'luz_interior', valor: true }
                }
            },
            mockRes(cap8)
        );
        assert.strictEqual(cap8.codigo, 200, 'click solo 200');
        assert.deepStrictEqual(
            cap8.cuerpo.datosDiagnostico,
            { luz_interior: true },
            'eco exacto de una sola clave, sin fantasmas del extractor'
        );
        ok('TEST8-sin-duplicacion');

        // TEST 9 — conversaciones independientes (eco por request).
        const cap9a = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: '',
                    historial: [{ rol: 'usuario', contenido: 'x.' }],
                    datosDiagnostico: { luz_interior: true },
                    respuestaEstructurada: { clave: 'freezer_enfria', valor: false }
                }
            },
            mockRes(cap9a)
        );
        const cap9b = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: '',
                    historial: [{ rol: 'usuario', contenido: 'y.' }],
                    datosDiagnostico: { luz_interior: false },
                    respuestaEstructurada: { clave: 'freezer_enfria', valor: true }
                }
            },
            mockRes(cap9b)
        );
        assert.deepStrictEqual(
            cap9a.cuerpo.datosDiagnostico,
            { luz_interior: true, freezer_enfria: false },
            'A no contiene datos de B'
        );
        assert.deepStrictEqual(
            cap9b.cuerpo.datosDiagnostico,
            { luz_interior: false, freezer_enfria: true },
            'B no contiene datos de A'
        );
        ok('TEST9-independencia');

        // TEST 10 — cierre con contrato intacto y bloque null explícito.
        let acumulados = {};
        let historial = [{ rol: 'usuario', contenido: 'No enfría.' }];
        const clicks = [
            { clave: 'luz_interior', valor: true },
            { clave: 'freezer_enfria', valor: false },
            { clave: 'compresor_se_escucha', valor: false },
            { clave: 'clic_arranque', valor: true }
        ];
        let ultimo = null;
        for (const click of clicks) {
            const cap = {};
            await chat.handleChat(
                {
                    body: {
                        ...CUERPO_BASE,
                        mensaje: '',
                        historial,
                        datosDiagnostico: acumulados,
                        respuestaEstructurada: click
                    }
                },
                mockRes(cap)
            );
            assert.strictEqual(cap.codigo, 200, 'turno 200');
            acumulados = cap.cuerpo.datosDiagnostico;
            ultimo = cap.cuerpo;
            if (ultimo.mostrarFormulario === true) break;
            historial = [
                ...historial,
                { rol: 'asistente', contenido: 'Pregunta del asistente.' }
            ];
        }
        assert.strictEqual(ultimo.mostrarFormulario, true, 'cierra');
        assert.ok(ultimo.resumenParaFormulario, 'con resumen');
        assert.strictEqual(ultimo.listo, true, 'compat listo');
        assert.strictEqual(typeof ultimo.whatsappUrl, 'string', 'compat url');
        assert.strictEqual(ultimo.preguntaDiagnostico, null, 'bloque null en cierre');
        assert.deepStrictEqual(
            acumulados,
            { luz_interior: true, freezer_enfria: false, compresor_se_escucha: false, clic_arranque: true },
            'acumulado completo hasta el cierre'
        );
        ok('TEST10-cierre');

        console.log(`\nF7B-CARRY-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF7B-CARRY-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    } finally {
        global.fetch = fetchOriginal;
        try {
            const db = require('../config/db');
            await db.end();
        } catch (_) {}
        process.exit(process.exitCode || 0);
    }
})();
