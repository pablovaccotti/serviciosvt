const UserModel = require('../models/userModel');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error(
        'ERROR DE CONFIGURACIÓN: JWT_SECRET no está definido en el archivo .env'
    );
}

const normalizarTelefono = (telefono) => {
    return String(telefono || '')
        .trim()
        .replace(/[^\d+]/g, '');
};

const loginRapidoTelefono = async (req, res) => {
    try {
        const telefono = normalizarTelefono(req.body?.telefono);

        if (!telefono) {
            return res.status(400).json({
                error: 'El número de teléfono es obligatorio.'
            });
        }

        if (telefono.length < 8 || telefono.length > 20) {
            return res.status(400).json({
                error: 'El número de teléfono no tiene un formato válido.'
            });
        }

        const usuario = await UserModel.findOrCreateByPhone(telefono);

        const token = jwt.sign(
            {
                usuariosId: usuario.usuarios_id,
                rol: usuario.rol
            },
            JWT_SECRET,
            {
                expiresIn: '24h',
                issuer: 'serviceVT',
                audience: 'serviceVT-client'
            }
        );

        return res.status(200).json({
            message: 'Identificación exitosa en serviceVT.',
            token,
            usuario: {
                usuariosId: usuario.usuarios_id,
                telefono: usuario.telefono,
                rol: usuario.rol
            }
        });

    } catch (error) {
        console.error('[AUTH] Error:', error);

        return res.status(500).json({
            error: 'No se pudo procesar la identificación.'
        });
    }
};

module.exports = {
    loginRapidoTelefono
};