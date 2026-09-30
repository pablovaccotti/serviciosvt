// tests/f7a-motor-heladera.js — Suite F7-A (piloto): conocimiento estructurado
// → motor determinístico → siguiente pregunta / resultado preliminar.
// Uso: node tests/f7a-motor-heladera.js
// Tests 100% unitarios y puros: NO requieren Ollama, NO tocan MySQL,
// NO tocan chatController/index/turnos/pagos/agenda/auth, NO crean fixtures.
const assert = require('assert');
const path = require('path');

const motor = require('../utils/motorDiagnostico');

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

function buscarClavesProhibidas(valor, encontradas) {
    const prohibidas = ['precio', 'garantia', 'garantía', 'importe', 'monto'];
    if (Array.isArray(valor)) {
        valor.forEach((v) => buscarClavesProhibidas(v, encontradas));
    } else if (valor !== null && typeof valor === 'object') {
        for (const clave of Object.keys(valor)) {
            if (prohibidas.includes(clave.toLowerCase())) encontradas.push(clave);
            buscarClavesProhibidas(valor[clave], encontradas);
        }
    }
    return encontradas;
}

try {
    // 1. El manual carga y valida (equipo/problema/5 datos/5 causas/restricciones).
    const manual = motor.cargarManual(RUTA_MANUAL);
    assert.strictEqual(manual.equipo, 'Heladera', 'equipo piloto');
    assert.strictEqual(manual.problema, 'No enfría', 'problema piloto');
    assert.strictEqual(manual.datos_observables.length, 5, '5 datos observables');
    assert.strictEqual(manual.causas.length, 5, '5 causas posibles');
    assert.ok(
        manual.restricciones.length > 0 && typeof manual.advertencia === 'string',
        'restricciones + advertencia'
    );
    const validacion = motor.validarManual(manual);
    assert.strictEqual(validacion.ok, true, 'manual válido');
    ok('manual-carga-valido');

    // 2. Separación JSON/MySQL: el JSON no contiene precios ni garantías.
    const fs = require('fs');
    const crudo = JSON.parse(fs.readFileSync(RUTA_MANUAL, 'utf8'));
    assert.deepStrictEqual(
        buscarClavesProhibidas(crudo, []),
        [],
        'sin claves comerciales en el JSON'
    );
    ok('sin-precios-en-json');

    // 3. Caso del ejemplo (§13): luz + compresor detenido + clic →
    //    arranque/termostato en alta, compresor sigue presente (no se descarta).
    const ejemplo = motor.paso(manual, {
        luz_interior: true,
        compresor_se_escucha: false,
        clic_arranque: true
    });
    assert.strictEqual(ejemplo.tipo, 'pregunta', 'aún faltan datos útiles');
    const niveles = Object.fromEntries(ejemplo.causas.map((c) => [c.id, c.nivel]));
    assert.strictEqual(niveles.sistema_arranque_termostato, 'alta', 'arranque en alta');
    assert.notStrictEqual(niveles.compresor, 'baja', 'compresor no descartado');
    const relevantes = ejemplo.causas.filter((c) => c.nivel !== 'baja');
    assert.ok(relevantes.length >= 2, 'varias posibilidades, no una única causa');
    ok('caso-ejemplo-multiples-causas');

    // 4. La siguiente pregunta del ejemplo discrimina (freezer: total vs distribución).
    assert.strictEqual(
        ejemplo.pregunta.clave,
        'freezer_enfria',
        'pregunta útil, no repetida'
    );
    assert.ok(
        typeof ejemplo.pregunta.pregunta === 'string' &&
            typeof ejemplo.pregunta.objetivo === 'string',
        'pregunta con objetivo'
    );
    ok('siguiente-pregunta-util');

    // 5. Anti-repetición: un dato confirmado jamás vuelve a preguntarse.
    const combinaciones = [
        { luz_interior: true },
        { luz_interior: false },
        { luz_interior: true, freezer_enfria: true },
        { luz_interior: true, compresor_se_escucha: false, clic_arranque: true }
    ];
    for (const datos of combinaciones) {
        const r = motor.paso(manual, datos);
        if (r.tipo === 'pregunta') {
            assert.notStrictEqual(
                r.pregunta.clave,
                'luz_interior',
                `no repite luz con ${JSON.stringify(datos)}`
            );
            for (const clave of Object.keys(datos)) {
                assert.notStrictEqual(
                    r.pregunta.clave,
                    clave,
                    `no repite "${clave}" ya confirmado`
                );
            }
        }
    }
    ok('anti-repeticion');

    // 6. Sin datos, la primera pregunta es la de mayor poder discriminante.
    const inicio = motor.paso(manual, {});
    assert.strictEqual(inicio.tipo, 'pregunta', 'al inicio se pregunta');
    assert.strictEqual(inicio.pregunta.clave, 'luz_interior', 'primera pregunta');
    ok('primera-pregunta');

    // 7. Con todos los datos: no hay pregunta, hay resultado preliminar completo.
    const completo = motor.paso(manual, {
        luz_interior: true,
        freezer_enfria: false,
        compresor_se_escucha: false,
        clic_arranque: true,
        hielo_acumulado: false
    });
    assert.strictEqual(completo.tipo, 'preliminar', 'cierra sin más preguntas');
    const res = completo.resultado;
    assert.strictEqual(res.equipo, 'Heladera', 'equipo en resultado');
    assert.strictEqual(res.problema, 'No enfría', 'problema en resultado');
    assert.deepStrictEqual(
        res.datos_observados,
        {
            luz_interior: true,
            freezer_enfria: false,
            compresor_se_escucha: false,
            clic_arranque: true,
            hielo_acumulado: false
        },
        'datos observados tal cual'
    );
    assert.ok(res.causas.length === 5, 'todas las causas informadas');
    assert.ok(
        res.restricciones.length > 0 && res.advertencia.length > 0,
        'restricciones + advertencia presentes'
    );
    const primera = res.causas[0];
    assert.strictEqual(primera.id, 'sistema_arranque_termostato', 'arranque primero');
    assert.strictEqual(primera.nivel, 'alta', 'arranque en alta');
    assert.ok(primera.motivos.length >= 3, 'motivos de evidencia');
    assert.deepStrictEqual(
        [...primera.servicios_ids].sort(),
        [3, 5],
        'servicios_ids reales verificados (3 y 5)'
    );
    ok('resultado-preliminar-completo');

    // 8. Vocabulario de niveles: solo alta/media/baja, nunca "confianza" numérica.
    for (const c of res.causas) {
        assert.ok(motor.NIVELES.includes(c.nivel), `nivel válido: ${c.nivel}`);
        assert.strictEqual(c.probabilidad, undefined, 'sin probabilidad inventada');
        assert.strictEqual(c.confianza, undefined, 'sin confianza inventada');
    }
    ok('niveles-orientativos');

    // 9. Determinismo: mismo input → mismo output.
    const a = motor.paso(manual, { luz_interior: true, clic_arranque: true });
    const b = motor.paso(manual, { clic_arranque: true, luz_interior: true });
    assert.deepStrictEqual(a, b, 'determinístico ante orden de claves');
    ok('determinismo');

    // 10. Datos ambiguos o desconocidos se ignoran y se reportan.
    const raro = motor.paso(manual, {
        luz_interior: 'más o menos',
        freezer_enfria: null,
        dato_inexistente: true
    });
    assert.deepStrictEqual(raro.datos, {}, 'nada ambiguo decide');
    assert.deepStrictEqual(
        [...raro.ignorados].sort(),
        ['dato_inexistente', 'freezer_enfria', 'luz_interior'],
        'ignorados reportados'
    );
    ok('datos-ambiguos-ignorados');

    // 11. Manual inválido se rechaza con error controlado (contrato del motor).
    assert.strictEqual(motor.validarManual(null).ok, false, 'null inválido');
    assert.strictEqual(
        motor.validarManual({ equipo: 'H', problema: 'X' }).ok,
        false,
        'incompleto inválido'
    );
    try {
        motor.cargarManual(path.join(__dirname, 'no-existe.json'));
        assert.fail('debió lanzar MANUAL_NO_LEIBLE');
    } catch (e) {
        assert.strictEqual(e.code, 'MANUAL_NO_LEIBLE', 'archivo inexistente con código');
    }
    ok('manual-invalido-rechazado');

    console.log(`\nF7A-TESTS-OK:${pasados}`);
} catch (error) {
    console.error(`\nF7A-TEST-FAIL:${error.message}`);
    process.exitCode = 1;
}
