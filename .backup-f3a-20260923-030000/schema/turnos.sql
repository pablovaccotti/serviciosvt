CREATE TABLE `turnos` (
  `turnos_id` int(11) NOT NULL AUTO_INCREMENT,
  `usuarios_id` int(11) NOT NULL,
  `servicios_id` int(11) NOT NULL,
  `metodo_pago` varchar(50) NOT NULL,
  `estado_pago` varchar(50) DEFAULT 'pendiente',
  `estado_turno` varchar(50) DEFAULT 'en_progreso',
  `fecha_creacion` timestamp NOT NULL DEFAULT current_timestamp(),
  `mp_payment_id` varchar(100) DEFAULT NULL,
  `mp_preference_id` varchar(100) DEFAULT NULL,
  `mp_external_reference` varchar(150) DEFAULT NULL,
  PRIMARY KEY (`turnos_id`),
  UNIQUE KEY `mp_payment_id` (`mp_payment_id`),
  UNIQUE KEY `mp_external_reference` (`mp_external_reference`),
  KEY `fk_turnos_usuarios` (`usuarios_id`),
  KEY `fk_turnos_servicios` (`servicios_id`),
  CONSTRAINT `fk_turnos_servicios` FOREIGN KEY (`servicios_id`) REFERENCES `servicios` (`servicios_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_turnos_usuarios` FOREIGN KEY (`usuarios_id`) REFERENCES `usuarios` (`usuarios_id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
