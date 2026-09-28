const express = require('express');

const router = express.Router();

const {
    procesarSolicitudServicio,
    confirmarPagoOnline,
    webhookMercadoPago,
    finalizarTrabajoActual
} = require('../controllers/paymentController');

const {
    verificarToken,
    verificarAdmin
} = require('../middlewares/authMiddleware');

/*
 * Cliente autenticado solicita un servicio.
 */
router.post(
    '/solicitar',
    verificarToken,
    procesarSolicitudServicio
);

/*
 * Mercado Pago llama a esta ruta.
 *
 * NO lleva JWT porque Mercado Pago no tiene
 * nuestro token de usuario.
 */
router.post(
    '/webhook',
    webhookMercadoPago
);

/*
 * Retorno visual del Checkout.
 *
 * NO confirma el pago.
 */
router.get(
    '/confirmar-online',
    confirmarPagoOnline
);

/*
 * Solo administrador autenticado.
 */
router.post(
    '/finalizar-trabajo',
    verificarToken,
    verificarAdmin,
    finalizarTrabajoActual
);

module.exports = router;