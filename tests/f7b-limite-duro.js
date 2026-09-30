// tests/f7b-limite-duro.js — Límite duro INTERCAMBIOS_MAXIMO=5 (flujo genérico).
// Uso: node tests/f7b-limite-duro.js
// - MySQL real solo en lectura (SELECT de servicios, como F7-B etapas 5-6).
// - Ollama SIMULADO: se reemplaza global.fetch con respuesta fija terminada
//   en "?" para probar que el "?" no suprime el cierre en el máximo.
// - Caso 1: 5 intercambios reales + Ollama "?" → cierre obligatorio
//   (mostrarFormulario true + resumenParaFormulario + texto determinístico).
// - Caso 2: 3 intercambios (zona objetivo) + Ollama "?" → comportamiento
//   actual (mostrarFormulario false, sin cierre forzado por ese motivo).
// NO toca turnos/pagos/agenda/auth, NO crea fixtures, NO modifica DB.
require('dotenv').config();
console.log('[F7B-DURO] FILE-START');

// ANTES de importar el controller: sin precalentamiento de embeddings.
process.env.CHAT_SIN_EMBEDDINGS = '1';

const assert = require('assert');

const chat = require('../controllers/chatController');
console.log('[F7B-DURO] CHAT-REQUIRE-OK');

const PREGUNTA_SIMULADA = '¿Pregunta simulada de Ollama para probar el límite?';
const CIERRE_DETERMINISTICO = 'Con lo que me contaste ya tengo una primera orientación del problema.';

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

(async () => {
    const fetchOriginal = global.fetch;
    // Ollama simulado: siempre responde una pregunta (termina en "?").
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ response: PREGUNTA_SIMULADA })
    });

    try {
        // Caso 1: 4 mensajes previos de cliente + actual = 5 reales.
        const historial5 = [
            { rol: 'usuario', contenido: 'Quiero diagnosticar esta falla.' },
            { rol: 'asistente', contenido: 'Respuesta uno del asistente.' },
            { rol: 'usuario', contenido: 'no prende' },
            { rol: 'asistente', contenido: 'Respuesta dos del asistente.' },
            { rol: 'usuario', contenido: 'no prende de nuevo' },
            { rol: 'asistente', contenido: 'Respuesta tres del asistente.' },
            { rol: 'usuario', contenido: 'marca bgh modelo fr2342' }
        ];
        const cap1 = {};
        await chat.handleChat(
            {
                body: {
                    equipoSeleccionado: 'Aire Acondicionado',
                    fallaSeleccionada: 'No enciende',
                    mensaje: 'no habia olor',
                    historial: historial5
                }
            },
            mockRes(cap1)
        );
        assert.strictEqual(cap1.codigo, 200, 'cierre responde 200');
        assert.strictEqual(
            cap1.cuerpo.mostrarFormulario,
            true,
            '5 intercambios + ? → mostrarFormulario true'
        );
        assert.strictEqual(cap1.cuerpo.listo, true, 'compat listo true');
        assert.ok(
            cap1.cuerpo.resumenParaFormulario,
            '5 intercambios + ? → con resumenParaFormulario'
        );
        assert.ok(
            typeof cap1.cuerpo.respuesta === 'string' &&
                cap1.cuerpo.respuesta.includes(CIERRE_DETERMINISTICO) &&
                !cap1.cuerpo.respuesta.trim().endsWith('?'),
            '5 intercambios + ? → texto de cierre determinístico, sin sexta pregunta'
        );
        ok('maximo-prevalece-sobre-pregunta');

        // Caso 2: 2 mensajes previos de cliente + actual = 3 (zona objetivo).
        const historial3 = [
            { rol: 'usuario', contenido: 'Quiero diagnosticar esta falla.' },
            { rol: 'asistente', contenido: 'Respuesta uno del asistente.' },
            { rol: 'usuario', contenido: 'no prende' }
        ];
        const cap2 = {};
        await chat.handleChat(
            {
                body: {
                    equipoSeleccionado: 'Aire Acondicionado',
                    fallaSeleccionada: 'No enciende',
                    mensaje: 'sigue sin prender',
                    historial: historial3
                }
            },
            mockRes(cap2)
        );
        assert.strictEqual(cap2.codigo, 200, 'zona objetivo responde 200');
        assert.strictEqual(
            cap2.cuerpo.mostrarFormulario,
            false,
            '3 intercambios + ? → sin cierre forzado (comportamiento actual)'
        );
        assert.strictEqual(
            cap2.cuerpo.resumenParaFormulario,
            undefined,
            '3 intercambios + ? → sin resumen'
        );
        ok('objetivo-permite-pregunta');

        console.log(`\nF7B-DURO-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF7B-DURO-TEST-FAIL:${error.message}`);
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
