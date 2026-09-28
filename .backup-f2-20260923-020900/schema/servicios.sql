CREATE TABLE `servicios` (
  `servicios_id` int(11) NOT NULL AUTO_INCREMENT,
  `equipo` varchar(100) NOT NULL,
  `falla` varchar(255) NOT NULL,
  `precio` int(11) NOT NULL,
  `garantia` varchar(50) NOT NULL,
  PRIMARY KEY (`servicios_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
