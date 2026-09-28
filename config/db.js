// config/db.js

const mysql = require('mysql2');

const requiredEnv = [
    'DB_HOST',
    'DB_USER',
    'DB_NAME'
];

for (const variable of requiredEnv) {
    if (!process.env[variable]) {
        throw new Error(
            `[MySQL] Falta la variable ${variable} en el archivo .env`
        );
    }
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    charset: 'utf8mb4'
});

const promisePool = pool.promise();

promisePool
    .getConnection()
    .then((connection) => {
        console.log(
            '✅ [MySQL] Conexión verificada correctamente.'
        );

        connection.release();
    })
    .catch((error) => {
        console.error(
            '❌ [MySQL] No se pudo conectar a la base de datos.'
        );

        console.error(
            `[MySQL] ${error.message}`
        );
    });

module.exports = promisePool;