// controllers/chatController.js

const db = require('../config/db');
const path = require('path');
const {
    inicializarEmbeddings,
    buscarConocimientoSemantico
} = require('../utils/embeddings');
const {
    cargarManual,
    normalizarDatos,
    evaluarCausas,
    siguientePregunta,
    resultadoPreliminar,
    paso: pasoMotor
} = require('../utils/motorDiagnostico');

/*
============================================================
CONFIGURACIÓN
============================================================
*/

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = 'servicevt-chat:latest';

const MAX_MENSAJE = 1000;
const MAX_HISTORIAL = 6;
const OLLAMA_TIMEOUT_MS = 90000;

const TOP_N_CHUNKS = 2;
const MAX_CARACTERES_POR_CHUNK = 1200;

// Según la base de conocimiento del proyecto: objetivo 3 preguntas, máximo 5.
const INTERCAMBIOS_OBJETIVO = 3;
const INTERCAMBIOS_MAXIMO = 5;


/*
============================================================
EMBEDDINGS
============================================================
*/

let indiceListo = false;

// El precalentamiento del índice es un side-effect del import pensado para
// producción (servidor). En tests se desactiva con CHAT_SIN_EMBEDDINGS=1:
// obtenerConocimientoRelevante ya responde '' si el índice no está listo,
// así que nada del flujo depende de que el índice exista al importar.
if (process.env.CHAT_SIN_EMBEDDINGS !== '1') {
(async function iniciarIndice() {
    try {
        await inicializarEmbeddings();
        indiceListo = true;
    } catch (error) {
        console.error('[EMBEDDINGS] Error indexando al arrancar, reintentando en 5s:', error.message);
        setTimeout(async () => {
            try {
                await inicializarEmbeddings();
                indiceListo = true;
            } catch (e2) {
                console.error('[EMBEDDINGS] Segundo intento fallido:', e2.message);
            }
        }, 5000);
    }
})();
}


/*
============================================================
MANUALES DE DIAGNÓSTICO (registro genérico, sin if por equipo)
============================================================
Se cargan una vez al arrancar. Cada manual válido entra al registro;
los inválidos/ausentes se saltean con warning sin voltear el servidor.
`manualHeladera` y `esCasoPiloto` se conservan por compatibilidad
(tests F7-B); el flujo usa `resolverManual(equipo, falla)`.
*/

const MANUALES_PATHS = [
    ['Heladera', 'diagnostico_heladera_no_enfria.json'],
    ['Lavarropas', 'diagnostico_lavarropas_no_centrifuga.json']
];

const manuales = [];
let manualHeladera = null;

for (const [equipoEsperado, archivo] of MANUALES_PATHS) {
    try {
        const manual = cargarManual(path.join(__dirname, '..', 'knowledge', archivo));
        manuales.push(manual);
        console.log(`[DIAGNOSTICO] Manual cargado: ${manual.equipo} → ${manual.problema}.`);
        if (equipoEsperado === 'Heladera') {
            manualHeladera = manual;
        }
    } catch (error) {
        console.error(`[DIAGNOSTICO] Manual no disponible (${archivo}):`, error.message);
    }
}

if (manualHeladera === null) {
    console.error('[DIAGNOSTICO] Piloto Heladera deshabilitado, flujo genérico.');
}

