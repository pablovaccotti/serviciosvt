-- F2 AGENDA serviceVT - Migracion aditiva y reversible
-- No toca tablas existentes (servicios, usuarios, turnos).
-- Timezone F2: fecha DATE + hora TIME como horario de pared local Argentina.
-- Sin conversiones UTC. No cambia timezone global de MySQL.

CREATE TABLE IF NOT EXISTS tecnicos (
    tecnico_id INT AUTO_INCREMENT PRIMARY KEY,
    usuarios_id INT NULL,
    nombre VARCHAR(100) NOT NULL,
    telefono VARCHAR(50) NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    fecha_alta TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tecnicos_usuarios FOREIGN KEY (usuarios_id)
        REFERENCES usuarios (usuarios_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cuadrillas (
    cuadrilla_id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE,
    activa TINYINT(1) NOT NULL DEFAULT 1,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cuadrilla_tecnicos (
    cuadrilla_id INT NOT NULL,
    tecnico_id INT NOT NULL,
    PRIMARY KEY (cuadrilla_id, tecnico_id),
    CONSTRAINT fk_ct_cuadrilla FOREIGN KEY (cuadrilla_id)
        REFERENCES cuadrillas (cuadrilla_id),
    CONSTRAINT fk_ct_tecnico FOREIGN KEY (tecnico_id)
        REFERENCES tecnicos (tecnico_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS agenda_bloques (
    bloque_id INT AUTO_INCREMENT PRIMARY KEY,
    cuadrilla_id INT NOT NULL,
    turnos_id INT NOT NULL,
    fecha DATE NOT NULL,
    hora_inicio TIME NOT NULL,
    hora_fin TIME NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'reservado',
    inicio_real DATETIME NULL,
    fin_real DATETIME NULL,
    duracion_real_min INT NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_bloque_cuadrilla FOREIGN KEY (cuadrilla_id)
        REFERENCES cuadrillas (cuadrilla_id),
    CONSTRAINT fk_bloque_turno FOREIGN KEY (turnos_id)
        REFERENCES turnos (turnos_id),
    CONSTRAINT ck_bloque_horas CHECK (hora_fin > hora_inicio),
    INDEX idx_bloque_cuadrilla_fecha (cuadrilla_id, fecha, hora_inicio, hora_fin),
    INDEX idx_bloque_turno (turnos_id),
    INDEX idx_bloque_estado (estado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS turno_historial (
    historial_id INT AUTO_INCREMENT PRIMARY KEY,
    turnos_id INT NOT NULL,
    usuarios_id INT NULL,
    estado_anterior VARCHAR(50) NULL,
    estado_nuevo VARCHAR(50) NOT NULL,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    observacion VARCHAR(255) NULL,
    CONSTRAINT fk_historial_turno FOREIGN KEY (turnos_id)
        REFERENCES turnos (turnos_id),
    INDEX idx_historial_turno_fecha (turnos_id, fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cuadrilla inicial unica (operacion idempotente y re-ejecutable).
INSERT IGNORE INTO cuadrillas (nombre, activa) VALUES ('ServiceVT', 1);
