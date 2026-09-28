// routes/turnosRoutes.js - F2 Agenda (solo admin en F2)
// El endpoint legacy POST /api/pagos/finalizar-trabajo se mantiene sin cambios.
const express = require('express');

const router = express.Router();

const {
    programar,
    iniciar,
    finalizar,
    cancelar,
    reprogramar,
    actual,
    proximos,
    pendientes,
    cuadrillas,
    historial
} = require('../controllers/turnosController');

const {
    verificarToken,
    verificarAdmin
} = require('../middlewares/authMiddleware');

router.post('/programar', verificarToken, verificarAdmin, programar);
router.post('/iniciar', verificarToken, verificarAdmin, iniciar);
router.post('/finalizar', verificarToken, verificarAdmin, finalizar);
router.post('/cancelar', verificarToken, verificarAdmin, cancelar);
router.post('/reprogramar', verificarToken, verificarAdmin, reprogramar);

router.get('/actual', verificarToken, verificarAdmin, actual);
router.get('/proximos', verificarToken, verificarAdmin, proximos);
// F5: pendientes de programacion (solo lectura, admin).
router.get('/pendientes', verificarToken, verificarAdmin, pendientes);
router.get('/cuadrillas', verificarToken, verificarAdmin, cuadrillas);
router.get('/historial', verificarToken, verificarAdmin, historial);

module.exports = router;
