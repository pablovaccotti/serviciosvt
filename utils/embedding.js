const fs = require('fs');
const path = require('path');

const OLLAMA_URL = 'http://127.0.0.1:11434/api/embeddings';
const OLLAMA_MODEL = 'nomic-embed-text:latest';

const KNOWLEDGE_PATH = path.join(
    __dirname,
    '..',
    'knowledge',
    'serviceVT_base_conocimiento_v1.md'
);
let indice = [];

/**
 * Divide knowledge.md en bloques.
 * Conservamos el título del equipo (#)
 * y el título específico (##) junto con su contenido.
 */
function dividirConocimiento(texto) {
    const bloques = [];
    let equipoActual = null;
    let bloqueActual = null;

    const lineas = texto.split('\n');

    for (const linea of lineas) {
        const lineaLimpia = linea.trim();

        if (lineaLimpia.startsWith('# ') && !lineaLimpia.startsWith('## ')) {
            equipoActual = lineaLimpia.replace(/^#\s+/, '').trim();
            continue;
        }

        if (lineaLimpia.startsWith('## ')) {
            if (bloqueActual) {
                bloques.push(bloqueActual);
            }

            bloqueActual = {
                equipo: equipoActual,
                titulo: lineaLimpia.replace(/^##\s+/, '').trim(),
                contenido: ''
            };

            continue;
        }

        if (bloqueActual) {
            bloqueActual.contenido += linea + '\n';
        }
    }

    if (bloqueActual) {
        bloques.push(bloqueActual);
    }

    return bloques.map(bloque => ({
        ...bloque,
        texto: `${bloque.equipo} - ${bloque.titulo}\n${bloque.contenido}`.trim()
    }));
}

/**
 * Genera un embedding usando Ollama.
 */
async function generarEmbedding(texto) {
    const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: texto
        })
    });

    if (!response.ok) {
        throw new Error(
            `Error Ollama embeddings: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    return data.embedding;
}

/**
 * Similitud coseno entre dos vectores.
 */
function similitudCoseno(a, b) {
    let producto = 0;
    let normaA = 0;
    let normaB = 0;

    for (let i = 0; i < a.length; i++) {
        producto += a[i] * b[i];
        normaA += a[i] * a[i];
        normaB += b[i] * b[i];
    }

    if (normaA === 0 || normaB === 0) {
        return 0;
    }

    return producto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/**
 * Carga knowledge.md y genera el índice.
 *
 * Esto se ejecuta una vez al iniciar el servidor.
 */
async function inicializarEmbeddings() {
    console.log('[EMBEDDINGS] Cargando knowledge.md...');

    const texto = fs.readFileSync(KNOWLEDGE_PATH, 'utf8');

    const bloques = dividirConocimiento(texto);

    console.log(`[EMBEDDINGS] Bloques encontrados: ${bloques.length}`);

    indice = [];

    for (const bloque of bloques) {
        console.log(
            `[EMBEDDINGS] Generando: ${bloque.equipo} → ${bloque.titulo}`
        );

        const embedding = await generarEmbedding(bloque.texto);

        indice.push({
            ...bloque,
            embedding
        });
    }

    console.log(
        `[EMBEDDINGS] Índice listo: ${indice.length} bloques`
    );
}

/**
 * Busca los fragmentos más relacionados con una consulta.
 */
async function buscarConocimientoSemantico(
    equipo,
    falla,
    mensaje,
    cantidad = 2
) {
    if (!indice.length) {
        throw new Error(
            'El índice de embeddings todavía no fue inicializado.'
        );
    }

    const consulta = `
Equipo: ${equipo}
Falla seleccionada: ${falla}
Mensaje del cliente: ${mensaje}
`.trim();

    console.log('[EMBEDDINGS] Consulta:', consulta);

    const embeddingConsulta = await generarEmbedding(consulta);

    const resultados = indice
        .map(bloque => ({
            ...bloque,
            similitud: similitudCoseno(
                embeddingConsulta,
                bloque.embedding
            )
        }))
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, cantidad);

    return resultados;
}

module.exports = {
    inicializarEmbeddings,
    buscarConocimientoSemantico
};