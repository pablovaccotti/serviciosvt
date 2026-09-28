// models/tecnicoModel.js - F2 Agenda
// Estructura preparada. En F2 NO se crean ni asignan tecnicos.
// Los usuarios_id reales se asociaran en una fase posterior.
const db = require('../config/db');

class TecnicoModel {
    static async crear(nombre, telefono, usuariosId) {
        const [result] = await db.query(
            `INSERT INTO tecnicos (nombre, telefono, usuarios_id, activo)
              VALUES (?, ?, ?, 1)`,
            [nombre, telefono || null, usuariosId || null]
        );

        return result;
    }

    static async buscarPorId(tecnicoId) {
        const [rows] = await db.query(
            `SELECT tecnico_id, usuarios_id, nombre, telefono, activo, fecha_alta
              FROM tecnicos
              WHERE tecnico_id = ?
              LIMIT 1`,
            [tecnicoId]
        );

        return rows[0] || null;
    }

    static async listarPorCuadrilla(cuadrillaId) {
        const [rows] = await db.query(
            `SELECT t.tecnico_id, t.usuarios_id, t.nombre, t.telefono, t.activo, t.fecha_alta
              FROM tecnicos t
              INNER JOIN cuadrilla_tecnicos ct
                 ON ct.tecnico_id = t.tecnico_id
              WHERE ct.cuadrilla_id = ?
              ORDER BY t.tecnico_id ASC`,
            [cuadrillaId]
        );

        return rows;
    }

    static async asociarACuadrilla(cuadrillaId, tecnicoId) {
        const [result] = await db.query(
            `INSERT IGNORE INTO cuadrilla_tecnicos (cuadrilla_id, tecnico_id)
              VALUES (?, ?)`,
            [cuadrillaId, tecnicoId]
        );

        return result;
    }
}

module.exports = TecnicoModel;
