// tests/f6c-chat.js - Suite F6-C: flujo corto de chat y derivacion a WhatsApp.
// Uso: node tests/f6c-chat.js
// Solo tests unitarios de helpers puros + validacion 400 del endpoint.
// NO requiere Ollama corriendo, NO escribe en DB, NO toca datos reales,
// NO imprime secretos.
require('dotenv').config();

const assert = require('assert');

const {
    handleChat,
    limpiarTexto,
    normalizarHistorial,
    contarMensajesUsuario,
    extraerCierre,
    construirWhatsappUrl,
    MAX_PREGUNTAS,
    CIERRE_MARCA
} = require('../controllers/chatController');

let pasados = 0;
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};

(async () => {
    try {
        // 1. Constantes del flujo corto.
        assert.strictEqual(MAX_PREGUNTAS, 4, 'tope de 4 preguntas');
        assert.strictEqual(CIERRE_MARCA, 'CIERRE:', 'marca de cierre');
        ok('constantes-flujo-corto');

        // 2. limpiarTexto: trim, tope y no-string.
        assert.strictEqual(limpiarTexto('  hola  ', 100), 'hola', 'trim');
        assert.strictEqual(limpiarTexto('abcdef', 3), 'abc', 'tope');
        assert.strictEqual(limpiarTexto(null, 10), '', 'no-string');
        assert.strictEqual(limpiarTexto(42, 10), '', 'numero');
        ok('limpiar-texto');

        // 3. normalizarHistorial: roles validos, tope 12, sin vacios.
        const largo = [];
        for (let i = 0; i < 20; i += 1) {
            largo.push({ rol: 'usuario', contenido: `m${i}` });
        }
        const norm = normalizarHistorial(largo);
        assert.strictEqual(norm.length, 12, 'tope 12');
        assert.strictEqual(norm[0].contenido, 'm8', 'ventana final');
        const mixto = normalizarHistorial([
            { rol: 'usuario', contenido: '  tengo un samsung  ' },
            { rol: 'sistema', contenido: 'ignorado' },
            { rol: 'asistente', contenido: '   ' },
            { rol: 'asistente', contenido: '¿qué modelo es?' },
            null,
            { rol: 'usuario' }
        ]);
        assert.deepStrictEqual(mixto, [
            { rol: 'usuario', contenido: 'tengo un samsung' },
            { rol: 'asistente', contenido: '¿qué modelo es?' }
        ], 'filtra roles y vacios');
        assert.deepStrictEqual(normalizarHistorial('no-es-arreglo'), [], 'no-array');
        ok('normalizar-historial');

        // 4. contarMensajesUsuario: previos + actual.
        assert.strictEqual(contarMensajesUsuario([]), 1, 'primer mensaje');
        assert.strictEqual(
            contarMensajesUsuario([
                { rol: 'usuario', contenido: 'a' },
                { rol: 'asistente', contenido: 'b' },
                { rol: 'usuario', contenido: 'c' }
            ]),
            3,
            'dos previos + actual'
        );
        assert.strictEqual(contarMensajesUsuario(null), 1, 'historial nulo');
        ok('contar-mensajes-usuario');

        // 5. extraerCierre: sin marca no hay cierre.
        const sinCierre = extraerCierre('¿Qué marca es tu heladera?');
        assert.strictEqual(sinCierre.listo, false, 'sin marca');
        assert.strictEqual(sinCierre.resumen, null, 'sin resumen');
        assert.strictEqual(sinCierre.texto, '¿Qué marca es tu heladera?', 'texto intacto');
        ok('sin-cierre');

        // 6. extraerCierre: marca final se separa del texto visible.
        const conCierre = extraerCierre(
            'Suena a un problema del termostato, hay que revisarlo.\n' +
            'CIERRE: Heladera con falla de enfriamiento, posible termostato.'
        );
        assert.strictEqual(conCierre.listo, true, 'cierre detectado');
        assert.strictEqual(
            conCierre.resumen,
            'Heladera con falla de enfriamiento, posible termostato.',
            'resumen extraido'
        );
        assert.ok(!conCierre.texto.includes('CIERRE:'), 'marca fuera del texto');
        assert.ok(conCierre.texto.includes('termostato'), 'orientacion visible');
        ok('cierre-detectado');

        // 7. extraerCierre: marca vacia o intermedia no rompe.
        const vacio = extraerCierre('Texto visible.\nCIERRE:   ');
        assert.strictEqual(vacio.listo, true, 'marca presente');
        assert.strictEqual(vacio.resumen, null, 'resumen vacio -> null');
        assert.strictEqual(vacio.texto, 'Texto visible.', 'texto limpio');
        const largo2 = extraerCierre(`Linea 1.\nCIERRE: ${'x'.repeat(500)}`);
        assert.ok(largo2.resumen.length <= 255, 'resumen acotado');
        ok('cierre-bordes');

        // 8. construirWhatsappUrl: forma wa.me con resumen codificado.
        if (process.env.WHATSAPP_NUMBER) {
            const url = construirWhatsappUrl(
                'Heladera',
                'No enfría',
                'Heladera que no enfría, posible termostato.'
            );
            assert.ok(
                url.startsWith(`https://wa.me/${process.env.WHATSAPP_NUMBER}?text=`),
                'usa numero de .env sin hardcodear'
            );
            const texto = decodeURIComponent(url.split('?text=')[1]);
            assert.ok(texto.includes('Heladera'), 'lleva equipo');
            assert.ok(texto.includes('No enfría'), 'lleva falla');
            assert.ok(texto.includes('posible termostato'), 'lleva resumen');
            ok('whatsapp-url');
        } else {
            assert.strictEqual(
                construirWhatsappUrl('H', 'F', 'R'),
                null,
                'sin numero no inventa URL'
            );
            ok('whatsapp-url-sin-numero');
        }

        // 9. handleChat valida parametros sin tocar DB ni Ollama.
        const reqVacio = { body: {} };
        let codigo = null;
        let cuerpo = null;
        const resFalso = {
            status: (c) => {
                codigo = c;
                return { json: (o) => { cuerpo = o; } };
            }
        };
        await handleChat(reqVacio, resFalso);
        assert.strictEqual(codigo, 400, 'faltan parametros 400');
        assert.ok(cuerpo && typeof cuerpo.error === 'string', 'error controlado');
        ok('validacion-400');

        // 10. Compatibilidad: handleChat sigue exportado para chatRoutes.
        assert.strictEqual(typeof handleChat, 'function', 'export intacto');
        ok('export-compatible');

        console.log(`\nF6C-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF6C-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    }

    // Esta suite no abre consultas, pero el pool de config/db queda abierto
    // al importar el controlador. Se espera a la verificacion inicial para
    // cerrar limpio sin mensajes espurios.
    try {
        await new Promise((r) => setTimeout(r, 1500));
        const db = require('../config/db');
        await db.end();
    } catch (_) {}
})();