function normalizarEquipoFalla(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Registro genérico: resuelve el manual por equipo+problema normalizados.
// Sin if por equipo/falla/clave: agregar un manual es agregar un JSON válido.
function resolverManual(equipoSeleccionado, fallaSeleccionada) {
    const equipo = normalizarEquipoFalla(equipoSeleccionado);
    const falla = normalizarEquipoFalla(fallaSeleccionada);
    return manuales.find(
        (m) => normalizarEquipoFalla(m.equipo) === equipo &&
            normalizarEquipoFalla(m.problema) === falla
    ) || null;
}

function esCasoPiloto(equipoSeleccionado, fallaSeleccionada) {
    if (manualHeladera === null || equipoSeleccionado !== manualHeladera.equipo) {
        return false;
    }
    // Compatibilidad: callers F7-B llaman con solo el equipo. Si se pasa la
    // falla, también debe coincidir con el problema del manual (comparación
    // normalizada para tolerar mayúsculas/tildes).
    if (fallaSeleccionada === undefined || fallaSeleccionada === null) {
        return true;
    }
    const normalizar = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return normalizar(fallaSeleccionada) === normalizar(manualHeladera.problema);
}


/*
============================================================
UTILIDADES
============================================================
*/

function limpiarTexto(valor, maximo) {
    if (typeof valor !== 'string') return '';
    return valor.trim().slice(0, maximo);
}

function normalizarHistorial(historial) {
    if (!Array.isArray(historial)) return [];

    return historial
        .filter(item =>
            item &&
            (item.rol === 'usuario' || item.rol === 'asistente') &&
            typeof item.contenido === 'string'
        )
        .slice(-MAX_HISTORIAL)
        .map(item => ({
            rol: item.rol,
            contenido: limpiarTexto(item.contenido, MAX_MENSAJE)
        }))
        .filter(item => item.contenido.length > 0);
}

function extraerDatosConfirmados(historial, mensajeActual) {
    const mensajesCliente = historial
        .filter(item => item.rol === 'usuario')
        .map(item => item.contenido);

    mensajesCliente.push(mensajeActual);

    if (mensajesCliente.length === 0) return 'Ninguno todavía.';

    return mensajesCliente
        .map((texto, i) => `${i + 1}. ${texto}`)
        .join('\n');
}

function extraerPreguntasHechas(historial) {
    const preguntasAsistente = historial
        .filter(item => item.rol === 'asistente')
        .map(item => item.contenido);

    if (preguntasAsistente.length === 0) return 'Ninguna todavía.';

    return preguntasAsistente
        .map((texto, i) => `${i + 1}. ${texto}`)
        .join('\n');
}

// Red de seguridad: si el modelo repite (o casi repite) una pregunta que
// ya hizo, no confiamos en la instrucción de prompt — lo detectamos acá
// por superposición de palabras y lo cortamos en código.
function similitudJaccard(a, b) {
    const palabrasA = new Set(a.toLowerCase().match(/[a-záéíóúñ]+/g) || []);
    const palabrasB = new Set(b.toLowerCase().match(/[a-záéíóúñ]+/g) || []);

    if (palabrasA.size === 0 || palabrasB.size === 0) return 0;

    let interseccion = 0;
    for (const palabra of palabrasA) {
        if (palabrasB.has(palabra)) interseccion++;
    }

    const union = new Set([...palabrasA, ...palabrasB]).size;
    return interseccion / union;
}

const UMBRAL_REPETICION = 0.6;

function esRespuestaRepetida(respuesta, preguntasAsistente) {
    return preguntasAsistente.some(previa => similitudJaccard(respuesta, previa) >= UMBRAL_REPETICION);
}

// Cuenta turnos del cliente SOBRE EL HISTORIAL CRUDO (previo al truncamiento
// de normalizarHistorial): el tope de cierre debe ver todos los intercambios
// reales, incluido el mensaje automático inicial que el slice descarta.
// Tolera arrays crudos (filtra items inválidos igual que normalizarHistorial,
// pero sin slice ni descarte por vacío: el turno ocurrió igual).
function contarIntercambiosCliente(historial, mensajeActual) {
    void mensajeActual;
    const lista = Array.isArray(historial) ? historial : [];
    const previos = lista.filter(item =>
        item &&
        item.rol === 'usuario' &&
        typeof item.contenido === 'string'
    ).length;
    return previos + 1;
}

function construirConversacion(historial, mensaje) {
    const partes = historial.map(item =>
        `${item.rol === 'usuario' ? 'CLIENTE' : 'ASISTENTE'}: ${item.contenido}`
    );
    partes.push(`CLIENTE: ${mensaje}`);
    return partes.join('\n');
}

// Resumen determinístico del problema (lo que dijo el cliente, tal cual),
// para precargar el textarea del formulario final. No depende de que el
// modelo lo redacte bien.
function armarResumenProblema(historial, mensajeActual, falla) {
    const mensajesCliente = historial
        .filter(item => item.rol === 'usuario')
        .map(item => item.contenido)
        .filter(texto => typeof texto === 'string' && texto.trim().length > 0);

    if (typeof mensajeActual === 'string' && mensajeActual.trim().length > 0) {
        mensajesCliente.push(mensajeActual);
    }

    return `Servicio consultado: ${falla}. Detalle informado por el cliente: ${mensajesCliente.join(' / ')}`;
}


/*
============================================================
CONOCIMIENTO RELEVANTE (VÍA EMBEDDINGS)
============================================================
*/

async function obtenerConocimientoRelevante(equipo, falla, mensaje) {

    if (!indiceListo) {
        console.warn('[KNOWLEDGE] Índice de embeddings todavía no está listo, sin contexto técnico adicional.');
        return '';
    }

    try {
        const resultados = await buscarConocimientoSemantico(equipo, falla, mensaje, TOP_N_CHUNKS);

        return resultados
            .map(bloque => bloque.contenido.trim().slice(0, MAX_CARACTERES_POR_CHUNK))
            .join('\n\n');

    } catch (error) {
        console.error('[KNOWLEDGE] Error al buscar conocimiento semántico:', error.message);
        return '';
    }
}


/*
============================================================
CONTEXTO OFICIAL DE MYSQL
============================================================
*/

async function obtenerContextoServicio(equipo, falla) {

    const [rows] = await db.query(
        `SELECT servicios_id, precio, garantia FROM servicios WHERE equipo = ? AND falla = ? LIMIT 1`,
        [equipo, falla]
    );

    if (rows.length === 0) {
        return {
            encontrado: false,
            servicioId: null,
            precio: null,
            garantia: null,
            texto: 'No hay un precio exacto registrado para esta combinación de equipo y falla.'
        };
    }

    const servicio = rows[0];

    return {
        encontrado: true,
        servicioId: servicio.servicios_id,
        precio: servicio.precio,
        garantia: servicio.garantia,
        texto: `Precio registrado: $${servicio.precio} ARS. Garantía: ${servicio.garantia}.`
    };
}


/*
============================================================
PILOTO F7-B: EXTRACCIÓN DETERMINÍSTICA DE DATOS
============================================================
Convierte mensajes del cliente en datos del esquema del manual.
Reglas: solo cues explícitas del dato; polaridad por marcas de
negación en la misma cláusula; "sí/no" solos únicamente contra
la pregunta pendiente del asistente; contradicciones → ambiguo
(se ignora, el motor ya descarta no booleanos).
*/

const CUES_DATO = [
    { clave: 'luz_interior', re: /luz|lamparit[ao]|iluminaci[óo]n|foquito/i },
    { clave: 'freezer_enfria', re: /freezer|congelador/i },
    { clave: 'compresor_se_escucha', re: /motor|compresor/i },
    { clave: 'clic_arranque', re: /clic|click|chasquido/i },
    { clave: 'hielo_acumulado', re: /hielo|escarcha/i }
];

const MARCA_NEGACION = /(^|\W)(no|ni|tampoco|sin|nunca|nada|ning[úu]n|jam[áa]s|dej[óo] de|ya no|bloquead[oa]|quemad[oa]|rot[oa]|fundid[oa]|parad[oa]|detenid[oa]|muert[oa])($|\W)/i;

function dividirClausulas(texto) {
    // Separamos por puntuación, adversativas y copulativas ('y'/'e',
    // 'además', 'también'): una negación solo polariza su propia cláusula.
    // Ej: "No enfría y la luz prende" → la luz queda afirmativa.
    return String(texto || '')
        .split(/[,.;]|\bpero\b|\baunque\b|\bsin embargo\b|\bmientras\b|\bsino\b|\by\b|\be\b|\badem[áa]s\b|\btambi[ée]n\b/i)
        .map((s) => s.trim())
        .filter(Boolean);
}

function extraerDatoDeTexto(texto) {
    const resultado = {};
    for (const { clave, re } of CUES_DATO) {
        const menciones = dividirClausulas(texto).filter((c) => re.test(c));
        if (menciones.length === 0) continue;
        const polaridades = new Set(menciones.map((c) => !MARCA_NEGACION.test(c)));
        if (polaridades.size === 1) resultado[clave] = [...polaridades][0];
    }
    return resultado;
}

const RE_SI_SOLO = /^\W*(s[ií]|sip|exacto|correcto|as[ií] es|tal cual|eso mismo|claro)\W*$/i;
const RE_NO_SOLO = /^\W*(no|nop|para nada|ni ah[ií])\W*$/i;
// Duda explícita: nunca se interpreta como respuesta ("no sé", "ni idea"...).
const RE_DUDA = /no s[ée]|ni idea|no estoy segur|no recuerdo|no me acuerdo|depende|a veces/i;

// Respuesta corta sin cues ("No enfría.", "No, tampoco.", "Sí enfría."):
// solo vale contra la pregunta pendiente del asistente. Sin pendiente,
// o con duda, se ignora (ambiguo).
function polaridadSola(texto) {
    if (RE_DUDA.test(texto)) return null;
    if (RE_SI_SOLO.test(texto)) return true;
    if (RE_NO_SOLO.test(texto)) return false;
    if (texto.trim().length > 40) return null;
    if (/\btampoco\b/i.test(texto)) return false;
    if (/^\W*no\b/i.test(texto)) return false;
    if (/^\W*s[ií]\b/i.test(texto)) return true;
    return null;
}

function detectarDatoPreguntado(textoAsistente) {
    const hallados = CUES_DATO.filter(({ re }) => re.test(textoAsistente)).map((o) => o.clave);
    return hallados.length === 1 ? hallados[0] : null;
}

function extraerDatosDiagnostico(manual, historial, mensajeActual) {
    // El manual define el esquema válido: solo se devuelven claves presentes
    // en sus datos_observables. Las cues regex siguen siendo las del piloto
    // Heladera (no se inventan datos fuera del esquema del manual).
    const clavesValidas = new Set(
        (manual && Array.isArray(manual.datos_observables)
            ? manual.datos_observables
            : []).map((d) => d && d.clave).filter(Boolean)
    );
    const datos = {};
    let pendiente = null;

    const procesarCliente = (texto) => {
        const explicitos = extraerDatoDeTexto(texto);
        const filtrados = Object.fromEntries(
            Object.entries(explicitos).filter(([clave]) => clavesValidas.has(clave))
        );
        if (Object.keys(filtrados).length > 0) {
            Object.assign(datos, filtrados);
            return;
        }
        if (pendiente !== null && clavesValidas.has(pendiente)) {
            const polaridad = polaridadSola(texto);
            if (polaridad !== null) datos[pendiente] = polaridad;
        }
    };

    for (const item of historial) {
        if (item.rol === 'asistente') {
            pendiente = detectarDatoPreguntado(item.contenido);
        } else if (item.rol === 'usuario') {
            procesarCliente(item.contenido);
        }
    }
    procesarCliente(mensajeActual);

    return datos;
}


/*
============================================================
PILOTO F7-B: SERVICIOS POR ID (PRECIOS SOLO DESDE MYSQL)
============================================================
*/

async function obtenerServiciosPorIds(serviciosIds) {
    const ids = [...new Set(
        (Array.isArray(serviciosIds) ? serviciosIds : []).filter(
            (id) => Number.isInteger(id) && id > 0
        )
    )];

    if (ids.length === 0) return [];

    const [rows] = await db.query(
        `SELECT servicios_id, equipo, falla, precio, garantia
          FROM servicios
          WHERE servicios_id IN (?)`,
        [ids]
    );

    const encontrados = new Set(rows.map((r) => r.servicios_id));
    for (const id of ids) {
        if (!encontrados.has(id)) {
            console.warn(`[DIAGNOSTICO] servicio_id inexistente: ${id}`);
        }
    }

    return rows;
}


/*
============================================================
PILOTO F7-B: CONTEXTO ESTRUCTURADO + ANTI-ALUCINACIÓN
============================================================
*/

function construirContextoDiagnostico(resultado, serviciosPorId) {
    const lineas = [];
    lineas.push('RESULTADO DEL MOTOR DE DIAGNÓSTICO (orientativo, no definitivo):');
    lineas.push(`Equipo: ${resultado.equipo} — Problema: ${resultado.problema}`);
    lineas.push(
        'Datos observados: ' +
        (Object.entries(resultado.datos_observados).map(([k, v]) => `${k}=${v ? 'sí' : 'no'}`).join('; ') || 'ninguno')
    );

    resultado.causas
        .filter((c) => c.nivel === 'alta' || c.nivel === 'media')
        .forEach((causa, i) => {
            lineas.push('');
            lineas.push(`Causa ${i + 1}: ${causa.nombre} — Nivel: ${causa.nivel}`);
            causa.motivos.forEach((m) => lineas.push(`- ${m}`));
            const relacionados = (causa.servicios_ids || [])
                .map((id) => serviciosPorId.get(id))
                .filter(Boolean);
            if (relacionados.length === 0) {
                lineas.push('Servicio relacionado: sin servicio registrado (no inventar precio).');
            } else {
                relacionados.forEach((s) => lineas.push(
                    `Servicio relacionado: ${s.falla} — Precio registrado: $${s.precio} ARS — Garantía: ${s.garantia} (servicios_id ${s.servicios_id}).`
                ));
            }
        });

    lineas.push('');
    lineas.push('RESTRICCIONES:');
    resultado.restricciones.forEach((r) => lineas.push(`- ${r}`));
    lineas.push(`ADVERTENCIA: ${resultado.advertencia}`);

    return lineas.join('\n');
}

const RE_PIDE_CONTACTO = /(tu (nombre|tel[ée]fono|celular|direcci[óo]n|barrio|localidad)|pasame tu|decime tu (nombre|tel[ée]fono|direcci[óo]n)|a qu[ée] hora (te|les) (viene|queda|conviene)|qu[ée] horario|coordinamos (un )?horario|dejame tu)/i;

function respuestaPideContacto(texto) {
    return RE_PIDE_CONTACTO.test(String(texto || ''));
}

function extraerMontos(texto) {
    const hallados = String(texto || '').match(/\$\s?[\d.]+/g) || [];
    return [...new Set(hallados.map((s) => Number(s.replace(/[^\d]/g, ''))))];
}

function respuestaContienePrecioNoAutorizado(texto, preciosAutorizados) {
    const permitidos = new Set(preciosAutorizados);
    return extraerMontos(texto).some((n) => !permitidos.has(n));
}

function preguntaDeterministica(pregunta) {
    return `${pregunta.pregunta} (${pregunta.objetivo})`;
}

function resumenPreliminarDeterministico(resultado, serviciosPorId) {
    const partes = [];
    const compatibles = resultado.causas.filter((c) => c.nivel === 'alta' || c.nivel === 'media');
    partes.push(
        `Por lo que me contaste, hay indicios compatibles con: ${compatibles.map((c) => c.nombre).join('; ')}.`
    );
    const vistos = new Set();
    for (const causa of compatibles) {
        for (const id of causa.servicios_ids || []) {
            const s = serviciosPorId.get(id);
            if (s && !vistos.has(id)) {
                vistos.add(id);
                partes.push(`- ${s.falla}: precio registrado $${s.precio} ARS (${s.garantia}).`);
            }
        }
    }
    partes.push(resultado.advertencia);
    partes.push('Si querés, podemos pasar estos datos a coordinación para que un técnico revise el equipo.');
    return partes.join(' ');
}


/*
============================================================
CIERRE COMPAT F6-C (contrato listo/whatsappUrl, aditivo)
============================================================
El frontend F6-C muestra el panel de derivación cuando recibe
`listo=true + whatsappUrl`. F7B responde `mostrarFormulario`, por eso se
agregan estos campos sin quitar ninguno existente (compatibilidad hacia
adelante, sin romper callers F7-B). El número sale de WHATSAPP_NUMBER;
si falta, whatsappUrl es null y NUNCA se devuelve 500 por esto (el chat
sigue funcionando; decisión F6-C 18, conservada).
*/

function construirWhatsappUrl(texto) {
    const numero = (process.env.WHATSAPP_NUMBER || '').trim();
    if (!numero) return null;
    return `https://wa.me/${numero}?text=${encodeURIComponent(String(texto || ''))}`;
}

// Arma los campos de compatibilidad para una respuesta de cierre.
// `resumenCorto` alimenta el texto prellenado del mensaje de WhatsApp.
function camposCierreCompat(cerro, resumenCorto) {
    if (!cerro) {
        return { listo: false, whatsappUrl: null };
    }
    return { listo: true, whatsappUrl: construirWhatsappUrl(resumenCorto) };
}


/*
============================================================
FORMULARIO F7B: pregunta estructurada + respuesta estructurada
============================================================
El formulario NO diagnostica: es otra boca de entrada de datos al motor.
- construirPreguntaDiagnostico: motor → bloque UI (solo tipos con renderer).
- validarRespuestaEstructurada: clave ∈ manual + tipo booleano estricto.
- incorporarRespuestaEstructurada: fusión con precedencia estructurada.
Sin if por equipo/falla/clave en ninguna de las tres.
*/

function buscarDatoObservable(manual, clave) {
    if (!manual || !Array.isArray(manual.datos_observables)) return null;
    return manual.datos_observables.find((d) => d && d.clave === clave) || null;
}

function construirPreguntaDiagnostico(manual, pregunta) {
    if (!pregunta || typeof pregunta.clave !== 'string') return null;
    const dato = buscarDatoObservable(manual, pregunta.clave);
    if (!dato) return null;
    // Única familia implementada en esta etapa. Tipos futuros sin renderer
    // devuelven null: el camino de texto libre sigue disponible (seguro).
    if (dato.tipo !== 'booleano') return null;
    return {
        clave: dato.clave,
        pregunta: pregunta.pregunta,
        objetivo: pregunta.objetivo,
        tipo: 'booleano',
        opciones: [
            { valor: true, texto: 'Sí' },
            { valor: false, texto: 'No' }
        ]
    };
}

function validarRespuestaEstructurada(manual, respuestaEstructurada) {
    if (!respuestaEstructurada || typeof respuestaEstructurada !== 'object' || Array.isArray(respuestaEstructurada)) {
        return { ok: false, motivo: 'formato' };
    }
    const { clave, valor } = respuestaEstructurada;
    if (typeof clave !== 'string' || clave.trim() === '') {
        return { ok: false, motivo: 'sin-clave' };
    }
    const dato = buscarDatoObservable(manual, clave);
    if (!dato) {
        return { ok: false, motivo: 'clave-fuera-de-manual' };
    }
    // Booleano estricto: no se acepta "si"/1/"true" ni otros tipos.
    if (dato.tipo === 'booleano') {
        if (typeof valor !== 'boolean') {
            return { ok: false, motivo: 'tipo-invalido' };
        }
        return { ok: true, clave: dato.clave, valor };
    }
    return { ok: false, motivo: 'tipo-sin-renderer' };
}

function incorporarRespuestaEstructurada(manual, datosExtraidos, respuestaEstructurada) {
    const base = { ...(datosExtraidos || {}) };
    const validacion = validarRespuestaEstructurada(manual, respuestaEstructurada);
    if (!validacion.ok) return { datos: base, aplicada: false, motivo: validacion.motivo };
    // Precedencia: la respuesta estructurada pisa el texto para la misma
    // clave. Una sola clave, un solo valor: sin doble evidencia.
    base[validacion.clave] = validacion.valor;
    return { datos: base, aplicada: true, motivo: null };
}

// Carry-forward: revalida el estado acumulado que trae el frontend
// (datosDiagnostico) par por par contra el manual. Nunca se confía en el
// cliente: claves fuera del manual o valores no booleanos se descartan.
// Sin variables globales: el estado viaja en el request (multiusuario).
function validarDatosDiagnostico(manual, datos) {
    const limpios = {};
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return limpios;
    }
    for (const [clave, valor] of Object.entries(datos)) {
        const validacion = validarRespuestaEstructurada(manual, { clave, valor });
        if (validacion.ok) {
            limpios[validacion.clave] = validacion.valor;
        } else {
            console.warn(`[DATOS PREVIOS] par descartado (${String(clave)}: ${validacion.motivo}).`);
        }
    }
    return limpios;
}


