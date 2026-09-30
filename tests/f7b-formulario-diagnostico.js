// tests/f7b-formulario-diagnostico.js — Formulario multiple-choice F7B.
// Uso: node tests/f7b-formulario-diagnostico.js
// - Ollama SIMULADO (stub de fetch). Sin Ollama real.
// - MySQL real solo en lectura (SELECT de servicios, como F7-B/F7B-DURO).
// - Motor y manuales reales (Heladera para integración, Lavarropas para
//   validación/fusión genérica sin hardcodear claves en el test más allá
//   de los datos del propio manual).
// NO toca turnos/pagos/agenda/auth, NO crea fixtures, NO modifica DB,
// NO modifica ningún test existente.
require('dotenv').config();
console.log('[F7B-FORM] FILE-START');

// ANTES de importar el controller: sin precalentamiento de embeddings.
process.env.CHAT_SIN_EMBEDDINGS = '1';

const assert = require('assert');
const path = require('path');

const chat = require('../controllers/chatController');
console.log('[F7B-FORM] CHAT-REQUIRE-OK');
const motor = require('../utils/motorDiagnostico');
console.log('[F7B-FORM] MOTOR-REQUIRE-OK');

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

const CUERPO_BASE = {
    equipoSeleccionado: 'Heladera',
    fallaSeleccionada: 'No enfría'
};

