const ServiceModel = require('../models/serviceModel');

const PRECIO_MIN = 1;
const PRECIO_MAX = 100000000;

const esEnteroPositivo = (valor) => {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0;
};

const esPrecioValido = (valor) => {
    const numero = Number(valor);
    return Number.isInteger(numero) && numero >= PRECIO_MIN && numero <= PRECIO_MAX;
};

const normalizarTexto = (valor) => String(valor ?? '').trim();
const getServices = async (req, res) => {
    try {
        const services = await ServiceModel.getAll();
        res.status(200).json(services);
    } catch (error) {
        res.status(500).json({ error: 'Error en la base de datos.' });
    }

};


// ... (Acá se mantiene tu función getServices anterior) ...

const updateServicePrice = async (req, res) => {
    const id = Number(req.body?.id);
    const precio = Number(req.body?.precio);

    if (!esEnteroPositivo(id)) {
        return res.status(400).json({ error: 'El ID del servicio no es válido.' });
    }

    if (!esPrecioValido(precio)) {
        return res.status(400).json({ error: 'El precio no es válido.' });
    }

    try {
        const resultado = await ServiceModel.updatePrice(id, precio);

        if (!resultado || resultado.affectedRows === 0) {
            return res.status(404).json({ error: 'El servicio no existe.' });
        }

        res.status(200).json({ message: 'Precio actualizado con éxito en MySQL.' });
    } catch (error) {
        console.error('[SERVICE] Error al actualizar el precio:', error);
        res.status(500).json({ error: 'Error al actualizar el precio.' });
    }
};

const createService = async (req, res) => {
    const equipo = normalizarTexto(req.body?.equipo);
    const falla = normalizarTexto(req.body?.falla);
    const garantia = normalizarTexto(req.body?.garantia);
    const precio = Number(req.body?.precio);

    if (equipo.length < 2 || equipo.length > 80) {
        return res.status(400).json({ error: 'El equipo no es válido.' });
    }

    if (falla.length < 3 || falla.length > 150) {
        return res.status(400).json({ error: 'La falla no es válida.' });
    }

    if (garantia.length < 2 || garantia.length > 80) {
        return res.status(400).json({ error: 'La garantía no es válida.' });
    }

    if (!esPrecioValido(precio)) {
        return res.status(400).json({ error: 'El precio no es válido.' });
    }

    try {
        const resultado = await ServiceModel.create(equipo, falla, precio, garantia);
        res.status(201).json({ message: 'Nueva falla registrada con éxito.', insertId: resultado.insertId });
    } catch (error) {
        console.error('[SERVICE] Error al guardar el nuevo servicio:', error);
        res.status(500).json({ error: 'Error al guardar el nuevo servicio.' });
    }
};

module.exports = { getServices, updateServicePrice, createService };