/*
============================================================
PILOTO F7-B: FLUJO GOBERNADO POR EL MOTOR
============================================================
*/

const INTERCAMBIOS_MAXIMO_PILOTO = 5;

async function handleChatPiloto({ equipoSeleccionado, fallaSeleccionada, mensaje, historial, historialCrudo, contextoServicio, res, manual, respuestaEstructurada, datosDiagnostico }) {
    const manualActivo = manual || manualHeladera;
    const datosExtraidos = extraerDatosDiagnostico(manualActivo, historial, mensaje);
    // Carry-forward acumulativo (actual > previos > texto):
    // 1) previos revalidados, 2) texto, 3) click actual. Todo contra el manual.
    const previos = validarDatosDiagnostico(manualActivo, datosDiagnostico);
    console.log(`[DATOS PREVIOS] ${JSON.stringify(previos)}`);
    console.log(`[DATOS EXTRAIDOS] ${JSON.stringify(datosExtraidos)}`);
    const fusion = incorporarRespuestaEstructurada(manualActivo, { ...datosExtraidos, ...previos }, respuestaEstructurada);
    if (respuestaEstructurada !== undefined && respuestaEstructurada !== null) {
        if (fusion.aplicada) {
            console.log(`[RESPUESTA ESTRUCTURADA] ${JSON.stringify(respuestaEstructurada)}`);
        } else {
            console.warn(`[RESPUESTA ESTRUCTURADA] ignorada (${fusion.motivo}).`);
        }
    }
    const datos = fusion.datos;
    console.log(`[DATOS FINALES] ${JSON.stringify(datos)}`);
    const { datos: normalizados } = normalizarDatos(manualActivo, datos);
    const evaluacion = evaluarCausas(manualActivo, normalizados);
    const pregunta = siguientePregunta(manualActivo, normalizados, evaluacion);
    // Conteo sobre historial crudo (ver contarIntercambiosCliente): el tope
    // de seguridad no debe perder turnos por el truncamiento a MAX_HISTORIAL.
    const intercambios = contarIntercambiosCliente(historialCrudo !== undefined ? historialCrudo : historial, mensaje);

    console.log(`[DIAGNOSTICO] Datos actuales: ${JSON.stringify(normalizados)}`);
    console.log(`[EVALUACION CAUSAS] ${evaluacion.map((c) => `${c.id}=${c.nivel}`).join(', ')}`);

    const conocimiento = await obtenerConocimientoRelevante(equipoSeleccionado, fallaSeleccionada, mensaje);
    const conversacion = construirConversacion(historial, mensaje);

    // A) El motor pide un dato útil y hay margen: Ollama solo redacta la pregunta.
    if (pregunta !== null && intercambios < INTERCAMBIOS_MAXIMO_PILOTO) {
        console.log(`[PREGUNTA MOTOR] ${pregunta.clave}`);

        const prompt = `
Sos el redactor del asistente técnico de ServiceVT (español argentino, voseo, breve y empático).
El motor de diagnóstico decidió la siguiente pregunta técnica. Tu tarea es SOLO redactarla con lenguaje natural.
PROHIBIDO: cambiar su contenido técnico, agregar otras preguntas, pedir nombre/teléfono/dirección/barrio/horarios, hablar de precios o de funcionamiento interno.

PREGUNTA TÉCNICA: ${pregunta.pregunta}
POR QUÉ AYUDA: ${pregunta.objetivo}

CONVERSACIÓN:
${conversacion}

Respondé con esa única pregunta (máximo 2 frases cortas).
`.trim();

        let respuesta = await consultarOllama(prompt);
        if (!respuesta || respuestaPideContacto(respuesta)) {
            if (respuestaPideContacto(respuesta)) {
                console.warn('[DIAGNOSTICO] Ollama pidió contacto: se usa pregunta determinística.');
            }
            respuesta = preguntaDeterministica(pregunta);
        }

        return res.status(200).json({
            respuesta,
            precio: contextoServicio.encontrado ? contextoServicio.precio : null,
            garantia: contextoServicio.encontrado ? contextoServicio.garantia : null,
            mostrarFormulario: false,
            ...camposCierreCompat(false),
            // Bloque aditivo: el frontend lo convierte en botones. Null si el
            // tipo no tiene renderer (el texto libre sigue disponible).
            preguntaDiagnostico: construirPreguntaDiagnostico(manualActivo, pregunta),
            // Eco validado del estado acumulado (carry-forward multiusuario).
            datosDiagnostico: { ...normalizados }
        });
    }

    // B) El motor concluyó (o tope de seguridad): cierre comercial con precios de MySQL.
    const resultado = resultadoPreliminar(manualActivo, normalizados);
    if (pregunta !== null) {
        console.log('[DIAGNOSTICO] Tope de seguridad alcanzado: cierre forzado.');
    } else {
        console.log('[SIGUIENTE PREGUNTA] ninguna: cierre del motor.');
    }

    const idsNecesarios = [...new Set(
        resultado.causas
            .filter((c) => c.nivel === 'alta' || c.nivel === 'media')
            .flatMap((c) => c.servicios_ids || [])
    )];
    const servicios = await obtenerServiciosPorIds(idsNecesarios);
    const serviciosPorId = new Map(servicios.map((s) => [s.servicios_id, s]));
    console.log(`[DIAGNOSTICO] Servicios encontrados: ${servicios.map((s) => s.servicios_id).join(', ') || 'ninguno'}`);

    const contexto = construirContextoDiagnostico(resultado, serviciosPorId);
    const preciosAutorizados = servicios.map((s) => Number(s.precio));
    servicios.forEach((s) => console.log(`[DIAGNOSTICO] Precio obtenido desde MySQL: servicios_id ${s.servicios_id} = $${s.precio}`));

    const prompt = `
Sos el asistente comercial de ServiceVT (español argentino, voseo, lenguaje sencillo, sin tecnicismos).
Explicá el siguiente resultado del motor de diagnóstico con empatía y claridad.

${contexto}
${conocimiento ? `CONTEXTO TÉCNICO ADICIONAL:\n${conocimiento}` : ''}

REGLAS OBLIGATORIAS:
- Hablá de posibilidades e indicios ("hay indicios compatibles con..."), NUNCA de diagnóstico definitivo ni porcentajes.
- Usá ÚNICAMENTE los precios, garantías y servicios del contexto. No inventes ninguno.
- No pidas nombre, teléfono, dirección, barrio, localidad ni horarios: de eso se encarga la coordinación.
- Indicá que el técnico debe confirmar la falla en el domicilio.
- Cerrá invitando a coordinar ("podemos pasar estos datos a coordinación").
`.trim();

    let respuesta = await consultarOllama(prompt);
    if (!respuesta) throw new Error('El asistente devolvió una respuesta vacía.');
    if (respuestaPideContacto(respuesta)) {
        console.warn('[DIAGNOSTICO] Ollama pidió contacto en el cierre: se usa resumen determinístico.');
        respuesta = resumenPreliminarDeterministico(resultado, serviciosPorId);
    } else if (respuestaContienePrecioNoAutorizado(respuesta, preciosAutorizados)) {
        console.warn('[DIAGNOSTICO] Ollama usó un precio no autorizado: se usa resumen determinístico.');
        respuesta = resumenPreliminarDeterministico(resultado, serviciosPorId);
    }

    const alternativas = servicios.map((s) => ({
        servicios_id: s.servicios_id,
        equipo: s.equipo,
        falla: s.falla,
        precio: s.precio,
        garantia: s.garantia
    }));

    return res.status(200).json({
        respuesta,
        precio: contextoServicio.encontrado ? contextoServicio.precio : null,
        garantia: contextoServicio.encontrado ? contextoServicio.garantia : null,
        mostrarFormulario: true,
        ...camposCierreCompat(true,
            `Hola ServiceVT! Quiero coordinar una visita. Equipo: ${equipoSeleccionado} - ${fallaSeleccionada}.`
        ),
        // En cierre no hay pregunta pendiente (null explícito) pero se
        // devuelve el estado acumulado para trazabilidad del frontend.
        preguntaDiagnostico: null,
        datosDiagnostico: { ...normalizados },
        resumenParaFormulario: {
            equipo: equipoSeleccionado,
            falla: fallaSeleccionada,
            servicioId: contextoServicio.servicioId,
            problema: armarResumenProblema(historial, mensaje, fallaSeleccionada),
            precio: contextoServicio.precio,
            garantia: contextoServicio.garantia,
            alternativas,
            diagnostico: {
                datos: normalizados,
                causas: resultado.causas.map((c) => ({ id: c.id, nombre: c.nombre, nivel: c.nivel }))
            }
        }
    });
}


