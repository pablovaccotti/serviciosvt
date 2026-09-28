const fs = require('fs');
const path = require('path');

// En lugar de archivos enteros, le pasamos fragmentos microscópicos de código para que la IA responda en 2 segundos
const microCodigos = [
    {
        modulo: "Lógica del Bot de IA (chatController.js)",
        codigo: `const handleChat = async (req, res) => {
    const { mensaje, equipoSeleccionado, fallaSeleccionada } = req.body;
    try {
        const servicio = await ServiceModel.getByEquipmentAndIssue(equipoSeleccionado, fallaSeleccionada);
        let contextoPrecio = "No encontramos tarifas exactas.";
        if (servicio) {
            contextoPrecio = \`El precio actual en sistema es de \$\${servicio.precio} ARS con garantía de \$\${servicio.garantia}.\`;
        }
        const promptConContexto = \`[CONTEXTO] \${contextoPrecio} [CLIENTE] \${mensaje}\`;
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'servicevt-bot', prompt: promptConContexto, stream: false })
        });
        const data = await response.json();
        res.status(200).json({ respuesta: data.response });
    } catch (error) { res.status(500).json({ error: 'Error con Ollama.' }); }
};`
    },
    {
        modulo: "Seguridad y Rutas (authMiddleware.js y app.js)",
        codigo: `const verificarAdmin = (req, res, next) => { next(); }; // Middleware actual
// Configuración de rutas en app.js
app.use(cors());
app.use(express.json());
app.use('/api/servicios', serviceRoutes);
app.use('/api/chat', chatRoutes);`
    }
];

async function iniciarAnalisisMicro() {
    console.log("🚀 Iniciando Análisis Micro-Optimizado para hardware local...");
    let reporte = "=======================================================\n" +
                   "📋 REPORTE DE AUDITORÍA MICRO - SERVICEVT\n" +
                   "=======================================================\n\n";

    for (const micro of microCodigos) {
        console.log(`⏳ Auditando de forma ultra-rápida: ${micro.modulo}...`);
        
        try {
            const response = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'servicevt-bot:latest',
                    messages: [
                        { role: 'system', content: 'Sos un programador senior argentino. Vas directo al grano, detectás el peligro y decís cómo solucionarlo en 2 renglones.' },
                        { role: 'user', content: `Mirá este pedazo de código de serviceVT. Decime qué peligro hay si esto escala para campañas masivas y cómo lo arreglo:\n\n${micro.codigo}` }
                    ],
                    stream: false
                })
            });

            const data = await response.json();
            reporte += `### 📦 Módulo: ${micro.modulo}\n${data.message.content}\n\n`;
            console.log(`✅ ¡Completado!`);
        } catch (error) {
            reporte += `### 📦 Módulo: ${micro.modulo}\n❌ Error al procesar fragmento.\n\n`;
            console.log(`❌ Falló por conexión.`);
        }
    }

    fs.writeFileSync(path.join(__dirname, 'reporte_micro.txt'), reporte);
    console.log("\n=======================================================");
    console.log("¡AUDITORÍA MICRO FINALIZADA! Reporte en 'reporte_micro.txt'");
    console.log("=======================================================\n");
    console.log(reporte);
}

iniciarAnalisisMicro();
