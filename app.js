const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const serviceRoutes = require('./routes/serviceRoutes');
const chatRoutes = require('./routes/chatRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const authRoutes = require('./routes/authRoutes');
const turnosRoutes = require('./routes/turnosRoutes');

const app = express();

const frontendUrl =
    process.env.FRONTEND_URL || 'http://localhost:3000';

// ...

app.use(
    express.json({
        limit: '100kb'
    })
);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use('/api/servicios', serviceRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/pagos', paymentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/turnos', turnosRoutes);

// 404 al final
app.use((req, res) => {
    res.status(404).json({
        error: 'Ruta no encontrada.'
    });
});

module.exports = app;