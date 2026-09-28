CREATE TABLE `cuadrilla_tecnicos` (
  `cuadrilla_id` int(11) NOT NULL,
  `tecnico_id` int(11) NOT NULL,
  PRIMARY KEY (`cuadrilla_id`,`tecnico_id`),
  KEY `fk_ct_tecnico` (`tecnico_id`),
  CONSTRAINT `fk_ct_cuadrilla` FOREIGN KEY (`cuadrilla_id`) REFERENCES `cuadrillas` (`cuadrilla_id`),
  CONSTRAINT `fk_ct_tecnico` FOREIGN KEY (`tecnico_id`) REFERENCES `tecnicos` (`tecnico_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
