// models/cuadrillaModel.js - F2 Agenda (solo lectura/estructura, sin tecnicos asignados aun)
const db = require('../config/db');

class CuadrillaModel {
    static async listar() {
        const [rows] = await db.query(
            `SELECT cuadrilla_id, nombre, activa, fecha_creacion
              FROM cuadrillas
              ORDER BY cuadrilla_id ASC`
        );

        return rows;
    }

    static async buscarPorId(cuadrillaId) {
        const [rows] = await db.query(
            `SELECT cuadrilla_id, nombre, activa, fecha_creacion
              FROM cuadrillas
              WHERE cuadrilla_id = ?
              LIMIT 1`,
            [cuadrillaId]
        );

        return rows[0] || null;
    }

    static async buscarServiceVT() {
        const [rows] = await db.query(
            `SELECT cuadrilla_id, nombre, activa, fecha_creacion
              FROM cuadrillas
              WHERE nombre = 'ServiceVT'
              LIMIT 1`
        );

        return rows[0] || null;
    }
}

module.exports = CuadrillaModel;
