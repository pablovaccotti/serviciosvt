// utils/motorDiagnostico.js — Motor determinístico del Manual Maestro ServiceVT.
//
// Responsabilidad ÚNICA: dado un manual JSON (conocimiento técnico) y datos
// estructurados del cliente, determinar (1) cuál es la siguiente pregunta
// útil o (2) el resultado preliminar con varias posibilidades.
//
// Lo que este motor NO hace (a propósito):
// - No consulta MySQL (precios/garantías los resuelve otra capa por servicios_ids).
// - No llama a Ollama (la redacción conversacional es una capa posterior).
// - No persiste nada.
// - No inventa causas, preguntas ni servicios: todo sale del manual.
//
// Reglas de decisión (determinísticas, auditables):
// - Un dato conocido (true/false) nunca vuelve a preguntarse.
// - Cada evidencia del manual suma (+1 aumenta) o resta (-1 disminuye).
// - Nivel: puntuación > 0 → 'alta', = 0 → 'media', < 0 → 'baja'.
//   No es una probabilidad: es un conteo de indicios a favor/en contra.
// - La siguiente pregunta es el dato desconocido que más causas aún
//   relevantes (alta/media) ayuda a discriminar. Empate → orden del manual.
// - Si ningún dato desconocido discrimina, no hay siguiente pregunta:
//   corresponde resultado preliminar.

const fs = require('fs');

const NIVELES = ['alta', 'media', 'baja'];

// Claves que el manual de conocimiento NUNCA debe contener: los valores
// comerciales viven en MySQL (tabla servicios), no en el JSON.
const CLAVES_PROHIBIDAS = ['precio', 'garantia', 'garantía', 'importe', 'monto'];

function contieneClaveProhibida(valor) {
    if (Array.isArray(valor)) {
        return valor.some(contieneClaveProhibida);
    }
    if (valor !== null && typeof valor === 'object') {
        return Object.keys(valor).some(
            (clave) =>
                CLAVES_PROHIBIDAS.includes(clave.toLowerCase()) ||
                contieneClaveProhibida(valor[clave])
        );
    }
    return false;
}

