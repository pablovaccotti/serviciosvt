// agente_planta.js - Motor de Agente Autónomo con Razonamiento de Herramientas (Tools)
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./config/db'); // MySQL relacional de la planta
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// =========================================================================
// ⚙️ DEFINICIÓN DE LAS HERRAMIENTAS REALES (ACTIONS)
// =========================================================================

const herramientasEstructuradas = [
    {
        name: 'leer_archivo_proyecto',
        description: 'Lee el contenido de código real de un archivo existente en el disco duro del proyecto serviceVT para auditarlo o buscar errores.',
        parameters: {
            type: 'object',
            properties: {
                rutaRelativa: { type: 'string', description: 'La ruta del archivo a leer (ej: controllers/paymentController.js)' }
            },
            required: ['rutaRelativa']
        }
    },
    {
        name: 'escribir_archivo_proyecto',
        description: 'Escribe, reescribe o corrige de forma completa el código de un archivo físico en el disco duro del proyecto.',
        parameters: {
            type: 'object',
            properties: {
                rutaRelativa: { type: 'string', description: 'La ruta donde se guardará el archivo (ej: controllers/chatController.js)' },
                nuevoContenido: { type: 'string', description: 'Todo el código de JavaScript limpio y completo que se va a guardar en el archivo.' }
            },
            required: ['rutaRelativa', 'nuevoContenido']
        }
    },
    {
        name: 'mysql_agregar_servicio',
        description: 'Inserta de forma directa una nueva tarifa o falla en la base de datos MySQL relacional de serviceVT.',
        parameters: {
            type: 'object',
            properties: {
                equipo: { type: 'string', description: 'Categoría del equipo (ej: Heladera, Lavarropas, Aire Acondicionado)' },
                falla: { type: 'string', description: 'Descripción de la falla técnica (ej: Falla de termostato)' },
                precio: { type: 'number', description: 'Monto numérico en pesos ARS de la reparación' },
                garantia: { type: 'string', description: 'Tiempo de cobertura escrito (ej: 3 meses, 6 meses)' }
            },
            required: ['equipo', 'falla', 'precio', 'garantia']
        }
    }
];

// Lógica de ejecución de las herramientas en la computadora
async function ejecutarHerramienta(nombre, argumentos) {
    try {
        if (nombre === 'leer_archivo_proyecto') {
            const fullPath = path.join(__dirname, argumentos.rutaRelativa);
            if (!fs.existsSync(fullPath)) return `❌ El archivo ${argumentos.rutaRelativa} no existe.`;
            console.log(`🤖 [Agente] Abriendo y leyendo el código real de: ${argumentos.rutaRelativa}`);
            return fs.readFileSync(fullPath, 'utf8');
        }
        
        if (nombre === 'escribir_archivo_proyecto') {
            const fullPath = path.join(__dirname, argumentos.rutaRelativa);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, argumentos.nuevoContenido, 'utf8');
            return `✅ [Éxito Disco] Archivo "${argumentos.rutaRelativa}" guardado y corregido en el disco rígido de forma física.`;
        }

        if (nombre === 'mysql_agregar_servicio') {
            const [res] = await db.query(
                "INSERT INTO servicios (equipo, falla, precio, garantia) VALUES (?, ?, ?, ?)",
                [argumentos.equipo, argumentos.falla, argumentos.precio, argumentos.garantia]
            );
            return `✅ [Éxito MySQL] Nueva tarifa guardada en las tablas con ID asignado: ${res.insertId}`;
        }
    } catch (err) {
        return `❌ Error al ejecutar la herramienta autónoma: ${err.message}`;
    }
}

// =========================================================================
// 🧠 BUCLE DE RAZONAMIENTO DEL AGENTE (REASONING LOOP)
// =========================================================================

async function ejecutarBucleAgente(mensajeUsuario, historial = []) {
    const promptSistema = `
    Sos el Ingeniero de Software Principal de 'serviceVT'. Operás bajo una arquitectura estricta de separación de responsabilidades (MVC) conectada a MySQL.
    Mantené siempre tu tonada y modismos profesionales de desarrollador argentino (usá el voseo: "mirá", "contame", "quedate tranquilo").

    REGLAS DE RAZONAMIENTO:
    1. Si el usuario te pide auditar o corregir un archivo, NO INVENTES EL CÓDIGO. Tenés la herramienta 'leer_archivo_proyecto' para ver qué hay adentro en la realidad.
    2. Cuando escribas código nuevo en la carpeta 'controllers', asegurate de que exporte funciones limpias. No uses 'express.Router()' ni crees pools duplicados de MySQL ahí adentro.
    3. Si el usuario te da el visto bueno para impactar un cambio, ejecutá la herramienta de escritura.
    `;

    historial.push({ role: 'user', content: mensajeUsuario });

    try {
        // Le mandamos las herramientas estructuradas de forma oficial a Ollama
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'servicevt-bot:latest', 
                messages: [{ role: 'system', content: promptSistema }, ...historial],
                tools: herramientasEstructuradas, // Inyección de herramientas de la API de Ollama
                stream: false
            })
        });

        const data = await response.json();
        const respuestaBot = data.message;

        historial.push(respuestaBot);

        // 🔎 EVALUACIÓN: ¿La IA razonó que necesita ejecutar una herramienta?
        if (respuestaBot.tool_calls && respuestaBot.tool_calls.length > 0) {
            for (const llamada of respuestaBot.tool_calls) {
                console.log(`\n🧠 [Razonamiento IA] El agente decidió usar de forma autónoma la herramienta: "${llamada.function.name}"`);
                
                // Ejecutamos la acción real en la computadora
                const resultadoAccion = await ejecutarHerramienta(llamada.function.name, llamada.function.arguments);
                console.log(resultadoAccion);

                // Le devolvemos el resultado del disco o de MySQL a la IA para que continúe su razonamiento
                historial.push({
                    role: 'tool',
                    content: resultadoAccion
                });
            }
            // Re-ejecutamos el bucle para que el bot lea el resultado real y te responda con la verdad
            return ejecutarBucleAgente("Procesá el resultado de la herramienta que acabás de ejecutar y dale una respuesta final al usuario.", historial);
        }

        // Si no necesita más herramientas, te muestra su conclusión final en español por pantalla
        console.log("\n=======================================================");
        console.log("💬 RESPUESTA DEL AGENTE TÉCNICO AUTÓNOMO");
        console.log("=======================================================\n");
        console.log(respuestaBot.content);

    } catch (error) {
        console.error("❌ Error de comunicación con Ollama:", error.message);
    }
}

function iniciarConsola() {
    rl.question('\n📝 Orden para el Agente (o escribí "salir"): ', async (input) => {
        if (input.toLowerCase() === 'salir') { rl.close(); process.exit(0); }
        await ejecutarBucleAgente(input);
        iniciarConsola();
    });
}

console.log("🚀 Agente de Planta Inteligente de serviceVT Activado.");
iniciarConsola();
