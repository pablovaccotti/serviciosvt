-- F3A - Separacion PAGO / AGENDA / TRABAJO
-- Cambia UNICAMENTE el DEFAULT de turnos.estado_turno.
-- No toca filas, no toca nulabilidad, no toca otros defaults.
-- turnos verificado vacio antes de ejecutar. Re-ejecutable.

ALTER TABLE turnos ALTER COLUMN estado_turno SET DEFAULT 'pendiente_programacion';