function validarManual(manual) {
    const errores = [];

    if (!manual || typeof manual !== 'object' || Array.isArray(manual)) {
        return { ok: false, errores: ['El manual debe ser un objeto JSON.'] };
    }
    if (typeof manual.equipo !== 'string' || manual.equipo.trim() === '') {
        errores.push('Falta "equipo" (string no vacío).');
    }
    if (typeof manual.problema !== 'string' || manual.problema.trim() === '') {
        errores.push('Falta "problema" (string no vacío).');
    }
    if (typeof manual.advertencia !== 'string' || manual.advertencia.trim() === '') {
        errores.push('Falta "advertencia" (string no vacío).');
    }
    if (!Array.isArray(manual.restricciones)) {
        errores.push('Falta "restricciones" (array).');
    }
    if (contieneClaveProhibida(manual)) {
        errores.push(
            'El manual contiene claves comerciales prohibidas (precio/garantía): deben vivir en MySQL.'
        );
    }

    // ETAPA 1 (v1.1, opcional, inerte para el scoring): variantes del equipo.
    // Vacío/ausente = sin variantes. Los ids se usan para validar
    // "aplica_variantes" de cada causa.
    const idsVariantes = new Set();
    if (manual.variantes !== undefined) {
        if (!Array.isArray(manual.variantes)) {
            errores.push('"variantes" debe ser un array si está presente.');
        } else {
            for (const variante of manual.variantes) {
                if (!variante || typeof variante.id !== 'string' || variante.id.trim() === '') {
                    errores.push('Una variante no tiene "id" válido.');
                    continue;
                }
                if (idsVariantes.has(variante.id)) {
                    errores.push(`Id de variante duplicado: "${variante.id}".`);
                }
                idsVariantes.add(variante.id);
                if (typeof variante.etiqueta !== 'string' || variante.etiqueta.trim() === '') {
                    errores.push(`La variante "${variante.id}" no tiene "etiqueta".`);
                }
            }
        }
    }

    const claves = new Set();
    if (!Array.isArray(manual.datos_observables) || manual.datos_observables.length === 0) {
        errores.push('Faltan "datos_observables" (array no vacío).');
    } else {
        for (const dato of manual.datos_observables) {
            if (!dato || typeof dato.clave !== 'string' || dato.clave.trim() === '') {
                errores.push('Un dato observable no tiene "clave" válida.');
                continue;
            }
            if (claves.has(dato.clave)) {
                errores.push(`Clave duplicada en datos_observables: "${dato.clave}".`);
            }
            claves.add(dato.clave);
            if (typeof dato.pregunta !== 'string' || dato.pregunta.trim() === '') {
                errores.push(`El dato "${dato.clave}" no tiene "pregunta".`);
            }
            if (typeof dato.objetivo !== 'string' || dato.objetivo.trim() === '') {
                errores.push(`El dato "${dato.clave}" no tiene "objetivo".`);
            }
            // ETAPA 1 (v1.1, opcional, inerte): sinónimos de vocabulario del
            // dato. El extractor los compilará en etapa 2; el motor no los usa.
            if (dato.sinonimos !== undefined) {
                if (
                    !Array.isArray(dato.sinonimos) ||
                    dato.sinonimos.some((s) => typeof s !== 'string' || s.trim() === '')
                ) {
                    errores.push(`El dato "${dato.clave}" tiene "sinonimos" inválido (array de strings no vacíos).`);
                }
            }
        }
    }

    const ids = new Set();
    if (!Array.isArray(manual.causas) || manual.causas.length === 0) {
        errores.push('Faltan "causas" (array no vacío).');
    } else {
        for (const causa of manual.causas) {
            if (!causa || typeof causa.id !== 'string' || causa.id.trim() === '') {
                errores.push('Una causa no tiene "id" válido.');
                continue;
            }
            if (ids.has(causa.id)) {
                errores.push(`Id de causa duplicado: "${causa.id}".`);
            }
            ids.add(causa.id);
            if (typeof causa.nombre !== 'string' || causa.nombre.trim() === '') {
                errores.push(`La causa "${causa.id}" no tiene "nombre".`);
            }
            if (!Array.isArray(causa.evidencia)) {
                errores.push(`La causa "${causa.id}" no tiene "evidencia" (array).`);
            } else {
                for (const regla of causa.evidencia) {
                    if (
                        !regla ||
                        !regla.cuando ||
                        typeof regla.cuando !== 'object' ||
                        (regla.efecto !== 'aumenta' && regla.efecto !== 'disminuye') ||
                        typeof regla.motivo !== 'string' ||
                        regla.motivo.trim() === ''
                    ) {
                        errores.push(
                            `La causa "${causa.id}" tiene una regla de evidencia inválida (cuando/efecto aumenta|disminuye/motivo).`
                        );
                    } else {
                        // ETAPA 1 (v1.1, opcional, inerte para el scoring):
                        // peso entero >= 1, ausente = 1. El scoring actual no
                        // lo lee (toda evidencia vale ±1); se valida el tipo
                        // para que los manuales v1.1 sean correctos desde ahora.
                        if (
                            regla.peso !== undefined &&
                            (!Number.isInteger(regla.peso) || regla.peso < 1)
                        ) {
                            errores.push(
                                `La causa "${causa.id}" tiene una regla con "peso" inválido (entero >= 1).`
                            );
                        }
                        for (const clave of Object.keys(regla.cuando)) {
                            if (!claves.has(clave)) {
                                errores.push(
                                    `La causa "${causa.id}" referencia un dato inexistente: "${clave}".`
                                );
                            }
                            if (typeof regla.cuando[clave] !== 'boolean') {
                                errores.push(
                                    `La causa "${causa.id}" usa un valor no booleano para "${clave}".`
                                );
                            }
                        }
                    }
                }
            }
            if (
                !Array.isArray(causa.servicios_ids) ||
                causa.servicios_ids.some(
                    (id) => !Number.isInteger(id) || id <= 0
                )
            ) {
                errores.push(
                    `La causa "${causa.id}" tiene "servicios_ids" inválido (array de enteros positivos, puede ser vacío).`
                );
            }
            // ETAPA 1 (v1.1, opcional, inerte): variantes a las que aplica la
            // causa. Vacío/ausente = todas. Cada id debe existir en "variantes".
            if (causa.aplica_variantes !== undefined) {
                if (!Array.isArray(causa.aplica_variantes)) {
                    errores.push(`La causa "${causa.id}" tiene "aplica_variantes" inválido (array).`);
                } else {
                    for (const idVariante of causa.aplica_variantes) {
                        if (typeof idVariante !== 'string' || !idsVariantes.has(idVariante)) {
                            errores.push(
                                `La causa "${causa.id}" referencia una variante inexistente: "${idVariante}".`
                            );
                        }
                    }
                }
            }
            // ETAPA 1 (v1.1, opcional, inerte): soluciones/acciones técnicas.
            // Sin precios ni garantías (los prohíbe contieneClaveProhibida);
            // los servicios_ids se resuelven en MySQL en etapa posterior.
            if (causa.soluciones !== undefined) {
                if (!Array.isArray(causa.soluciones)) {
                    errores.push(`La causa "${causa.id}" tiene "soluciones" inválido (array).`);
                } else {
                    for (const solucion of causa.soluciones) {
                        if (
                            !solucion ||
                            typeof solucion.accion !== 'string' ||
                            solucion.accion.trim() === '' ||
                            typeof solucion.detalle !== 'string' ||
                            solucion.detalle.trim() === '' ||
                            typeof solucion.requiere_visita !== 'boolean' ||
                            !Array.isArray(solucion.servicios_ids) ||
                            solucion.servicios_ids.some(
                                (id) => !Number.isInteger(id) || id <= 0
                            )
                        ) {
                            errores.push(
                                `La causa "${causa.id}" tiene una solución inválida (accion/detalle strings, requiere_visita boolean, servicios_ids enteros positivos).`
                            );
                        }
                    }
                }
            }
        }
    }

    return { ok: errores.length === 0, errores };
}

