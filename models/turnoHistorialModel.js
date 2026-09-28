// models/turnoHistorialModel.js - F2 Agenda
// Solo registra transiciones operativas. No guarda datos sensibles.
const db = require('../config/db');

class TurnoHistorialModel {
    static async registrar(connection, turnosId, usuariosId, estadoAnterior, estadoNuevo, observacion) {
        const [result] = await connection.query(
            `INSERT INTO turno_historial
                (turnos_id, usuarios_id, estado_anterior, estado_nuevo, observacion)
              VALUES (?, ?, ?, ?, ?)`,
            [turnosId, usuariosId || null, estadoAnterior || null, estadoNuevo, observacion || null]
        );

        return result;
    }

    static async listarPorTurno(turnosId) {
        const [rows] = await db.query(
            `SELECT historial_id, turnos_id, usuarios_id, estado_anterior, estado_nuevo, fecha, observacion
              FROM turno_historial
              WHERE turnos_id = ?
              ORDER BY fecha ASC, historial_id ASC`,
            [turnosId]
        );

        return rows;
    }
}

module.exports = TurnoHistorialModel;
