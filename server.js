require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT) || 3000;

const server = app.listen(PORT, () => {
    console.log(
        `[serviceVT-Backend] Servidor iniciado en puerto ${PORT}`
    );
});

process.on('SIGTERM', () => {
    console.log('[serviceVT] Cerrando servidor...');

    server.close(() => {
        console.log('[serviceVT] Servidor cerrado.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('[serviceVT] Cerrando servidor...');

    server.close(() => {
        console.log('[serviceVT] Servidor cerrado.');
        process.exit(0);
    });
});
