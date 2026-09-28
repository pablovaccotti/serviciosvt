// controllers/chatController.js

const fs = require('fs');
const path = require('path');

const db = require('../config/db');

/*
============================================================
CONFIGURACIÓN
============================================================
*/

const OLLAMA_URL = 'http://127.0.0.1:11434/api/generate';

const OLLAMA_MODEL = 'servicevt-chat:latest';

const MAX_MENSAJE = 1000;
const MAX_HISTORIAL = 4;

const OLLAMA_TIMEOUT_MS = 90000;


/*
============================================================
BASE DE CONOCIMIENTO
============================================================
*/

/*
 * La base está en:
 *
 * server-servicevt/
 * ├── knowledge/
 * │   └── serviceVT_base_conocimiento_v1.md
 *
 * __dirname apunta a:
 * controllers/
 *
 * Por eso subimos un nivel con '..'
 */
const KNOWLEDGE_PATH = path.join(
    __dirname,
    '..',
    'knowledge',
    'serviceVT_base_conocimiento_v1.md'
);

let baseConocimiento = '';

try {

    baseConocimiento =
        fs.readFileSync(
            KNOWLEDGE_PATH,
            'utf8'
        );

    console.log(
        `[KNOWLEDGE] Base cargada correctamente: ${KNOWLEDGE_PATH}`
    );

    console.log(
        `[KNOWLEDGE] Caracteres cargados: ${baseConocimiento.length}`
    );

} catch (error) {

    console.error(
        '[KNOWLEDGE] No se pudo cargar la base de conocimiento:',
        error.message
    );

    /*
     * No tiramos abajo el servidor.
     *
     * El chat puede seguir funcionando aunque
     * temporalmente no exista la base.
     */
    baseConocimiento = '';
}


/*
============================================================
UTILIDADES
============================================================
*/

function limpiarTexto(valor, maximo) {

    if (typeof valor !== 'string') {
        return '';
    }

    return valor
        .trim()
        .slice(0, maximo);
}


/*
============================================================
HISTORIAL
============================================================
*/

function normalizarHistorial(historial) {

    if (!Array.isArray(historial)) {
        return [];
    }

    return historial
        .filter(item =>
            item &&
            (
                item.rol === 'usuario' ||
                item.rol === 'asistente'
            ) &&
            typeof item.contenido === 'string'
        )
        .slice(-MAX_HISTORIAL)
        .map(item => ({
            rol: item.rol,
            contenido:
                limpiarTexto(
                    item.contenido,
                    MAX_MENSAJE
                )
        }))
        .filter(item =>
            item.contenido.length > 0
        );
}


function construirConversacion(
    historial,
    mensaje
) {

    const partes = [];

    for (const item of historial) {

        const etiqueta =
            item.rol === 'usuario'
                ? 'CLIENTE'
                : 'ASISTENTE';

        partes.push(
            `${etiqueta}: ${item.contenido}`
        );
    }

    partes.push(
        `CLIENTE: ${mensaje}`
    );

    return partes.join('\n');
}


/*
============================================================
SELECCIÓN DE CONOCIMIENTO
============================================================
*/

/*
 * Esta función NO intenta mandar todo el .md a Ollama.
 *
 * Busca primero la sección correspondiente al equipo.
 * Después intenta quedarse con la parte relevante
 * según la falla.
 *
 * Si no encuentra una sección concreta, devuelve
 * un fragmento razonable de la base.
 */

