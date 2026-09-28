# ServiceVT — Decisiones arquitectónicas

Registra decisiones de negocio y arquitectura tomadas durante el desarrollo.
No borrar el historial anterior.

---

## F3A (2026-09-23) — Separación pago/agenda/trabajo

1. **Pago aprobado != trabajo iniciado.** Ningún pago (Mercado Pago o efectivo) ni ninguna creación de turno inicia automáticamente un trabajo (`en_progreso`).
2. **`pendiente_programacion` representa turno listo para ser agendado.** Es el estado inicial de todo turno nuevo (vía DEFAULT de `turnos.estado_turno` y vía código explícito) y el destino de un pago MP aprobado desde `pendiente_pago`.
3. **Solo `/api/turnos/iniciar` inicia trabajo normal.** Única transición válida `programado`/`reprogramado` → `en_progreso`, con bloque `reservado` → `en_progreso` e `inicio_real`.
4. **Finalizar no auto-inicia el siguiente.** Ni `/api/turnos/finalizar` ni ningún flujo nuevo promueven turnos; el siguiente permanece `programado` hasta inicio manual.
5. **Dos técnicos actuales forman una sola capacidad/cuadrilla.** `ServiceVT` (cuadrilla_id 1) es la única capacidad operativa; no modelarlos como capacidades independientes.
6. **Endpoint legacy no opera sobre turnos de agenda.** `POST /api/pagos/finalizar-trabajo` rechaza con 409 cualquier turno con bloque `reservado`/`en_progreso`; se mantiene solo para turnos antiguos sin agenda hasta su deprecación.
7. **Horarios como pared local Argentina.** `agenda_bloques` usa `DATE` + `TIME` sin conversiones UTC; "hoy" se calcula con zona `America/Argentina/Buenos_Aires`; sin cambios de timezone global.
8. **Sin endpoint extra de creación en F3A.** `POST /api/turnos/crear` no se creó para no duplicar `/api/pagos/solicitar`; se reevaluará en F3B.

---

## F3B (2026-09-23) — Técnicos (COMPLETADA)

9. **PabloVT asociado sin tocar su identidad.** `tecnicos.tecnico_id=1` → `usuarios_id=2`, rol `admin` conservado, asociado a `ServiceVT`; no se creó usuario ni se cambió ningún rol.
10. **Marian creado con rol cliente tras aprobación explícita.** Re-verificada su inexistencia; alta vía `UserModel.findOrCreateByPhone` (código existente, sin modificar auth ni userModel) y `tecnicos.tecnico_id=2` asociado a `ServiceVT`. Registro y asociación idempotentes. F3B queda COMPLETADA.

---

## F4-B (2026-09-23) — Endurecimiento turno → agenda (COMPLETADA)

11. **`pendiente_programacion` es el único estado inicial/programable del flujo nuevo.** `TurnoModel.crear()` solo acepta `pendiente_programacion` (más `pendiente_pago` temporal por compatibilidad de fixtures antiguos); `en_progreso`/`en_lista_espera` se rechazan con `ESTADO_TURNO_NO_PERMITIDO`. `TURNOS_PROGRAMABLES = ['pendiente_programacion']`: `pendiente_pago`/`en_lista_espera` legacy ya no entran a agenda (MP convierte a `pendiente_programacion` al aprobar).
12. **Ningún `en_progreso` sin bloque.** `activarTurnoPendiente()` exige bloque `reservado`/`en_progreso` en transacción (`SIN_BLOQUE_AGENDA` si falta); solo `AgendaModel.iniciar()` crea `en_progreso` en el flujo nuevo.
13. **Legacy aislado, no eliminado.** `verificarTrabajoActivo`, `obtenerSiguienteEnFila`, `activarTurnoPendiente` y `POST /api/pagos/finalizar-trabajo` se conservan por callers legacy pero deprecados: el endpoint ya no auto-promueve (`siguienteTurno:null`); turnos sin bloque fuera de `en_progreso` reciben 409 hacia `/api/turnos/programar`+`/iniciar`; el `en_progreso` legacy sin agenda sigue finalizable (200) por compatibilidad.
14. **`estado_pago` intacto y pagos sin cambios.** Efectivo sigue `efectivo_en_destino` + `pendiente_programacion`; MP aprobado sigue `aprobado` + `pendiente_programacion`; sin auto-inicio, sin bloque automático, sin `POST /api/turnos/crear`.
15. **Compatibilidad de datos antiguos sin reescritura.** Turnos pre-F4-B en estados legacy permanecen legibles/finalizables por vía legacy; fixtures de regresión que los necesiten usan INSERT directo (no el modelo endurecido).

---

## F5 (2026-09-23) — Panel de pendientes de programación (COMPLETADA)

16. **Pendientes visibles sin tocar el motor.** `GET /api/turnos/pendientes` (solo admin) lista `pendiente_programacion` sin bloque activo (`NOT EXISTS reservado/en_progreso`, bloques `liberado`/`cancelado` no excluyen), orden antigüedad; `admin.html` solo carga el ID en el formulario existente (programar/iniciar siguen manuales). Sin snapshot de precio, sin migraciones, sin `POST /api/turnos/crear`, sin cambios en pagos/auth/IA/legacy. Hora-pasada-de-hoy diferida a F5.1.