(async () => {
    const fetchOriginal = global.fetch;
    // Ollama simulado: redacta sin decidir (el motor ya decidió).
    global.fetch = async () => ({
        ok: true,
        json: async () => ({ response: 'Pregunta redactada simulada.' })
    });

    try {
        const manualLav = motor.cargarManual(RUTA_LAVARROPAS);

        // A. Rama de pregunta devuelve preguntaDiagnostico genérico.
        const capA = {};
        await chat.handleChat(
            { body: { ...CUERPO_BASE, mensaje: 'No enfría.', historial: [] } },
            mockRes(capA)
        );
        assert.strictEqual(capA.codigo, 200, 'pregunta responde 200');
        const bloque = capA.cuerpo.preguntaDiagnostico;
        assert.ok(bloque, 'bloque presente');
        assert.strictEqual(bloque.clave, 'luz_interior', 'clave del motor');
        assert.strictEqual(typeof bloque.pregunta, 'string', 'texto pregunta');
        assert.strictEqual(typeof bloque.objetivo, 'string', 'objetivo');
        assert.strictEqual(bloque.tipo, 'booleano', 'tipo');
        assert.deepStrictEqual(
            bloque.opciones,
            [{ valor: true, texto: 'Sí' }, { valor: false, texto: 'No' }],
            'exactamente Sí/No'
        );
        // Contrato anterior intacto.
        assert.strictEqual(capA.cuerpo.mostrarFormulario, false, 'sin cierre');
        assert.strictEqual(typeof capA.cuerpo.respuesta, 'string', 'texto redactado');
        ok('A-pregunta-booleana');

        // B. Click TRUE llega al motor (unitario + integración sin texto).
        const fusB = chat.incorporarRespuestaEstructurada(
            manualLav, {}, { clave: 'tambor_gira_lavado', valor: true }
        );
        assert.strictEqual(fusB.aplicada, true, 'fusión aplicada');
        assert.deepStrictEqual(fusB.datos, { tambor_gira_lavado: true }, 'dato incorporado');
        const capB = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: '',
                    historial: [{ rol: 'usuario', contenido: 'Quiero diagnosticar esta falla.' }],
                    respuestaEstructurada: { clave: 'luz_interior', valor: true }
                }
            },
            mockRes(capB)
        );
        assert.strictEqual(capB.codigo, 200, 'click sin texto aceptado');
        assert.notStrictEqual(
            capB.cuerpo.preguntaDiagnostico && capB.cuerpo.preguntaDiagnostico.clave,
            'luz_interior',
            'el motor recibió luz=true y no la repregunta'
        );
        ok('B-click-true');

        // C. Click FALSE.
        const fusC = chat.incorporarRespuestaEstructurada(
            manualLav, { tambor_gira_lavado: true }, { clave: 'tambor_gira_lavado', valor: false }
        );
        assert.deepStrictEqual(fusC.datos, { tambor_gira_lavado: false }, 'false incorporado');
        ok('C-click-false');

        // D. Clave inválida se rechaza sin alterar el diagnóstico.
        const valD = chat.validarRespuestaEstructurada(
            manualLav, { clave: 'causa_inventada', valor: true }
        );
        assert.strictEqual(valD.ok, false, 'clave inventada rechazada');
        const capD = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: 'La luz prende.',
                    historial: [],
                    respuestaEstructurada: { clave: 'causa_inventada', valor: true }
                }
            },
            mockRes(capD)
        );
        assert.strictEqual(capD.codigo, 200, 'turno con clave inválida sigue 200');
        assert.notStrictEqual(
            capD.cuerpo.preguntaDiagnostico && capD.cuerpo.preguntaDiagnostico.clave,
            'luz_interior',
            'el texto manda; lo inválido no altera'
        );
        ok('D-clave-invalida');

        // E. Tipo inválido ("si" string) se rechaza.
        const valE = chat.validarRespuestaEstructurada(
            manualLav, { clave: 'tambor_gira_lavado', valor: 'si' }
        );
        assert.strictEqual(valE.ok, false, '"si" string rechazado');
        assert.strictEqual(
            chat.validarRespuestaEstructurada(manualLav, { clave: 'tambor_gira_lavado', valor: 1 }).ok,
            false,
            '1 numérico rechazado'
        );
        ok('E-tipo-invalido');

        // F. Texto libre intacto (extractor sin cambios).
        const capF = {};
        await chat.handleChat(
            { body: { ...CUERPO_BASE, mensaje: 'Sí, prende la luz.', historial: [] } },
            mockRes(capF)
        );
        assert.strictEqual(capF.codigo, 200, 'texto libre 200');
        assert.notStrictEqual(
            capF.cuerpo.preguntaDiagnostico && capF.cuerpo.preguntaDiagnostico.clave,
            'luz_interior',
            'texto libre extrae igual que antes'
        );
        ok('F-texto-libre');

        // G. Sin duplicación: click no genera mensaje textual (una sola clave).
        const fusG = chat.incorporarRespuestaEstructurada(
            manualLav, {}, { clave: 'tambor_gira_lavado', valor: true }
        );
        assert.deepStrictEqual(Object.keys(fusG.datos), ['tambor_gira_lavado'], 'una sola clave');
        ok('G-sin-duplicacion');

        // H. Precedencia: estructurada pisa texto en la misma clave.
        const fusH = chat.incorporarRespuestaEstructurada(
            manualLav,
            { tambor_gira_lavado: false },
            { clave: 'tambor_gira_lavado', valor: true }
        );
        assert.deepStrictEqual(fusH.datos, { tambor_gira_lavado: true }, 'prevalece estructurada');
        ok('H-precedencia');

        // I. Cierre intacto (5.º turno con estructurada, Ollama simula "?").
        const historialCierre = [
            { rol: 'usuario', contenido: 'Quiero diagnosticar esta falla.' },
            { rol: 'asistente', contenido: 'Pregunta uno.' },
            { rol: 'usuario', contenido: 'La luz prende.' },
            { rol: 'asistente', contenido: 'Pregunta dos.' },
            { rol: 'usuario', contenido: 'El freezer tampoco enfría.' },
            { rol: 'asistente', contenido: 'Pregunta tres.' },
            { rol: 'usuario', contenido: 'No se escucha el motor.' }
        ];
        const capI = {};
        await chat.handleChat(
            {
                body: {
                    ...CUERPO_BASE,
                    mensaje: '',
                    historial: historialCierre,
                    respuestaEstructurada: { clave: 'clic_arranque', valor: true }
                }
            },
            mockRes(capI)
        );
        assert.strictEqual(capI.codigo, 200, 'cierre 200');
        assert.strictEqual(capI.cuerpo.mostrarFormulario, true, 'cierre con formulario');
        assert.ok(capI.cuerpo.resumenParaFormulario, 'con resumen');
        assert.strictEqual(capI.cuerpo.listo, true, 'compat listo');
        assert.strictEqual(typeof capI.cuerpo.whatsappUrl, 'string', 'compat url');
        assert.strictEqual(capI.cuerpo.preguntaDiagnostico, null, 'bloque null explícito en cierre');
        ok('I-cierre');

        // J. Request legacy sin respuestaEstructurada funciona igual.
        const capJ = {};
        await chat.handleChat(
            { body: { ...CUERPO_BASE, mensaje: 'No enfría.', historial: [] } },
            mockRes(capJ)
        );
        assert.strictEqual(capJ.codigo, 200, 'legacy 200');
        assert.ok(capJ.cuerpo.preguntaDiagnostico, 'bloque aditivo presente igual');
        assert.strictEqual(typeof capJ.cuerpo.respuesta, 'string', 'respuesta');
        assert.strictEqual('respuestaEstructurada' in capJ.cuerpo, false, 'sin eco del campo');
        ok('J-legacy');

        console.log(`\nF7B-FORM-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF7B-FORM-TEST-FAIL:${error.message}`);
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
