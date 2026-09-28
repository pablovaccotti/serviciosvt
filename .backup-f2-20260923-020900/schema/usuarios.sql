CREATE TABLE `usuarios` (
  `usuarios_id` int(11) NOT NULL AUTO_INCREMENT,
  `telefono` varchar(50) NOT NULL,
  `fecha_registro` timestamp NOT NULL DEFAULT current_timestamp(),
  `rol` varchar(20) NOT NULL DEFAULT 'cliente',
  PRIMARY KEY (`usuarios_id`),
  UNIQUE KEY `telefono` (`telefono`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