function cargarManual(rutaAbsoluta) {
    let texto;
    try {
        texto = fs.readFileSync(rutaAbsoluta, 'utf8');
    } catch (error) {
        const err = new Error(`No se pudo leer el manual: ${error.message}`);
        err.code = 'MANUAL_NO_LEIBLE';
        throw err;
    }
    let manual;
    try {
        manual = JSON.parse(texto);
    } catch (error) {
        const err = new Error(`El manual no es JSON válido: ${error.message}`);
        err.code = 'MANUAL_JSON_INVALIDO';
        throw err;
    }
    const validacion = validarManual(manual);
    if (!validacion.ok) {
        const err = new Error(`Manual inválido: ${validacion.errores.join(' ')}`);
        err.code = 'MANUAL_INVALIDO';
        err.detalle = validacion.errores;
        throw err;
    }
    return manual;
}

// Solo se aceptan valores booleanos para claves conocidas del manual.
// Cualquier otro valor (null, string, número, clave inexistente) se ignora
// y se reporta en "ignorados": el motor nunca decide sobre datos ambiguos.
function normalizarDatos(manual, datos) {
    const conocidas = new Set(manual.datos_observables.map((d) => d.clave));
    const normalizados = {};
    const ignorados = [];

    if (datos !== null && typeof datos === 'object' && !Array.isArray(datos)) {
        for (const [clave, valor] of Object.entries(datos)) {
            if (!conocidas.has(clave)) {
                ignorados.push(clave);
            } else if (typeof valor !== 'boolean') {
                ignorados.push(clave);
            } else {
                normalizados[clave] = valor;
            }
        }
    }

    return { datos: normalizados, ignorados };
}

function reglaAplica(regla, datos) {
    return Object.entries(regla.cuando).every(
        ([clave, valor]) => datos[clave] === valor
    );
}

