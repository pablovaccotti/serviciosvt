// tests/f7b-chat-diagnostico.js — Suite F7-B: piloto Heladera → No enfría
// gobernado por el motor determinístico, Ollama solo redacta.
// Uso: node tests/f7b-chat-diagnostico.js
//
// Dependencias por etapa (ver logs [F7B]):
// - Etapas 1-4, 7-11: 100% puras (motor + helpers). Sin MySQL/Ollama/embeddings.
// - Etapas 5-6: MySQL real (obtenerServiciosPorIds). Sin Ollama/embeddings.
// - Ninguna etapa llama a consultarOllama: la redacción viva se verifica
//   manual contra Ollama local (integración externa, fuera de esta suite).
// - CHAT_SIN_EMBEDDINGS=1 desactiva el precalentamiento del índice al
//   importar el controller (side-effect solo de producción). El piloto no
//   necesita el índice para estas pruebas.
// NO toca turnos/pagos/agenda/auth, NO crea fixtures, NO modifica DB.
require('dotenv').config();
console.log('[F7B] FILE-START');

// ANTES de importar el controller: sin precalentamiento de embeddings.
process.env.CHAT_SIN_EMBEDDINGS = '1';

const assert = require('assert');
const path = require('path');

const chat = require('../controllers/chatController');
console.log('[F7B] CHAT-REQUIRE-OK');
const motor = require('../utils/motorDiagnostico');
console.log('[F7B] MOTOR-REQUIRE-OK');

const RUTA_MANUAL = path.join(
    __dirname,
    '..',
    'knowledge',
    'diagnostico_heladera_no_enfria.json'
);

