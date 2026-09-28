const db = require('../config/db');

class UserModel {
    static async findOrCreateByPhone(telefono) {
        const telefonoNormalizado = String(telefono).trim();

        const [rows] = await db.query(
            `SELECT usuarios_id, telefono, rol, fecha_registro
             FROM usuarios
             WHERE telefono = ?
             LIMIT 1`,
            [telefonoNormalizado]
        );

        if (rows.length > 0) {
            return rows[0];
        }

        const [result] = await db.query(
            `INSERT INTO usuarios (telefono, rol)
             VALUES (?, 'cliente')`,
            [telefonoNormalizado]
        );

        return {
            usuarios_id: result.insertId,
            telefono: telefonoNormalizado,
            rol: 'cliente'
        };
    }

    static async findById(usuariosId) {
        const [rows] = await db.query(
            `SELECT usuarios_id, telefono, rol, fecha_registro
             FROM usuarios
             WHERE usuarios_id = ?
             LIMIT 1`,
            [usuariosId]
        );

        return rows[0] || null;
    }
}

module.exports = UserModel;