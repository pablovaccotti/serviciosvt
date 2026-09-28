const jwt = require('jsonwebtoken');
const UserModel = require('../models/userModel');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error(
        'ERROR DE CONFIGURACIÓN: JWT_SECRET no está definido.'
    );
};

const verificarToken = async (req, res, next) => {
    try {
        const authorization = req.headers.authorization;

        if (!authorization || !authorization.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Token de autenticación requerido.'
            });
        }

        const token = authorization.substring(7).trim();

        if (!token) {
            return res.status(401).json({
                error: 'Token inválido.'
            });
        }

        const payload = jwt.verify(token, JWT_SECRET, {
            issuer: 'serviceVT',
            audience: 'serviceVT-client'
        });

        if (!payload.usuariosId) {
            return res.status(401).json({
                error: 'Token inválido.'
            });
        }

        // Verificamos nuevamente contra MySQL.
        // Así, si se cambia el rol de un usuario,
        // no dependemos exclusivamente de lo que diga un JWT viejo.
        const usuario = await UserModel.findById(payload.usuariosId);

        if (!usuario) {
            return res.status(401).json({
                error: 'El usuario ya no existe.'
            });
        }

        req.user = {
            usuariosId: usuario.usuarios_id,
            telefono: usuario.telefono,
            rol: usuario.rol
        };

        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'El token expiró. Volvé a identificarte.'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Token de autenticación inválido.'
            });
        }

        console.error('[AUTH MIDDLEWARE] Error:', error);

        return res.status(500).json({
            error: 'Error interno de autenticación.'
        });
    }
};

const verificarAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'No estás autenticado.'
        });
    }

    if (req.user.rol !== 'admin') {
        return res.status(403).json({
            error: 'No tenés permisos de administrador.'
        });
    }

    next();
};

module.exports = {
    verificarToken,
    verificarAdmin
};