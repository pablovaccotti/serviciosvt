const express = require('express');

const router = express.Router();

const {
    loginRapidoTelefono
} = require('../controllers/authController');

router.post(
    '/login-rapido',
    loginRapidoTelefono
);

module.exports = router;