const db = require('../config/db');

// F4-B: estados que TurnoModel.crear() acepta como estado inicial.
// 'pendiente_programacion' es el estado oficial del flujo nuevo.
// 'pendiente_pago' se conserva TEMPORALMENTE por compatibilidad legacy
// (fixtures F2 y callers antiguos lo usan como estado inicial de MP;
// el flujo nuevo de MP usa crearPendientePago() y luego aprobar pasa a
// pendiente_programacion). NUNCA se acepta 'en_progreso' ni
// 'en_lista_espera' como estado inicial: crearian trabajo sin bloque.
const ESTADOS_CREAR_PERMITIDOS = ['pendiente_programacion', 'pendiente_pago'];

const errorCrearConCodigo = (codigo, mensaje) => {
    const error = new Error(mensaje || codigo);
    error.code = codigo;
    return error;
};

class TurnoModel {

    // LEGACY DEPRECADA (compatibilidad con turnos antiguos sin agenda).
    // F3A: ningun flujo nuevo de pago/agenda debe usarlo.
    // F4-B: solo lectura para diagnostico/tests. Jamas inicia trabajo.
    // Candidata a deprecacion cuando se elimine /api/pagos/finalizar-trabajo.
    static async verificarTrabajoActivo() {
        const [rows] = await db.query(
            `SELECT turnos_id
             FROM turnos
             WHERE estado_turno = 'en_progreso'
             LIMIT 1`
        );

        return rows;
    }

    static async crear(
        usuarioId,
        servicioId,
        metodoPago,
        estadoPago,
        estadoTurno
    ) {
        // F4-B INVARIANTE A: ningun caller nuevo puede crear en_progreso
        // (ni en_lista_espera) sin pasar por agenda. Firma intacta por
        // compatibilidad; rechazo controlado con codigo.
        if (!ESTADOS_CREAR_PERMITIDOS.includes(estadoTurno)) {
            throw errorCrearConCodigo(
                'ESTADO_TURNO_NO_PERMITIDO',
                `TurnoModel.crear rechaza estado_turno='${estadoTurno}'. ` +
                `Permitidos: ${ESTADOS_CREAR_PERMITIDOS.join(', ')}.`
            );
        }

        const [result] = await db.query(
            `INSERT INTO turnos
                (
                    usuarios_id,
                    servicios_id,
                    metodo_pago,
                    estado_pago,
                    estado_turno
                )
             VALUES (?, ?, ?, ?, ?)`,
            [
                usuarioId,
                servicioId,
                metodoPago,
                estadoPago,
                estadoTurno
            ]
        );

        return result;
    }

    static async crearPendientePago(usuarioId, servicioId) {
        const [result] = await db.query(
            `INSERT INTO turnos
                (
                    usuarios_id,
                    servicios_id,
                    metodo_pago,
                    estado_pago,
                    estado_turno
                )
             VALUES (?, ?, 'mercado_pago', 'pendiente', 'pendiente_pago')`,
            [usuarioId, servicioId]
        );

        return result;
    }

    static async guardarDatosMercadoPago(
        turnoId,
        preferenceId,
        externalReference
    ) {
        const [result] = await db.query(
            `UPDATE turnos
             SET
                mp_preference_id = ?,
                mp_external_reference = ?
             WHERE turnos_id = ?`,
            [
                preferenceId,
                externalReference,
                turnoId
            ]
        );

        return result;
    }

    static async buscarPorId(turnoId) {
        const [rows] = await db.query(
            `SELECT
                t.turnos_id,
                t.usuarios_id,
                t.servicios_id,
                t.metodo_pago,
                t.estado_pago,
                t.estado_turno,
                t.fecha_creacion,
                t.mp_payment_id,
                t.mp_preference_id,
                t.mp_external_reference,
                s.precio,
                s.equipo,
                s.falla,
                u.telefono
             FROM turnos t
             INNER JOIN servicios s
                ON s.servicios_id = t.servicios_id
             INNER JOIN usuarios u
                ON u.usuarios_id = t.usuarios_id
             WHERE t.turnos_id = ?
             LIMIT 1`,
            [turnoId]
        );

        return rows[0] || null;
    }

    static async buscarPorExternalReference(externalReference) {
        const [rows] = await db.query(
            `SELECT
                t.turnos_id,
                t.usuarios_id,
                t.servicios_id,
                t.metodo_pago,
                t.estado_pago,
                t.estado_turno,
                t.fecha_creacion,
                t.mp_payment_id,
                t.mp_preference_id,
                t.mp_external_reference,
                s.precio,
                s.equipo,
                s.falla,
                u.telefono
             FROM turnos t
             INNER JOIN servicios s
                ON s.servicios_id = t.servicios_id
             INNER JOIN usuarios u
                ON u.usuarios_id = t.usuarios_id
             WHERE t.mp_external_reference = ?
             LIMIT 1`,
            [externalReference]
        );

        return rows[0] || null;
    }

