// tests/f7b-cierre-compat.js — Suite F7B-cierre: compatibilidad de cierre
// listo/whatsappUrl (contrato F6-C, aditivo) sobre el contrato F7B
// (mostrarFormulario/resumenParaFormulario), + endurecimiento mínimo del
// piloto (esCasoPiloto con falla opcional, extracción filtrada por manual).
// Uso: node tests/f7b-cierre-compat.js
// 100% puro: SIN MySQL, SIN Ollama, SIN embeddings
// (CHAT_SIN_EMBEDDINGS=1 desactiva el precalentamiento al importar).
// NO toca turnos/pagos/agenda/auth, NO crea fixtures, NO modifica DB.
require('dotenv').config();
console.log('[F7B-CIERRE] FILE-START');

// ANTES de importar el controller: sin precalentamiento de embeddings.
process.env.CHAT_SIN_EMBEDDINGS = '1';

const assert = require('assert');
const path = require('path');

const chat = require('../controllers/chatController');
console.log('[F7B-CIERRE] CHAT-REQUIRE-OK');
const motor = require('../utils/motorDiagnostico');
console.log('[F7B-CIERRE] MOTOR-REQUIRE-OK');

const RUTA_MANUAL = path.join(
    __dirname,
    '..',
    'knowledge',
    'diagnostico_heladera_no_enfria.json'
);

let pasados = 0;
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};

try {
    // 1. construirWhatsappUrl: número de .env, nunca hardcodeado, nunca 500.
    const numeroOriginal = process.env.WHATSAPP_NUMBER;
    process.env.WHATSAPP_NUMBER = '5491100000000';
    const url = chat.construirWhatsappUrl('Hola ServiceVT!');
    assert.ok(
        url.startsWith('https://wa.me/5491100000000?text='),
        'usa el número de entorno'
    );
    assert.ok(
        url.includes(encodeURIComponent('Hola ServiceVT!')),
        'texto codificado'
    );
    process.env.WHATSAPP_NUMBER = '';
    assert.strictEqual(
        chat.construirWhatsappUrl('Hola'),
        null,
        'sin número → null (nunca 500)'
    );
    if (numeroOriginal === undefined) {
        delete process.env.WHATSAPP_NUMBER;
    } else {
        process.env.WHATSAPP_NUMBER = numeroOriginal;
    }
    ok('whatsapp-url-desde-env');

    // 2. camposCierreCompat: espejo de mostrarFormulario.
    assert.deepStrictEqual(
        chat.camposCierreCompat(false, 'x'),
        { listo: false, whatsappUrl: null },
        'pregunta en curso → sin cierre'
    );
    const sinNumero = process.env.WHATSAPP_NUMBER;
    process.env.WHATSAPP_NUMBER = '';
    const cierreSinNumero = chat.camposCierreCompat(true, 'Hola');
    assert.strictEqual(cierreSinNumero.listo, true, 'cierre marcado');
    assert.strictEqual(
        cierreSinNumero.whatsappUrl,
        null,
        'cierre sin número → url null, sin error'
    );
    process.env.WHATSAPP_NUMBER = '5491100000000';
    const cierreConNumero = chat.camposCierreCompat(true, 'Hola');
    assert.strictEqual(cierreConNumero.listo, true, 'cierre marcado');
    assert.ok(
        typeof cierreConNumero.whatsappUrl === 'string' &&
            cierreConNumero.whatsappUrl.startsWith('https://wa.me/'),
        'cierre con número → url válida'
    );
    if (sinNumero === undefined) {
        delete process.env.WHATSAPP_NUMBER;
    } else {
        process.env.WHATSAPP_NUMBER = sinNumero;
    }
    ok('cierre-compat-espejo');

    // 3. esCasoPiloto: 1 arg (compat F7-B) + 2 args con falla opcional.
    assert.strictEqual(chat.esCasoPiloto('Heladera'), true, 'piloto heladera');
    assert.strictEqual(
        chat.esCasoPiloto('Heladera', 'No enfría'),
        true,
        'equipo + falla del manual'
    );
    assert.strictEqual(
        chat.esCasoPiloto('Heladera', 'NO ENFRIA'),
        true,
        'comparación normalizada'
    );
    assert.strictEqual(
        chat.esCasoPiloto('Heladera', 'No centrifuga'),
        false,
        'falla de otro manual no entra al piloto'
    );
    assert.strictEqual(chat.esCasoPiloto('Lavarropas'), false, 'no lavarropas');
    assert.strictEqual(
        chat.esCasoPiloto('Aire Acondicionado'),
        false,
        'no aire'
    );
    ok('piloto-equipo-y-falla');

    // 4. Extracción filtrada por el esquema del manual (usa `manual`).
    const manual = motor.cargarManual(RUTA_MANUAL);
    const conClaveAjena = chat.extraerDatosDiagnostico(
        { datos_observables: [{ clave: 'luz_interior' }] },
        [],
        'No enfría, la luz prende y el freezer tampoco enfría.'
    );
    assert.strictEqual(
        conClaveAjena.luz_interior,
        true,
        'clave del esquema se extrae'
    );
    assert.strictEqual(
        conClaveAjena.freezer_enfria,
        undefined,
        'clave fuera del esquema se descarta'
    );
    const real = chat.extraerDatosDiagnostico(
        manual,
        [],
        'La luz prende pero el freezer no enfría.'
    );
    assert.strictEqual(real.luz_interior, true, 'luz con manual real');
    assert.strictEqual(real.freezer_enfria, false, 'freezer con manual real');
    ok('extraccion-filtrada-por-manual');

    // 5. handleChat valida parámetros sin tocar Ollama ni DB (contrato).
    (async () => {
        let codigo = null;
        await chat.handleChat(
            { body: {} },
            { status: (c) => { codigo = c; return { json: () => {} }; } }
        );
        assert.strictEqual(codigo, 400, '400 sin parámetros');
        ok('validacion-400');
        console.log(`\nF7B-CIERRE-TESTS-OK:${pasados}`);
    })().catch((error) => {
        console.error(`\nF7B-CIERRE-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    }).finally(async () => {
        // Cierre explícito: el pool de MySQL puede mantener el event loop
        // vivo; el test ya terminó (mismo patrón que f7b-chat-diagnostico).
        try {
            const db = require('../config/db');
            await db.end();
        } catch (_) {}
        process.exit(process.exitCode || 0);
    });
} catch (error) {
    console.error(`\nF7B-CIERRE-TEST-FAIL:${error.message}`);
    process.exitCode = 1;
}
