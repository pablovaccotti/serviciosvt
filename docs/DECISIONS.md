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

---

## F6-A (2026-09-23) — Auditoría E2E (sin decisiones nuevas, solo hallazgos)

17. **Fuente unica viva de precio (constatado, no cambiado).** Precio mostrado (landing), cobrado (Preference MP) y validado (webhook) provienen de `servicios.precio` sin snapshot en `turnos`; cualquier snapshot futuro requiere decision comercial. **Pendiente de decision (F6-B):** `index.html` hardcodea `API_URL` a `localhost:3000` y debe alinearse con el origen de despliegue como ya hace `admin.html`.

---

## F6-C (2026-09-23) — Chat corto con derivación a WhatsApp (COMPLETADA)

18. **Bot que cierra en vez de interrogar.** Tope híbrido: el modelo señala suficiencia con línea `CIERRE: <resumen>` y el backend fuerza el cierre a los 4 mensajes del cliente (resumen fallback equipo+falla). Al cerrar, el backend devuelve `listo/resumen/whatsappUrl` (URL con `WHATSAPP_NUMBER` de `.env`, nunca hardcodeada ni 500 si falta); el frontend muestra un único botón de derivación. Sin tabla `chat`, sin tocar pagos/agenda/auth/DB. Criterio híbrido aprobado por el usuario; formato de cierre, tope 4 y tests unitarios aplicados por defecto, a confirmar.

---

## F7-A (2026-09-29) — Motor determinístico piloto Heladera → No enfría

19. **Motor puro y conservable, sin LLM ni embeddings ni MySQL.** `utils/motorDiagnostico.js` decide la siguiente pregunta o el resultado preliminar con reglas auditables (+1/-1 por evidencia, niveles alta/media/baja como conteo de indicios, nunca probabilidad). El JSON del manual nunca contiene precios/garantías (validado por `validarManual` y por test).
20. **Un manual = un caso piloto.** `knowledge/diagnostico_heladera_no_enfria.json` (5 datos observables, 5 causas con `servicios_ids` reales). Futuros equipos se agregan como nuevos JSON en este formato, no como árboles de botones ni motores paralelos (enfoque `arbolDiagnosticoController` descartado explícitamente por redundante).

---

## F7-B-cierre (2026-09-30) — Compatibilidad de cierre sin re-arquitectura

21. **Contrato de cierre dual y aditivo.** El backend responde `mostrarFormulario/resumenParaFormulario` (F7B) y además `listo/whatsappUrl` (compat F6-C, `listo` = espejo de `mostrarFormulario`). `whatsappUrl` sale de `WHATSAPP_NUMBER`, es `null` si falta y nunca genera 500 en el chat. El frontend acepta ambas señales y guarda `resumenParaFormulario` en `window.__resumenDiagnostico` para precarga futura; el flujo de solicitud (`POST /api/pagos/solicitar`) no se tocó.
22. **Suite F6-C retirada como legacy, no resucitada.** `tests/f6c-chat.js` → `_legacy/f6c-chat.js`: testeaba el mecanismo `CIERRE:`/`MAX_PREGUNTAS=4`/`tope 12` ya reemplazado por el motor + topes 3/5; restaurarlo habría exigido re-agregar comportamiento eliminado. La cobertura vigente es F7-A (11), F7-B (11) y `tests/f7b-cierre-compat.js` (5, puro).
23. **Endurecimiento mínimo del piloto.** `esCasoPiloto(equipo, falla?)` mantiene compatibilidad con 1 arg y, si se pasa falla, exige coincidencia normalizada con el problema del manual. `extraerDatosDiagnostico` filtra por las claves del esquema del manual (las cues siguen siendo las del piloto, sin inventar datos).

---

## F7B-UI-cierre (2026-09-30) — UI de cierre con autenticación existente

24. **El cierre F7B utiliza la autenticación existente por teléfono/JWT. No se implementa usuario invitado sin sesión en esta fase.** El panel lee `window.__resumenDiagnostico`, muestra problema/precio ("A cotizar" si null)/garantía/causas (nivel tal cual)/alternativas, y contrata con `contratarServicio(metodoPago, servicioId)` → `POST /api/pagos/solicitar` con JWT (sin `usuariosId` desde frontend). Sin invitado, sin nuevas columnas, sin migraciones, sin rutas nuevas.

---

## Fix cierre genérico (2026-09-30) — conteo pre-truncamiento

25. **Los topes de cierre cuentan intercambios sobre el historial crudo, no sobre el truncado.** `contarIntercambiosCliente` filtra inválidos pero ya no depende del slice de `normalizarHistorial`; `handleChat` y `handleChatPiloto` le pasan `req.body.historial`. Sin cambios de contrato, topes ni prompts.
26. **Límite duro: `INTERCAMBIOS_MAXIMO` prevalece sobre Ollama.** Con 5 intercambios reales, aunque la respuesta termine en `?`, no hay sexta pregunta: se reemplaza por el cierre determinístico con `resumenParaFormulario` (`mostrarFormulario`/`listo` true). En zona objetivo (3–4) se mantiene el comportamiento actual (`?` no fuerza cierre). Topes 3/5 intactos.

---

## KB Etapa 1 (2026-09-30) — Schema v1.1 estructural + manual Lavarropas

27. **Schema v1.1 aditivo e inerte.** `validarManual` acepta opcionales `variantes[]`, `aplica_variantes[]` (referencial), `sinonimos[]`, `peso` (entero ≥1, ausente = 1) y `soluciones[]` (sin precio/garantía, que siguen prohibidos). Scoring, preguntas, niveles y `resultadoPreliminar` intactos: el peso se valida pero no pondera (toda evidencia ±1). `nivel_base` se conserva como legado. Manual piloto `Lavarropas → No centrifuga` (7 datos, 6 causas, `servicios_ids:[]` sin inventar); resto del catálogo pendiente de validación técnica.

---

## F7B-FORM (2026-09-30) — Multiple choice genérico del motor

28. **El formulario es otra boca de datos, no otro motor.** Rama pregunta devuelve `preguntaDiagnostico{clave,pregunta,objetivo,tipo,opciones}` aditivo (booleano→Sí/No por código; tipos sin renderer → null + texto libre). `respuestaEstructurada{clave,valor}` opcional, validada contra el manual (booleano estricto, sin claves inyectadas), con precedencia sobre el texto y sin duplicarse como mensaje ni conteo paralelo. Registro de manuales por `{equipo,problema}` (Heladera+Lavarropas) sin `if` por equipo; `esCasoPiloto` conservado.

## F7B-CARRY (2026-09-30) — Persistencia acumulativa sin tocar el motor

29. **El diagnóstico es acumulativo y el backend valida todo.** Cada turno fusiona `previos revalidados + texto + respuesta actual` (precedencia actual > previos > texto) vía `validarDatosDiagnostico` + `incorporarRespuestaEstructurada`, y recién después `normalizarDatos/evaluarCausas/siguientePregunta` con contratos intactos. El estado viaja en `datosDiagnostico` por request (sin globales, multiusuario); el eco de respuesta es solo `{clave:boolean}` validado. Clicks nunca se convierten en texto; Ollama sigue siendo solo redacción; el manual sigue siendo la fuente.