    static async aprobarPagoMercadoPago(
        turnoId,
        paymentId
    ) {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [rows] = await connection.query(
                `SELECT
                    turnos_id,
                    estado_pago,
                    estado_turno
                 FROM turnos
                 WHERE turnos_id = ?
                 FOR UPDATE`,
                [turnoId]
            );

            if (rows.length === 0) {
                throw new Error('TURN_NOT_FOUND');
            }

            const turno = rows[0];

            // Idempotencia:
            // si Mercado Pago manda el mismo webhook nuevamente,
            // no volvemos a procesar el turno.
            if (turno.estado_pago === 'aprobado') {
                await connection.commit();

                return {
                    yaProcesado: true,
                    estadoPago: turno.estado_pago,
                    estadoTurno: turno.estado_turno
                };
            }

            // F3A: pago aprobado != trabajo iniciado.
            // El turno aprobado queda pendiente de programacion.
            // Solo POST /api/turnos/iniciar inicia trabajo.
            // No se busca trabajo activo, no se usa en_lista_espera,
            // no se crea bloque, no se auto-promueve nada.
            const nuevoEstadoTurno =
                turno.estado_turno === 'pendiente_pago'
                    ? 'pendiente_programacion'
                    : turno.estado_turno;

            await connection.query(
                `UPDATE turnos
                 SET
                    estado_pago = 'aprobado',
                    estado_turno = ?,
                    mp_payment_id = ?
                 WHERE turnos_id = ?`,
                [
                    nuevoEstadoTurno,
                    String(paymentId),
                    turnoId
                ]
            );

            await connection.commit();

            return {
                yaProcesado: false,
                estadoPago: 'aprobado',
                estadoTurno: nuevoEstadoTurno
            };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async marcarPagoRechazado(turnoId) {
        const [result] = await db.query(
            `UPDATE turnos
             SET estado_pago = 'rechazado'
             WHERE turnos_id = ?
             AND estado_pago <> 'aprobado'`,
            [turnoId]
        );

        return result;
    }

    // F3A: el endpoint legacy /api/pagos/finalizar-trabajo
    // no debe operar sobre turnos con bloque de agenda activo.
    // Solo lectura, sin modificar el bloque.
    static async tieneBloqueActivo(turnoId) {
        const [rows] = await db.query(
            `SELECT bloque_id
              FROM agenda_bloques
              WHERE turnos_id = ?
              AND estado IN ('reservado', 'en_progreso')
              LIMIT 1`,
            [turnoId]
        );

        return rows.length > 0;
    }

    static async marcarComoFinalizado(turnoId) {
        const [result] = await db.query(
            `UPDATE turnos
             SET estado_turno = 'finalizado'
             WHERE turnos_id = ?
             AND estado_turno = 'en_progreso'`,
            [turnoId]
        );

        return result;
    }

    // LEGACY DEPRECADA (F4-B): solo lectura para compatibilidad.
    // Ya no debe usarse para decidir promociones: aprobarPagoMercadoPago
    // (F3A) nunca encola ni inicia trabajo.
    // F3A: la agenda nueva nunca auto-promueve turnos.
    static async obtenerSiguienteEnFila() {
        const [rows] = await db.query(
            `SELECT
                t.turnos_id,
                t.usuarios_id,
                u.telefono,
                s.equipo,
                s.falla
             FROM turnos t
             INNER JOIN usuarios u
                ON t.usuarios_id = u.usuarios_id
             INNER JOIN servicios s
                ON t.servicios_id = s.servicios_id
             WHERE t.estado_turno = 'en_lista_espera'
             AND t.estado_pago = 'aprobado'
             ORDER BY t.fecha_creacion ASC
             LIMIT 1`
        );

        return rows[0] || null;
    }

    // LEGACY DEPRECADA Y ENDURECIDA (F4-B): jamas debe crear un
    // 'en_progreso' sin bloque de agenda en estado reservado/en_progreso.
    // INVARIANTE A/D: sin bloque valido se rechaza con error controlado
    // (codigo SIN_BLOQUE_AGENDA) y el turno queda intacto.
    // El flujo nuevo inicia trabajo SOLO via AgendaModel.iniciar().
    // Se conserva la funcion porque existen callers legacy y tests que
    // deben verificar el rechazo; no llamarla desde codigo nuevo.
    static async activarTurnoPendiente(turnoId) {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [turnos] = await connection.query(
                `SELECT turnos_id, estado_turno, estado_pago
                  FROM turnos
                  WHERE turnos_id = ?
                  FOR UPDATE`,
                [turnoId]
            );

            if (turnos.length === 0) {
                await connection.rollback();

                return { affectedRows: 0 };
            }

            const [bloques] = await connection.query(
                `SELECT bloque_id
                  FROM agenda_bloques
                  WHERE turnos_id = ?
                  AND estado IN ('reservado', 'en_progreso')
                  LIMIT 1
                  FOR UPDATE`,
                [turnoId]
            );

            if (bloques.length === 0) {
                await connection.rollback();

                throw errorCrearConCodigo(
                    'SIN_BLOQUE_AGENDA',
                    'activarTurnoPendiente rechazado: el turno no posee ' +
                    'bloque de agenda en estado reservado/en_progreso.'
                );
            }

            const [result] = await connection.query(
                `UPDATE turnos
                 SET estado_turno = 'en_progreso'
                 WHERE turnos_id = ?
                 AND estado_turno = 'en_lista_espera'
                 AND estado_pago = 'aprobado'`,
                [turnoId]
            );

            await connection.commit();

            return result;
        } catch (error) {
            try { await connection.rollback(); } catch (_) {}

            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = TurnoModel;