function obtenerConocimientoRelevante(
    equipo,
    falla
) {

    if (!baseConocimiento) {
        return '';
    }

    const texto =
        baseConocimiento;

    const equipoNormalizado =
        equipo
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');

    const fallaNormalizada =
        falla
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');


    /*
     * --------------------------------------------------------
     * IDENTIFICAR SECCIÓN PRINCIPAL
     * --------------------------------------------------------
     */

    let seccionInicio = -1;
    let seccionFin = texto.length;

    if (
        equipoNormalizado.includes(
            'aire acondicionado'
        ) ||
        equipoNormalizado.includes(
            'aire'
        )
    ) {

        seccionInicio =
            texto.indexOf(
                '# Aire acondicionado'
            );

    } else if (
        equipoNormalizado.includes(
            'heladera'
        )
    ) {

        seccionInicio =
            texto.indexOf(
                '# Heladera'
            );

    } else if (
        equipoNormalizado.includes(
            'lavarropas'
        ) ||
        equipoNormalizado.includes(
            'lavadora'
        )
    ) {

        seccionInicio =
            texto.indexOf(
                '# Lavarropas'
            );
    }


    /*
     * Si encontramos una sección de equipo,
     * buscamos dónde comienza la siguiente sección #.
     */

    if (seccionInicio !== -1) {

        const resto =
            texto.slice(
                seccionInicio + 1
            );

        const siguienteSeccion =
            resto.search(
                /\n# /
            );

        if (siguienteSeccion !== -1) {

            seccionFin =
                seccionInicio +
                1 +
                siguienteSeccion;
        }
    }


    let conocimientoEquipo =
        seccionInicio !== -1
            ? texto.slice(
                seccionInicio,
                seccionFin
            )
            : texto;


    /*
     * --------------------------------------------------------
     * BUSCAR SUBSECCIÓN RELACIONADA CON LA FALLA
     * --------------------------------------------------------
     */

    const lineas =
        conocimientoEquipo.split('\n');

    const palabrasFalla =
        fallaNormalizada
            .split(/[\s/(),.-]+/)
            .filter(palabra =>
                palabra.length >= 4
            );


    /*
     * Palabras que suelen ser demasiado genéricas.
     */
    const ignorar = new Set([
        'falla',
        'problema',
        'equipo',
        'servicio',
        'aire',
        'acondicionado',
        'heladera',
        'lavarropas',
        'lavadora',
        'hacer',
        'hace',
        'tiene'
    ]);


    const palabrasUtiles =
        palabrasFalla.filter(
            palabra =>
                !ignorar.has(palabra)
        );


    /*
     * Buscar encabezados ## que tengan relación
     * con la falla seleccionada.
     */

    let mejorIndice = -1;
    let mejorPuntaje = 0;

    for (
        let i = 0;
        i < lineas.length;
        i++
    ) {

        const linea =
            lineas[i]
                .toLowerCase()
                .normalize('NFD')
                .replace(
                    /[\u0300-\u036f]/g,
                    ''
                );

        if (!linea.startsWith('## ')) {
            continue;
        }

        let puntaje = 0;

        for (
            const palabra of palabrasUtiles
        ) {

            if (
                linea.includes(palabra)
            ) {
                puntaje++;
            }
        }

        if (puntaje > mejorPuntaje) {

            mejorPuntaje =
                puntaje;

            mejorIndice =
                i;
        }
    }


    /*
     * Si encontramos una subsección relevante,
     * devolvemos esa subsección + un poco de contexto.
     */

    if (mejorIndice !== -1) {

        let fin =
            lineas.length;

        for (
            let i = mejorIndice + 1;
            i < lineas.length;
            i++
        ) {

            if (
                lineas[i].startsWith(
                    '## '
                )
            ) {

                fin = i;
                break;
            }
        }

        const subseccion =
            lineas
                .slice(
                    mejorIndice,
                    fin
                )
                .join('\n');

        return subseccion.slice(
            0,
            6000
        );
    }


    /*
     * Si no encontramos una subsección concreta,
     * devolvemos la sección del equipo.
     */

    return conocimientoEquipo.slice(
        0,
        6000
    );
}


/*
============================================================
CONTEXTO OFICIAL DE MYSQL
============================================================
*/

async function obtenerContextoServicio(
    equipo,
    falla
) {

    const [rows] =
        await db.query(
            `
            SELECT
                precio,
                garantia
            FROM servicios
            WHERE equipo = ?
              AND falla = ?
            LIMIT 1
            `,
            [
                equipo,
                falla
            ]
        );


    if (rows.length === 0) {

        return {
            encontrado: false,
            precio: null,
            garantia: null,
            texto:
                'No hay un precio exacto registrado para esta combinación de equipo y falla.'
        };
    }


    const servicio =
        rows[0];


    return {

        encontrado: true,

        precio:
            servicio.precio,

        garantia:
            servicio.garantia,

        texto:
            `Precio registrado en ServiceVT: $${servicio.precio} ARS. ` +
            `Garantía registrada: ${servicio.garantia}.`
    };
}


/*
============================================================
OLLAMA
============================================================
*/

async function consultarOllama(prompt) {

    const controller = new AbortController();

    const inicio = Date.now();

    const timeout = setTimeout(() => {
        console.log(
            `[OLLAMA] Timeout después de ${Date.now() - inicio} ms`
        );

        controller.abort();
    }, OLLAMA_TIMEOUT_MS);

    try {

        console.log('[OLLAMA] Iniciando fetch...');
        console.log(`[OLLAMA] URL: ${OLLAMA_URL}`);
        console.log(`[OLLAMA] Prompt: ${prompt.length} caracteres`);

        const inicioFetch = Date.now();

        const response = await fetch(
            OLLAMA_URL,
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json'
                },

                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    prompt,
                    stream: false,
                    keep_alive: "10m",

                    options: {
                        temperature: 0.2,
                        num_predict: 50
                    }
                }),

                signal: controller.signal
            }
        );

        console.log(
            `[OLLAMA] Fetch respondió en ${Date.now() - inicioFetch} ms`
        );

        if (!response.ok) {
            throw new Error(
                `Ollama respondió HTTP ${response.status}`
            );
        }

        const inicioJson = Date.now();

        const data = await response.json();

        console.log(
            `[OLLAMA] JSON recibido en ${Date.now() - inicioJson} ms`
        );

        if (
            !data ||
            typeof data.response !== 'string'
        ) {
            throw new Error(
                'Ollama no devolvió una respuesta válida.'
            );
        }

        console.log(
            `[OLLAMA] Tiempo total: ${Date.now() - inicio} ms`
        );

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