let pasados = 0;
const etapa = (n, desc) => console.log(`[F7B] etapa ${n}: ${desc}...`);
const ok = (nombre) => {
    pasados += 1;
    console.log(`PASS:${nombre}`);
};
(async () => {
    try {
        etapa(0, 'carga del manual piloto');
        const manual = motor.cargarManual(RUTA_MANUAL);

        // 1. El piloto se activa solo para Heladera (otros equipos: flujo genérico).
        etapa(1, 'activación solo Heladera');
        assert.strictEqual(chat.esCasoPiloto('Heladera'), true, 'piloto heladera');
        assert.strictEqual(chat.esCasoPiloto('Lavarropas'), false, 'no lavarropas');
        assert.strictEqual(
            chat.esCasoPiloto('Aire Acondicionado'),
            false,
            'no aire'
        );
        ok('piloto-solo-heladera');

        // 2. Primera pregunta viene del motor (no de Ollama).
        etapa(2, 'primera pregunta del motor');
        const datosVacios = chat.extraerDatosDiagnostico(manual, [], 'No enfría.');
        assert.deepStrictEqual(datosVacios, {}, 'sin datos inventados');
        const inicio = motor.paso(manual, datosVacios);
        assert.strictEqual(inicio.tipo, 'pregunta', 'el motor pregunta');
        assert.strictEqual(
            inicio.pregunta.clave,
            'luz_interior',
            'pregunta del manual/motor'
        );
        ok('primera-pregunta-del-motor');

        // 3. Respuesta confirmada no vuelve a preguntarse (ni reformulada).
        etapa(3, 'dato confirmado no se repregunta');
        const datosLuz = chat.extraerDatosDiagnostico(
            manual,
            [
                { rol: 'usuario', contenido: 'No enfría.' },
                { rol: 'asistente', contenido: '¿La luz interior prende?' },
                { rol: 'usuario', contenido: 'Sí, prende la luz.' }
            ],
            'La luz prende.'
        );
        assert.strictEqual(datosLuz.luz_interior, true, 'luz confirmada');
        const trasLuz = motor.paso(manual, datosLuz);
        assert.strictEqual(trasLuz.tipo, 'pregunta', 'sigue preguntando');
        assert.notStrictEqual(
            trasLuz.pregunta.clave,
            'luz_interior',
            'no repite la luz'
        );
        ok('confirmado-no-se-repregunta');

        // 4. El motor produce causas compatibles (varias, no una única).
        etapa(4, 'causas compatibles del motor');
        const ejemplo = motor.paso(manual, {
            luz_interior: true,
            compresor_se_escucha: false,
            clic_arranque: true
        });
        const niveles = Object.fromEntries(
            ejemplo.causas.map((c) => [c.id, c.nivel])
        );
        assert.strictEqual(
            niveles.sistema_arranque_termostato,
            'alta',
            'arranque en alta'
        );
        assert.ok(
            ejemplo.causas.filter((c) => c.nivel !== 'baja').length >= 2,
            'varias posibilidades'
        );
        ok('causas-compatibles');

        // 5. Los servicios_ids vienen del manual; los precios, de MySQL.
        etapa(5, 'precios desde MySQL real');
        const causasManuales = motor.evaluarCausas(manual, {
            luz_interior: true,
            compresor_se_escucha: false,
            clic_arranque: true
        });
        const idsManual = [
            ...new Set(causasManuales.flatMap((c) => c.servicios_ids))
        ].sort();
        assert.deepStrictEqual(idsManual, [3, 5], 'ids del manual');
        const servicios = await chat.obtenerServiciosPorIds(idsManual);
        assert.strictEqual(servicios.length, 2, 'existen en MySQL');
        for (const s of servicios) {
            assert.strictEqual(typeof s.precio, 'number', 'precio numérico');
            assert.ok(s.precio > 0, 'precio positivo');
            assert.strictEqual(typeof s.garantia, 'string', 'garantía texto');
            assert.strictEqual(s.equipo, 'Heladera', 'equipo heladera');
        }
        ok('precios-desde-mysql');

        // 6. IDs inexistentes o inválidos: warning + continuar, sin inventar.
        etapa(6, 'servicio inexistente sin inventar');
        const ninguno = await chat.obtenerServiciosPorIds([999999]);
        assert.deepStrictEqual(ninguno, [], 'inexistente → vacío');
        assert.deepStrictEqual(
            await chat.obtenerServiciosPorIds(['8', -1, 0, null]),
            [],
            'inválidos → vacío'
        );
        ok('servicio-inexistente-sin-inventar');

        // 7. Ollama recibe causas estructuradas con precios reales de MySQL.
        etapa(7, 'contexto estructurado para Ollama');
        const resultado = motor.resultadoPreliminar(manual, {
            luz_interior: true,
            compresor_se_escucha: false,
            clic_arranque: true
        });
        const porId = new Map(servicios.map((s) => [s.servicios_id, s]));
        const contexto = chat.construirContextoDiagnostico(resultado, porId);
        assert.ok(
            contexto.includes('sistema de arranque') ||
                contexto.includes('arranque'),
            'causa en contexto'
        );
        assert.ok(contexto.includes('Nivel: alta'), 'nivel en contexto');
        for (const s of servicios) {
            assert.ok(
                contexto.includes(`$${s.precio}`),
                `precio MySQL $${s.precio} en contexto`
            );
        }
        assert.ok(contexto.includes('RESTRICCIONES'), 'restricciones');
        assert.ok(contexto.includes('ADVERTENCIA'), 'advertencia');
        ok('contexto-estructurado-para-ollama');

        // 8. Ollama no decide: precio no autorizado y pedido de contacto se detectan.
        etapa(8, 'validadores anti-alucinación');
        assert.strictEqual(
            chat.respuestaContienePrecioNoAutorizado(
                'Te sale $999999.',
                servicios.map((s) => s.precio)
            ),
            true,
            'precio inventado detectado'
        );
        assert.strictEqual(
            chat.respuestaContienePrecioNoAutorizado(
                `Sale $${servicios[0].precio}.`,
                servicios.map((s) => s.precio)
            ),
            false,
            'precio autorizado pasa'
        );
        assert.strictEqual(
            chat.respuestaPideContacto('Pasame tu teléfono para coordinar.'),
            true,
            'pedido de teléfono detectado'
        );
        assert.strictEqual(
            chat.respuestaPideContacto('¿La luz interior prende normalmente?'),
            false,
            'pregunta técnica pasa'
        );
        ok('validadores-anti-alucinacion');

        // 9. El resumen conserva lo informado por el cliente (determinístico).
        etapa(9, 'resumen determinístico seguro');
        const fallback = chat.resumenPreliminarDeterministico(resultado, porId);
        assert.ok(fallback.includes('arranque'), 'menciona causa');
        assert.ok(
            fallback.includes(`$${servicios[0].precio}`),
            'precio real en fallback'
        );
        assert.ok(
            fallback.includes('coordinación'),
            'invita a coordinar'
        );
        assert.ok(
            !chat.respuestaPideContacto(fallback),
            'el fallback no pide contacto'
        );
        const preguntaSegura = chat.preguntaDeterministica({
            pregunta: '¿Prende la luz?',
            objetivo: 'Saber si hay energía.'
        });
        assert.ok(preguntaSegura.includes('¿Prende la luz?'), 'pregunta intacta');
        ok('resumen-deterministico-seguro');

        // 10. Extracción frase por frase (sin inventar, sin NLP externo).
        etapa(10, 'extracción determinística');
        const d1 = chat.extraerDatosDiagnostico(
            manual,
            [],
            'No enfría y la luz prende.'
        );
        assert.strictEqual(d1.luz_interior, true, 'luz en frase compuesta');
        const d2 = chat.extraerDatosDiagnostico(manual, [], 'No se escucha el motor.');
        assert.strictEqual(d2.compresor_se_escucha, false, 'motor detenido');
        const d3 = chat.extraerDatosDiagnostico(
            manual,
            [],
            'Sí, hace clic cada tanto.'
        );
        assert.strictEqual(d3.clic_arranque, true, 'clic afirmado');
        const d4 = chat.extraerDatosDiagnostico(
            manual,
            [{ rol: 'asistente', contenido: '¿El freezer sigue enfriando?' }],
            'No, tampoco enfría.'
        );
        assert.strictEqual(d4.freezer_enfria, false, 'no solo contra pendiente');
        const d5 = chat.extraerDatosDiagnostico(
            manual,
            [],
            'La luz prende pero el freezer no enfría.'
        );
        assert.strictEqual(d5.luz_interior, true, 'cláusula 1');
        assert.strictEqual(d5.freezer_enfria, false, 'cláusula 2');
        ok('extraccion-deterministica');

        // 11. handleChat valida parámetros sin tocar Ollama (contrato intacto).
        etapa(11, 'validación 400 sin Ollama');
        let codigo = null;
        await chat.handleChat(
            { body: {} },
            { status: (c) => { codigo = c; return { json: () => {} }; } }
        );
        assert.strictEqual(codigo, 400, '400 sin parámetros');
        ok('validacion-400');

        console.log(`\nF7B-TESTS-OK:${pasados}`);
    } catch (error) {
        console.error(`\nF7B-TEST-FAIL:${error.message}`);
        process.exitCode = 1;
    }

    // Cierre explícito: el pool de MySQL y los sockets HTTP abiertos
    // (Ollama) pueden mantener el event loop vivo; el test ya terminó.
    try {
        const db = require('../config/db');
        await db.end();
    } catch (_) {}
    process.exit(process.exitCode || 0);
})();
