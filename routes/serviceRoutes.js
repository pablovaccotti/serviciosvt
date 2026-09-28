const express = require('express');
const router = express.Router();
const { getServices, updateServicePrice, createService } = require('../controllers/serviceController');
const { verificarToken, verificarAdmin } = require('../middlewares/authMiddleware');

router.get('/', getServices);
router.put('/update-price', verificarToken, verificarAdmin, updateServicePrice); // Solo admin
router.post('/add', verificarToken, verificarAdmin, createService);               // Solo admin

module.exports = router;