const handleChat =async (req, res) => {

        const equipoSeleccionado =
            limpiarTexto(
                req.body?.equipoSeleccionado,
                100
            );


        const fallaSeleccionada =
            limpiarTexto(
                req.body?.fallaSeleccionada,
                255
            );


        const mensaje =
            limpiarTexto(
                req.body?.mensaje,
                MAX_MENSAJE
            );


        const historial =
            normalizarHistorial(
                req.body?.historial
            );


        /*
         * ----------------------------------------------------
         * VALIDACIÓN
         * ----------------------------------------------------
         */

        if (
            !equipoSeleccionado ||
            !fallaSeleccionada ||
            !mensaje
        ) {

            return res.status(400).json({

                error:
                    'Faltan parámetros obligatorios en la consulta.'
            });
        }


        try {

            console.log(
                `[CHAT] ${equipoSeleccionado} / ${fallaSeleccionada}`
            );


            /*
             * ------------------------------------------------
             * MYSQL
             * ------------------------------------------------
             */

            const contextoServicio =
                await obtenerContextoServicio(
                    equipoSeleccionado,
                    fallaSeleccionada
                );


            /*
             * ------------------------------------------------
             * CONOCIMIENTO TÉCNICO
             * ------------------------------------------------
             */

            const conocimiento =
                obtenerConocimientoRelevante(
                    equipoSeleccionado,
                    fallaSeleccionada
                );


            console.log(
                `[KNOWLEDGE] Contexto técnico seleccionado: ${conocimiento.length} caracteres`
            );



















            
            /*
             * ------------------------------------------------
             * CONVERSACIÓN
             * ------------------------------------------------
             */

            const conversacion =
                construirConversacion(
                    historial,
                    mensaje
                );


            /*
             * ------------------------------------------------
             * PROMPT
             * ------------------------------------------------
             *
             * IMPORTANTE:
             *
             * El modelo recibe explícitamente instrucciones
             * para razonar sobre suficiencia.
             *
             * No queremos que pregunte indefinidamente.
             */

     console.log('[CHAT] ===== MEDICIÓN PROMPT =====');
console.log('[CHAT] Historial mensajes:', historial.length);
console.log('[CHAT] Conversación:', conversacion.length, 'caracteres');
console.log('[CHAT] Servicio:', contextoServicio.texto.length, 'caracteres');
console.log('[CHAT] Knowledge:', conocimiento.length, 'caracteres');
console.log('[CHAT] Mensaje actual:', mensaje.length, 'caracteres');
console.log('[CHAT] ===========================');     
const prompt = `
DATOS DEL CASO
Equipo: ${equipoSeleccionado}
Servicio seleccionado: ${fallaSeleccionada}

DATOS OFICIALES
${contextoServicio.texto}

CONOCIMIENTO TÉCNICO
${conocimiento || 'Sin información técnica específica.'}

CONVERSACIÓN
${conversacion}

MENSAJE ACTUAL DEL CLIENTE
${mensaje}
`.trim();



            
            console.log('[OLLAMA] Generando respuesta...');
            console.log('[OLLAMA] Modelo:', OLLAMA_MODEL);


            /*
             * ------------------------------------------------
             * OLLAMA
             * ------------------------------------------------
             */

            const respuesta =
                await consultarOllama(
                    prompt
                );


            if (!respuesta) {

                throw new Error(
                    'El asistente devolvió una respuesta vacía.'
                );
            }


            /*
             * ------------------------------------------------
             * RESPUESTA
             * ------------------------------------------------
             */

            return res.status(200).json({

                respuesta,

                precio:
                    contextoServicio.encontrado
                        ? contextoServicio.precio
                        : null,

                garantia:
                    contextoServicio.encontrado
                        ? contextoServicio.garantia
                        : null
            });


        } catch (error) {

            console.error(
                '[CHAT] Error:',
                error.message
            );


            /*
             * Timeout de Ollama
             */

            if (
                error.name ===
                'AbortError'
            ) {

                return res.status(504).json({

                    error:
                        'El asistente está tardando demasiado en responder. Intentá nuevamente.'
                });
            }


            return res.status(500).json({

                error:
                    'No se pudo procesar la consulta del asistente.'
            });
        }
    };


/*
============================================================
EXPORT
============================================================
*/

module.exports = {
    handleChat
};