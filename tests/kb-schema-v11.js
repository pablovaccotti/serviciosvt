// tests/kb-schema-v11.js — Suite ETAPA 1: schema v1.1 + manual piloto
// Lavarropas → No centrifuga. Solo validación y motor existente.
// Uso: node tests/kb-schema-v11.js
// 100% puro: SIN MySQL, SIN Ollama, SIN embeddings, SIN fixtures.
// Procedencia del conocimiento:
// - CONFIRMADO (conocimiento original): desbalanceo como causa de
//   "no centrifuga"; filtro/bomba, blocapuertas, correa, capacitor/zumbido,
//   plaqueta y códigos de display como conceptos del catálogo; variantes
//   frontal/superior; no inducir reparaciones.
// - PROPUESTA PARA VALIDAR: vincular desagote/blocapuertas/correa/
//   motor-capacitor/placa como causas DE "no centrifuga"; las 7 preguntas y
//   sus objetivos; todos los sinonimos; todas las reglas "disminuye"; todos
//   los detalle de soluciones; servicios_ids [] (sin filas MySQL aún).
// NO modifica ningún test existente.
const assert = require('assert');
const path = require('path');

const motor = require('../utils/motorDiagnostico');

const RUTA_HELADERA = path.join(
    __dirname,
    '..',
    'knowledge',
    'diagnostico_heladera_no_enfria.json'
);
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

try {
    const heladera = motor.cargarManual(RUTA_HELADERA);
    const lavarropas = motor.cargarManual(RUTA_LAVARROPAS);

    // A. Manual v1.0 de Heladera sigue validando (compatibilidad atrás).
    assert.strictEqual(motor.validarManual(heladera).ok, true, 'heladera v1.0 válida');
    ok('A-heladera-v10-valida');

    // B. Manual Lavarropas v1.1 valida.
    const validacion = motor.validarManual(lavarropas);
    assert.strictEqual(validacion.ok, true, `lavarropas v1.1 válido: ${validacion.errores.join(' ')}`);
    assert.strictEqual(lavarropas.equipo, 'Lavarropas', 'equipo');
    assert.strictEqual(lavarropas.problema, 'No centrifuga', 'problema');
    assert.strictEqual(lavarropas.datos_observables.length, 8, '8 datos');
    assert.strictEqual(lavarropas.causas.length, 6, '6 causas');
    ok('B-lavarropas-v11-valida');

    // C. sinonimos acepta array de strings; inválido se rechaza.
    const copia = JSON.parse(JSON.stringify(lavarropas));
    assert.strictEqual(motor.validarManual(copia).ok, true, 'sinonimos válidos');
    copia.datos_observables[0].sinonimos = ['agua', 42];
    assert.strictEqual(motor.validarManual(copia).ok, false, 'sinonimos con número se rechaza');
    ok('C-sinonimos');

    // D. peso ausente equivale a 1: evaluarCausas da idéntico resultado con
    // y sin peso (el scoring no lo lee en etapa 1).
    const sinPeso = JSON.parse(JSON.stringify(lavarropas));
    for (const causa of sinPeso.causas) {
        for (const regla of causa.evidencia) { delete regla.peso; }
    }
    const datos = { queda_agua_tambor: true, ropa_amontonada: false };
    const conPeso = motor.evaluarCausas(lavarropas, datos);
    const sinPesoEv = motor.evaluarCausas(sinPeso, datos);
    assert.deepStrictEqual(
        conPeso.map((c) => [c.id, c.nivel, c.puntuacion]),
        sinPesoEv.map((c) => [c.id, c.nivel, c.puntuacion]),
        'peso ausente ≡ peso 1'
    );
    ok('D-peso-ausente-equivale-1');

    // E. peso:1 mantiene comportamiento (no altera niveles del caso ejemplo).
    const niveles = Object.fromEntries(conPeso.map((c) => [c.id, c.nivel]));
    assert.strictEqual(niveles.problema_desagote, 'alta', 'desagote en alta con agua');
    assert.strictEqual(niveles.desbalanceo_carga, 'baja', 'desbalanceo descartado con agua y sin amontonamiento');
    assert.notStrictEqual(niveles.placa_electronica, 'alta', 'placa no afirmada sin código');
    ok('E-peso-1-mantiene-comportamiento');

    // F. soluciones valida correctamente (tipos); inválida se rechaza.
    const copiaSol = JSON.parse(JSON.stringify(lavarropas));
    assert.strictEqual(motor.validarManual(copiaSol).ok, true, 'soluciones válidas');
    copiaSol.causas[0].soluciones = [{ accion: '', detalle: 'x', requiere_visita: 'si', servicios_ids: [] }];
    assert.strictEqual(motor.validarManual(copiaSol).ok, false, 'solución inválida se rechaza');
    ok('F-soluciones');

    // G. aplica_variantes referencia solo variantes existentes.
    for (const causa of lavarropas.causas) {
        assert.ok(
            (causa.aplica_variantes || []).every((v) => ['carga_frontal', 'carga_superior'].includes(v)),
            `variantes válidas en ${causa.id}`
        );
    }
    ok('G-aplica-variantes-validas');

    // H. aplica_variantes inválido es rechazado.
    const copiaVar = JSON.parse(JSON.stringify(lavarropas));
    copiaVar.causas[0].aplica_variantes = ['carga_frontal', 'industrial'];
    assert.strictEqual(motor.validarManual(copiaVar).ok, false, 'variante inexistente se rechaza');
    ok('H-aplica-variantes-invalida-rechazada');

    // I. precio/garantía en el JSON continúa siendo rechazado.
    const copiaCom = JSON.parse(JSON.stringify(lavarropas));
    copiaCom.causas[0].soluciones[0].precio = 1000;
    assert.strictEqual(motor.validarManual(copiaCom).ok, false, 'precio en JSON se rechaza');
    ok('I-precio-garantia-rechazados');

    // J. El motor existente elige igual con Heladera (scoring intacto).
    const pasoH = motor.paso(heladera, {});
    assert.strictEqual(pasoH.tipo, 'pregunta', 'pregunta al inicio');
    assert.strictEqual(pasoH.pregunta.clave, 'luz_interior', 'primera pregunta intacta');
    const pasoL = motor.paso(lavarropas, {});
    assert.strictEqual(pasoL.tipo, 'pregunta', 'lavarropas pregunta al inicio');
    assert.strictEqual(pasoL.pregunta.clave, 'tambor_gira_lavado', 'pregunta más discriminante primera');
    ok('J-motor-seleccion-intacta');

    console.log(`\nKB-SCHEMA-TESTS-OK:${pasados}`);
} catch (error) {
    console.error(`\nKB-SCHEMA-TEST-FAIL:${error.message}`);
    process.exitCode = 1;
}