/*
============================================================
OLLANA
============================================================
*/

async function consultarOllama(prompt) {

    const controller = new AbortController();
    const inicio = Date.now();

    const timeout = setTimeout(() => {
        console.log(`[OLLAMA] Timeout después de ${Date.now() - inicio} ms`);
        controller.abort();
    }, OLLAMA_TIMEOUT_MS);

    try {
        const response = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                prompt,
                stream: false,
                keep_alive: '10m',
                options: {
                    temperature: 0.2,
                    num_predict: 220,
                    num_ctx: 2048
                }
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Ollama respondió HTTP ${response.status}`);
        }

        const data = await response.json();

        if (!data || typeof data.response !== 'string') {
            throw new Error('Ollama no devolvió una respuesta válida.');
        }

        console.log(`[OLLAMA] Tiempo total: ${Date.now() - inicio} ms`);

        return data.response.trim();

    } finally {
        clearTimeout(timeout);
    }
}


/*
============================================================
CHAT
============================================================
*/

const handleChat = async (req, res) => {

    const equipoSeleccionado = limpiarTexto(req.body?.equipoSeleccionado, 100);
    const fallaSeleccionada = limpiarTexto(req.body?.fallaSeleccionada, 255);
    const mensaje = limpiarTexto(req.body?.mensaje, MAX_MENSAJE);
    const historial = normalizarHistorial(req.body?.historial);
    // Respuesta estructurada del formulario (opcional): viaja sin texto libre
    // (el click no se duplica como mensaje). Se valida contra el manual.
    const respuestaEstructurada = req.body?.respuestaEstructurada;
    // Estado acumulado del diagnóstico (opcional, carry-forward): el backend
    // lo revalida par por par; nunca es autoridad.
    const datosDiagnostico = req.body?.datosDiagnostico;

    if (!equipoSeleccionado || !fallaSeleccionada || (!mensaje && respuestaEstructurada === undefined)) {
        return res.status(400).json({
            error: 'Faltan parámetros obligatorios en la consulta.'
        });
    }

    try {

        const contextoServicio = await obtenerContextoServicio(equipoSeleccionado, fallaSeleccionada);

        // Manuales gobernados por el motor determinístico (registro genérico).
        // Resolución por equipo+problema; si la falla no matchea ningún
        // problema pero el equipo tiene manual, se usa el del equipo
        // (compatibilidad con el piloto anterior: equipo = piloto).
        // Otros equipos usan el flujo genérico actual, sin cambios.
        const manualCaso = resolverManual(equipoSeleccionado, fallaSeleccionada)
            || manuales.find((m) => normalizarEquipoFalla(m.equipo) === normalizarEquipoFalla(equipoSeleccionado))
            || null;
        if (manualCaso !== null) {
            return handleChatPiloto({ equipoSeleccionado, fallaSeleccionada, mensaje, historial, historialCrudo: req.body?.historial, contextoServicio, res, manual: manualCaso, respuestaEstructurada, datosDiagnostico });
        }

        const conocimiento = await obtenerConocimientoRelevante(equipoSeleccionado, fallaSeleccionada, mensaje);
        const conversacion = construirConversacion(historial, mensaje);
        const datosConfirmados = extraerDatosConfirmados(historial, mensaje);
        const preguntasHechas = extraerPreguntasHechas(historial);
        // Conteo sobre historial crudo (ver contarIntercambiosCliente): el
        // cierre obligatorio no debe perder el mensaje inicial por el
        // truncamiento de normalizarHistorial.
        const intercambios = contarIntercambiosCliente(req.body?.historial, mensaje);
        const debeCerrarObligatorio = intercambios >= INTERCAMBIOS_MAXIMO;
        const debeCerrarSiPuede = intercambios >= INTERCAMBIOS_OBJETIVO;
        const debeCerrar = debeCerrarObligatorio || debeCerrarSiPuede;

        const instruccionCierre = debeCerrarObligatorio
            ? `
INSTRUCCIÓN DE CIERRE (obligatoria, tiene prioridad sobre cualquier otra regla):
Ya se llegó al máximo de preguntas de diagnóstico. NO hagas NINGUNA
pregunta más, aunque sientas que falta información. Dale al cliente
una orientación concreta y probable (no definitiva) en 1-2 frases, y
cerrá invitándolo a completar sus datos para coordinar la visita (el
formulario lo va a mostrar el sistema, vos solo invitalo con una
frase, no pidas nombre ni teléfono vos mismo).
`.trim()
            : debeCerrarSiPuede
            ? `
Ya hiciste varias preguntas de diagnóstico. Preguntate: ¿la próxima
pregunta realmente separa una hipótesis, o ya tengo suficiente para
orientar el caso? Si ya alcanza, cerrá con una orientación concreta
(1-2 frases) e invitá a completar los datos para coordinar la visita,
sin pedir nombre ni teléfono vos mismo. Solo si es imprescindible,
hacé UNA última pregunta que no esté en la lista de las ya hechas.
`.trim()
            : `
Todavía estás en etapa de diagnóstico. Hacé como máximo UNA pregunta,
que NO esté en la lista de "preguntas que ya hiciste" (ni reformulada
con otras palabras), y explicá en una frase breve por qué ayuda al
diagnóstico.
`.trim();

        const prompt = `
DATOS DEL CASO:
Equipo: ${equipoSeleccionado}
Servicio seleccionado: ${fallaSeleccionada}

DATOS OFICIALES:
${contextoServicio.texto}

CONOCIMIENTO TÉCNICO RELEVANTE:
${conocimiento || 'Sin información técnica específica.'}

DATOS YA CONFIRMADOS POR EL CLIENTE (no vuelvas a preguntar por esto):
${datosConfirmados}

PREGUNTAS QUE VOS YA HICISTE (no las repitas, ni reformuladas):
${preguntasHechas}

${instruccionCierre}

CONVERSACIÓN:
${conversacion}

Respondé únicamente al cliente. Nunca pidas ni confirmes datos de contacto ni horarios vos mismo: eso lo maneja el formulario del sistema.
`.trim();

        let respuesta = await consultarOllama(prompt);

        if (!respuesta) {
            throw new Error('El asistente devolvió una respuesta vacía.');
        }

        const preguntasAsistenteArray = historial
            .filter(item => item.rol === 'asistente')
            .map(item => item.contenido);

        const seRepitio = esRespuestaRepetida(respuesta, preguntasAsistenteArray);

        const pareceQueSigioPreguntando = respuesta.trim().endsWith('?');

        if (seRepitio) {
            console.warn('[CHAT] Respuesta detectada como repetida, forzando cierre determinístico.');

            respuesta = `Con lo que me contaste ya tengo una primera orientación del problema. Te recomiendo que lo revise un técnico para confirmarlo. Completá tus datos para coordinar la visita.`;

            return res.status(200).json({
                respuesta,
                precio: contextoServicio.encontrado ? contextoServicio.precio : null,
                garantia: contextoServicio.encontrado ? contextoServicio.garantia : null,
                mostrarFormulario: true,
                ...camposCierreCompat(true,
                    `Hola ServiceVT! Quiero coordinar una visita. Equipo: ${equipoSeleccionado} - ${fallaSeleccionada}.`
                ),
                resumenParaFormulario: {
                    equipo: equipoSeleccionado,
                    falla: fallaSeleccionada,
                    servicioId: contextoServicio.servicioId,
                    problema: armarResumenProblema(historial, mensaje, fallaSeleccionada),
                    precio: contextoServicio.precio,
                    garantia: contextoServicio.garantia
                }
            });
        }

        // En la zona "objetivo" el modelo puede cerrar o hacer una última
        // pregunta. Si hizo una pregunta (termina en "?"), no mostramos el
        // formulario todavía — eso solo lo forzamos en el máximo obligatorio.
        // LÍMITE DURO: con INTERCAMBIOS_MAXIMO alcanzado, el cierre prevalece
        // SIEMPRE sobre la decisión de Ollama de seguir preguntando: no hay
        // sexta pregunta y la respuesta se reemplaza por el cierre
        // determinístico con resumen (el flujo genérico siempre tiene datos
        // suficientes: historial + mensaje actual).
        if (debeCerrarObligatorio && pareceQueSigioPreguntando) {
            console.warn('[CHAT] Límite máximo alcanzado con pregunta de Ollama, forzando cierre determinístico.');
            respuesta = `Con lo que me contaste ya tengo una primera orientación del problema. Te recomiendo que lo revise un técnico para confirmarlo. Completá tus datos para coordinar la visita.`;
        }

        const cerroEfectivamente = debeCerrarObligatorio || (debeCerrarSiPuede && !respuesta.trim().endsWith('?'));

        const payload = {
            respuesta,
            precio: contextoServicio.encontrado ? contextoServicio.precio : null,
            garantia: contextoServicio.encontrado ? contextoServicio.garantia : null,
            mostrarFormulario: cerroEfectivamente,
            ...camposCierreCompat(cerroEfectivamente,
                `Hola ServiceVT! Quiero coordinar una visita. Equipo: ${equipoSeleccionado} - ${fallaSeleccionada}.`
            )
        };

        // Cuando ya cerramos el diagnóstico, mandamos el resumen ya armado
        // para que el frontend precargue el formulario (nombre/celular/
        // barrio/dirección los completa el cliente a mano).
        if (cerroEfectivamente) {
            payload.resumenParaFormulario = {
                equipo: equipoSeleccionado,
                falla: fallaSeleccionada,
                servicioId: contextoServicio.servicioId,
                problema: armarResumenProblema(historial, mensaje, fallaSeleccionada),
                precio: contextoServicio.precio,
                garantia: contextoServicio.garantia
            };
        }

        return res.status(200).json(payload);

    } catch (error) {

        console.error('[CHAT] Error:', error.message);

        if (error.name === 'AbortError') {
            return res.status(504).json({
                error: 'El asistente está tardando demasiado en responder. Intentá nuevamente.'
            });
        }

        return res.status(500).json({
            error: 'No se pudo procesar la consulta del asistente.'
        });
    }
};

module.exports = {
    handleChat,
    // Helpers F7-B exportados para tests (no cambian el contrato de chatRoutes).
    esCasoPiloto,
    extraerDatosDiagnostico,
    obtenerServiciosPorIds,
    construirContextoDiagnostico,
    respuestaPideContacto,
    respuestaContienePrecioNoAutorizado,
    preguntaDeterministica,
    resumenPreliminarDeterministico,
    // Compatibilidad de cierre F6-C (aditivo, para tests + frontend).
    construirWhatsappUrl,
    camposCierreCompat,
    // Conteo de intercambios (aditivo, para verificación del fix de cierre).
    contarIntercambiosCliente,
    // Formulario F7B (aditivo): bloque de pregunta + validación/fusión.
    resolverManual,
    construirPreguntaDiagnostico,
    validarRespuestaEstructurada,
    incorporarRespuestaEstructurada,
    validarDatosDiagnostico
};