function evaluarCausas(manual, datosNormalizados) {
    return manual.causas.map((causa) => {
        let puntuacion = 0;
        const motivos = [];

        for (const regla of causa.evidencia) {
            if (reglaAplica(regla, datosNormalizados)) {
                puntuacion += regla.efecto === 'aumenta' ? 1 : -1;
                motivos.push(
                    `${regla.efecto === 'aumenta' ? 'A favor' : 'En contra'}: ${regla.motivo}`
                );
            }
        }

        const nivel = puntuacion > 0 ? 'alta' : puntuacion < 0 ? 'baja' : 'media';

        return {
            id: causa.id,
            nombre: causa.nombre,
            descripcion: causa.descripcion || '',
            nivel,
            puntuacion,
            motivos,
            servicios_ids: [...causa.servicios_ids]
        };
    });
}

function datoMencionadoEnCausa(manual, causaId, clave) {
    const causa = manual.causas.find((c) => c.id === causaId);
    if (!causa) return false;
    return causa.evidencia.some((regla) =>
        Object.prototype.hasOwnProperty.call(regla.cuando, clave)
    );
}

// Siguiente pregunta útil: dato desconocido que discrimine entre causas
// todavía relevantes (nivel alta/media). null = nada útil por preguntar.
function siguientePregunta(manual, datosNormalizados, evaluacion) {
    const causasRelevantes = evaluacion
        .filter((c) => c.nivel === 'alta' || c.nivel === 'media')
        .map((c) => c.id);

    let mejor = null;

    for (const dato of manual.datos_observables) {
        if (Object.prototype.hasOwnProperty.call(datosNormalizados, dato.clave)) {
            continue; // Dato ya confirmado: jamás se vuelve a preguntar.
        }
        const poder = causasRelevantes.filter((causaId) =>
            datoMencionadoEnCausa(manual, causaId, dato.clave)
        ).length;

        if (poder > 0 && (mejor === null || poder > mejor.poder)) {
            mejor = {
                clave: dato.clave,
                pregunta: dato.pregunta,
                objetivo: dato.objetivo,
                poder
            };
        }
    }

    if (mejor === null) return null;
    return { clave: mejor.clave, pregunta: mejor.pregunta, objetivo: mejor.objetivo };
}

function ordenarPorNivel(evaluacion) {
    const peso = { alta: 0, media: 1, baja: 2 };
    return [...evaluacion].sort((a, b) => {
        if (peso[a.nivel] !== peso[b.nivel]) return peso[a.nivel] - peso[b.nivel];
        if (b.puntuacion !== a.puntuacion) return b.puntuacion - a.puntuacion;
        return a.id < b.id ? -1 : 1;
    });
}

function resultadoPreliminar(manual, datosNormalizados) {
    const evaluacion = ordenarPorNivel(evaluarCausas(manual, datosNormalizados));

    return {
        equipo: manual.equipo,
        problema: manual.problema,
        datos_observados: { ...datosNormalizados },
        causas: evaluacion.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            descripcion: c.descripcion,
            nivel: c.nivel,
            motivos: [...c.motivos],
            servicios_ids: [...c.servicios_ids]
        })),
        restricciones: [...manual.restricciones],
        advertencia: manual.advertencia
    };
}

// Paso único del motor: normaliza, evalúa y decide entre preguntar o cerrar.
function paso(manual, datos) {
    const { datos: normalizados, ignorados } = normalizarDatos(manual, datos);
    const evaluacion = evaluarCausas(manual, normalizados);
    const pregunta = siguientePregunta(manual, normalizados, evaluacion);

    if (pregunta !== null) {
        return {
            tipo: 'pregunta',
            pregunta,
            datos: normalizados,
            ignorados,
            causas: ordenarPorNivel(evaluacion).map((c) => ({
                id: c.id,
                nivel: c.nivel
            }))
        };
    }
    return {
        tipo: 'preliminar',
        resultado: resultadoPreliminar(manual, normalizados),
        datos: normalizados,
        ignorados
    };
}

module.exports = {
    NIVELES,
    validarManual,
    cargarManual,
    normalizarDatos,
    evaluarCausas,
    siguientePregunta,
    resultadoPreliminar,
    paso
};
