const db = require('../config/db');

class ServiceModel {

    static async getAll() {
        const [rows] = await db.query(
            `SELECT servicios_id, equipo, falla, precio, garantia
             FROM servicios
             ORDER BY servicios_id ASC`
        );

        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query(
            `SELECT servicios_id, equipo, falla, precio, garantia
             FROM servicios
             WHERE servicios_id = ?
             LIMIT 1`,
            [id]
        );

        return rows[0] || null;
    }

    static async getByEquipmentAndIssue(equipo, falla) {
        const [rows] = await db.query(
            `SELECT servicios_id, precio, garantia
             FROM servicios
             WHERE equipo = ?
             AND falla = ?
             LIMIT 1`,
            [equipo, falla]
        );

        return rows[0] || null;
    }

    static async updatePrice(id, nuevoPrecio) {
        const [result] = await db.query(
            `UPDATE servicios
             SET precio = ?
             WHERE servicios_id = ?`,
            [nuevoPrecio, id]
        );

        return result;
    }

    static async create(equipo, falla, precio, garantia) {
        const [result] = await db.query(
            `INSERT INTO servicios
                (equipo, falla, precio, garantia)
             VALUES (?, ?, ?, ?)`,
            [equipo, falla, precio, garantia]
        );

        return result;
    }
}

module.exports = ServiceModel;