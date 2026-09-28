# ServiceVT — Roadmap y Estado del Proyecto

Última actualización: 2026-09-23

Este documento es la fuente de verdad operativa para conocer en qué estado se encuentra el desarrollo de ServiceVT.

Debe actualizarse obligatoriamente al finalizar cada fase.

---

# ESTADO ACTUAL

**Fase actual:** F3B — Registrar técnicos y completar cuadrilla ServiceVT

**Estado:** COMPLETADA

**Último checkpoint:** `.backup-f3b-20260923-031500/`

**Base de datos:** MariaDB 10.4.32

**Datos reales existentes preservados:** Sí

**Tests F3B:** 4/4 PASS

**Tests F2 (regresión):** 19/19 PASS

**Tests F3A (regresión):** 8/8 PASS

---

# VISIÓN DEL SISTEMA

El flujo previsto de ServiceVT es:

```text
CAMPAÑA
   ↓
LANDING
   ↓
BOT / WHATSAPP
   ↓
DATOS DEL EQUIPO
   ↓
PRE-DIAGNÓSTICO
   ↓
ESTIMACIÓN
   ↓
CLIENTE ACEPTA
   ↓
PAGO / MÉTODO DE PAGO
   ↓
TURNO
   ↓
AGENDA
   ↓
VISITA
   ↓
DIAGNÓSTICO REAL
   ↓
TRABAJO
   ↓
FINALIZACIÓN
   ↓
HISTORIAL
```

La arquitectura debe permitir posteriormente:

* múltiples cuadrillas;
* múltiples técnicos;
* rutas/viajes;
* estimaciones basadas en historial;
* diagnósticos más completos;
* fotografías;
* integración profunda con WhatsApp;
* Mercado Pago;
* panel administrativo móvil.

---

# FASES

## F0 — Seguridad y saneamiento inicial

**Estado:** COMPLETADA

Objetivos principales:

* proteger operaciones administrativas;
* corregir problemas de frontend administrativo;
* validar entradas;
* ordenar configuración;
* eliminar riesgos evidentes.

Resultados:

* endpoints administrativos protegidos;
* validación de servicios;
* endurecimiento de `admin.html`;
* corrección de configuración;
* backup inicial;
* protección del código legacy de inicialización.

---

# F1 — Endurecimiento e integración base

**Estado:** COMPLETADA

Se consolidaron:

* autenticación administrativa existente;
* validación de operaciones;
* frontend admin seguro;
* configuración;
* estructura base para las siguientes fases.

Se verificó que una petición no autenticada a modificación de precios recibiera:

```text
Token de autenticación requerido.
```

---

# F2 — Agenda, cuadrilla y liberación de capacidad

**Estado:** COMPLETADA

**Fecha:** 2026-09-23

## Objetivo

Crear la infraestructura inicial de agenda sin romper pagos, autenticación, WhatsApp, IA ni código existente.

---

## Base de datos

Se ejecutó:

```text
migrations/001_f2_agenda.sql
```

Migración aditiva.

No se ejecutaron:

* `ALTER` destructivos;
* `DROP`;
* `TRUNCATE`;
* eliminación de filas existentes.

Se crearon 5 tablas:

```text
tecnicos
cuadrillas
cuadrilla_tecnicos
agenda_bloques
turno_historial
```

También se creó la cuadrilla:

```text
ServiceVT
cuadrilla_id = 1
activa = 1
```

Actualmente:

```text
tecnicos = 0
cuadrilla_tecnicos = 0
```

Esto es intencional: todavía no se inventaron ni cargaron los técnicos reales.

---

# Modelo actual de capacidad

Actualmente ServiceVT tiene una única capacidad operativa:

```text
CUADRILLA ServiceVT
       │
       ├── Técnico 1
       └── Técnico 2
```

Los dos técnicos trabajan juntos sobre una visita.

Por lo tanto:

> La cuadrilla representa una única capacidad de trabajo.

No deben programarse dos visitas simultáneas para la misma cuadrilla.

La arquitectura queda preparada para agregar más cuadrillas posteriormente.

---

# Agenda

`agenda_bloques` contiene:

* horario programado;
* cuadrilla;
* turno;
* estado;
* inicio real;
* fin real;
* duración real.

Estados de bloque:

```text
reservado
en_progreso
liberado
cancelado
```

Los horarios programados no se modifican al finalizar un trabajo.

---

# Regla de finalización

Ejemplo:

```text
Programado:
14:00 → 17:00

Inicio real:
14:10

Fin real:
15:32
```

Se conserva:

```text
14:00 → 17:00
```

y se registra:

```text
inicio_real = 14:10
fin_real = 15:32
duracion_real_min = 82
```

La capacidad queda libre desde:

```text
15:32
```

No se genera automáticamente un bloque residual.

---

# Regla de siguiente turno

Finalizar un trabajo:

**NO inicia automáticamente el siguiente.**

El siguiente turno permanece:

```text
programado
```

hasta que los técnicos realmente comiencen el trabajo.

Esta decisión es deliberada y debe conservarse.

---

# Estados de TURNOS

Se preservaron los estados existentes.

Estados agregados por F2:

```text
programado
cancelado
reprogramado
```

Estados existentes:

```text
en_progreso
finalizado
en_lista_espera
pendiente_pago
```

No se modificó `estado_pago`.

---

# Concurrencia

Las operaciones críticas utilizan transacciones y locking.

Se verificó:

* reserva simultánea;
* prevención de doble reserva;
* doble inicio;
* doble finalización;
* existencia de otro trabajo `en_progreso`.

Resultado de concurrencia:

```text
1 × 201
1 × 409
```

Es decir, una reserva fue aceptada y la concurrente rechazada.

---

# Endpoints F2

Se agregó:

```text
/api/turnos
```

Con operaciones para:

```text
programar
iniciar
finalizar
cancelar
reprogramar
actual
proximos
```

Las operaciones administrativas requieren autenticación.

Se verificó:

```text
401 → sin token
403 → usuario cliente
200 → lectura autorizada
```

---

# Archivos F2

## Modificados

```text
app.js
admin.html
```

## Creados

```text
migrations/001_f2_agenda.sql
models/cuadrillaModel.js
models/tecnicoModel.js
models/agendaModel.js
models/turnoHistorialModel.js
controllers/turnosController.js
routes/turnosRoutes.js
tests/f2-agenda.js
```

## Backup

```text
.backup-f2-20260923-020900/
```

Incluye:

```text
app.js.bak
admin.html.bak
schema/*.sql
version.txt
```

---

# Tests F2

Resultado:

```text
19/19 PASS
```

Casos verificados:

* programación válida;
* solapamientos;
* cuatro variantes de solapamiento;
* horarios contiguos;
* inicio;
* doble inicio;
* doble trabajo `EN_PROGRESO`;
* finalización;
* cálculo de duración;
* liberación de capacidad;
* no auto-inicio;
* reutilización de rango liberado;
* doble finalización idempotente;
* historial;
* conservación de `estado_pago`;
* cancelación;
* reprogramación;
* concurrencia;
* compatibilidad legacy;
* autenticación/autorización.

Cleanup:

```text
0 restos
```

---

# Integraciones deliberadamente NO modificadas en F2

No se modificaron:

```text
Mercado Pago
Webhook
WhatsApp
Ollama / IA
index.html
precios
autenticación
turnoModel.js
serviceModel.js
dependencias
.env
usuarios existentes
```

El endpoint legacy:

```text
/api/pagos/finalizar-trabajo
```

permanece temporalmente.

Su eventual eliminación/deprecación queda pendiente.

---

# ESTADO DE DATOS AL CIERRE DE F2

```text
usuarios = 9
servicios = 5
turnos = 0
bloques = 0
historial = 0
tecnicos = 0
cuadrillas = 1
```

Datos reales existentes:

```text
PRESERVADOS
```

---

# PENDIENTES

## P1 — Registrar técnicos reales

Necesitamos los datos reales de:

```text
Técnico 1
Técnico 2
```

Para cada uno:

```text
usuarios_id
nombre
```

Después:

```text
tecnicos
      ↓
cuadrilla_tecnicos
      ↓
ServiceVT
```

No crear registros ficticios.

---

## P2 — Integración TURNOS + AGENDA

Definir e implementar el flujo definitivo:

```text
turno
  ↓
programado
  ↓
agenda_bloque
  ↓
iniciar
  ↓
en_progreso
  ↓
finalizar
  ↓
finalizado
```

Debe evitarse que los caminos legacy creen accidentalmente nuevos trabajos directamente como `en_progreso`.

---

## P3 — Separación definitiva entre pago y trabajo

Regla:

```text
PAGO APROBADO
        ≠
TRABAJO EN PROGRESO
```

Un pago aprobado habilita el proceso correspondiente, pero no significa que los técnicos ya hayan comenzado.

---

## P4 — Mercado Pago + nuevo flujo de agenda

Una vez estabilizado TURNOS + AGENDA:

* adaptar creación de turnos;
* mantener `estado_pago` separado;
* mantener idempotencia;
* evitar doble reserva;
* asociar correctamente pago ↔ turno;
* revisar preferencias y estados.

---

## P5 — Deprecar endpoint legacy

Posteriormente:

```text
/api/pagos/finalizar-trabajo
```

deberá dejar de utilizarse cuando todos los flujos estén migrados al nuevo:

```text
/api/turnos/finalizar
```

No eliminarlo hasta comprobar que ningún flujo activo depende de él.

---

## P6 — Diagnóstico y estimaciones

Desarrollar:

* datos del equipo;
* marca;
* modelo;
* síntomas;
* antigüedad;
* cuándo comenzó la falla;
* preguntas dinámicas;
* fotografías;
* prediagnóstico;
* piezas posibles;
* precio de mercado;
* mano de obra;
* estimación ServiceVT;
* precio final confirmado.

La IA no debe inventar precios exactos.

---

## P7 — Historial para estimaciones

Registrar posteriormente:

* falla declarada;
* diagnóstico real;
* repuesto utilizado;
* precio real;
* duración real;
* mano de obra;
* resultado.

Esto permitirá mejorar las estimaciones futuras con datos históricos de ServiceVT.

---

## P8 — Viajes y rutas

Fuera de F2.

Posteriormente incorporar:

* tiempo de viaje;
* origen;
* destino;
* duración estimada;
* zonas;
* rutas;
* restricciones de agenda.

No implementar todavía.

---

## P9 — Multi-cuadrilla

Fuera de F2.

La estructura actual ya permite evolucionar desde:

```text
1 cuadrilla
```  

hacia:

```text
ServiceVT Norte
ServiceVT Sur
ServiceVT Centro
...
```

sin asumir que cada técnico individual representa una capacidad independiente.

---

## P10 — Autenticación administrativa más fuerte

La autenticación administrativa existente necesita una revisión posterior para eliminar completamente cualquier dependencia de conocer solamente un teléfono como mecanismo de identidad.

Fuera de alcance de F2.

---

# RIESGOS CONOCIDOS

## Turnos legacy

El sistema posee lógica anterior de turnos que todavía debe integrarse con la nueva agenda.

## Endpoint legacy

Existe una ruta antigua de finalización que todavía contiene comportamiento histórico.

## Técnicos

Todavía no existen registros de técnicos reales.

## Timezone

La agenda utiliza:

```text
DATE + TIME
```

como horario operativo argentino.

No se modificó el timezone global de MariaDB.

El código utiliza:

```text
America/Argentina/Buenos_Aires
```

para operaciones de "hoy".

---

# DECISIONES DE NEGOCIO IMPORTANTES

### Una visita = una capacidad

Los dos técnicos actuales trabajan juntos.

### Pago ≠ trabajo iniciado

El pago no debe arrancar automáticamente el trabajo.

### Finalización libera capacidad

La capacidad se considera disponible desde `fin_real`.

### No auto-iniciar siguiente

Finalizar un turno no inicia el siguiente.

### No generar bloque residual automáticamente

La capacidad liberada queda disponible para que una futura programación pueda utilizarla.

### Horario programado e histórico real son diferentes

No sobrescribir el horario previsto con el horario real.

### Una fase no debe modificar componentes fuera de alcance

Especialmente pagos, IA, WhatsApp y autenticación.

---

# CHECKPOINTS

## F0/F1

Existe backup:

```text
.backup-fase0-fase1-20260922-223132/
```

## F2

Existe backup:

```text
.backup-f2-20260923-020900/
```

---

# PRÓXIMA FASE RECOMENDADA

## F3 — TURNOS + AGENDA + TÉCNICOS

Orden recomendado:

```text
1. Cargar técnicos reales.
2. Asociarlos a ServiceVT.
3. Definir creación de turno programado.
4. Integrar turno → agenda_bloque.
5. Evitar creación legacy accidental en_progreso.
6. Mantener pago separado.
7. Ajustar panel administrativo.
8. Ejecutar pruebas de concurrencia.
9. Verificar compatibilidad.
10. Actualizar este ROADMAP.
```

No comenzar todavía con:

* rutas;
* viajes;
* multi-cuadrilla;
* grandes cambios de IA.

Primero estabilizar el núcleo:

```text
USUARIO
   ↓
TURNO
   ↓
AGENDA
   ↓
CUADRILLA
   ↓
TRABAJO
   ↓
FINALIZACIÓN
   ↓
HISTORIAL
```

---

# PROTOCOLO PARA TODAS LAS PRÓXIMAS FASES

Cada agente que termine una fase debe actualizar este archivo.

Formato mínimo obligatorio:

```text
## FASE X — Nombre

Estado:
Fecha:

Objetivo:

Implementado:
- ...

Archivos:
- ...

DB:
- ...

Tests:
- ...

Resultado:
- ...

Decisiones:
- ...

Problemas encontrados:
- ...

Pendientes:
- ...

Riesgos:
- ...

Próxima fase:
- ...
```

Nunca eliminar el historial de fases anteriores.

El `ROADMAP.md` debe representar el estado real del repositorio, no solamente el plan deseado.

---

# AUDITORÍA F3 (READ-ONLY) — 2026-09-23

Auditoría previa a F3, sin modificar código. Estado verificado: 9 usuarios (1 admin + 8 clientes), 0 técnicos, 1 cuadrilla `ServiceVT` activa, 0 turnos, 0 bloques, 0 historial.

## Hallazgo nuevo: finalización legacy sobre turno gestionado por agenda

Si un turno llevado por agenda (`en_progreso` + bloque `en_progreso`) se finaliza por el endpoint legacy `POST /api/pagos/finalizar-trabajo`, el turno pasa a `finalizado` pero su bloque queda en `en_progreso` para siempre: la capacidad nunca se libera y un posterior `POST /api/turnos/finalizar` responde `yaFinalizado:true` con datos nulos. El camino inverso es seguro (legacy exige `en_progreso` en `turnos`, por lo que un turno `programado` es rechazado con 404).

Acción requerida en F3: impedir o conciliar el uso del endpoint legacy sobre turnos con bloque activo (ver P2/P5).

---

# F3A — Separación pago/agenda/trabajo

**Estado:** COMPLETADA

**Fecha:** 2026-09-23

## Objetivo

Que ningún pago ni creación de turno inicie automáticamente un trabajo: `PAGO APROBADO != TRABAJO EN_PROGRESO`.

## Implementado

- Nuevo estado `pendiente_programacion` (convive con todos los existentes, sin renombres ni migraciones de datos).
- Migración `migrations/002_f3a_pendiente_programacion.sql`: solo cambia el DEFAULT de `turnos.estado_turno` a `pendiente_programacion` (nulabilidad intacta, 0 filas afectadas).
- Efectivo crea `efectivo_en_destino` + `pendiente_programacion`; ya no decide capacidad ni usa `en_lista_espera`/`en_progreso`.
- `aprobarPagoMercadoPago` deja `aprobado` + `pendiente_programacion` (si venía de `pendiente_pago`); eliminada la promoción a `en_progreso`/`en_lista_espera`. Firma webhook, consulta de payment, validaciones de monto/moneda, `mp_payment_id` e idempotencia intactas.
- Legacy `POST /api/pagos/finalizar-trabajo` rechaza con 409 los turnos con bloque de agenda activo (`reservado`/`en_progreso`); compatible para turnos antiguos sin agenda.
- `programar` acepta `pendiente_programacion` (más los programables F2 por compatibilidad).
- `admin.html`: card legacy reescrita sin sugerir auto-inicio; agenda usa `/api/turnos/finalizar`.
- Decisión documentada: no se creó `POST /api/turnos/crear` (duplicaría `/api/pagos/solicitar`); se evaluará en F3B.

## Archivos

Modificados: `models/turnoModel.js`, `models/agendaModel.js`, `controllers/paymentController.js`, `admin.html`, `docs/ROADMAP.md`.
Creados: `migrations/002_f3a_pendiente_programacion.sql`, `tests/f3-turnos-pagos.js`, `docs/DECISIONS.md`.
Backup: `.backup-f3a-20260923-030000/` (modelos, controlador, admin, schema de `turnos`/`agenda_bloques`).

## Base de datos

`turnos.estado_turno` DEFAULT `pendiente_programacion`. Sin ALTER destructivo, sin filas tocadas.

## Tests

`tests/f3-turnos-pagos.js`: 8/8 PASS (efectivo, MP pendiente/aprobado, ciclo agenda, legacy 409/compatible, pago intacto, auth). Regresión `tests/f2-agenda.js`: 19/19 PASS. Cleanup: 0 restos.

## Resultado

Flujo MP y efectivo verificados hasta `pendiente_programacion` sin iniciar trabajo; agenda F2 intacta.

## Decisiones

Ver `docs/DECISIONS.md` (pago != trabajo, `pendiente_programacion`, solo `/api/turnos/iniciar` inicia, sin auto-inicio, una sola capacidad, legacy bloqueado sobre agenda).

## Pendientes (F3B)

Asociar Técnico 1 y 2 a `ServiceVT` (faltan `usuarios_id` + nombres reales); evaluar `POST /api/turnos/crear`; deprecación legacy; funciones legacy-only documentadas en código (`verificarTrabajoActivo`, `obtenerSiguienteEnFila`, `activarTurnoPendiente`).

## Riesgos

Turnos legacy en `en_progreso`/`en_lista_espera` siguen existiendo como estados válidos para datos antiguos; ningún flujo nuevo los genera.

## Próxima fase

F3B — técnicos reales + estabilización del núcleo turno→agenda.

---

# F3B — Registrar tecnicos y completar cuadrilla ServiceVT

**Estado:** COMPLETADA

**Fecha:** 2026-09-23

## Objetivo

Registrar Tecnico 1 (PabloVT) y Tecnico 2 (Marian) y asociarlos a `ServiceVT` (`cuadrilla_id` 1).

## Implementado

- Verificado `usuarios_id=2` (PabloVT, telefono 1161137178, rol admin intacto).
- Re-verificado que no existia usuario con telefono 1112211223; con aprobacion explicita se creo con rol `cliente` via `UserModel.findOrCreateByPhone` (sin tocar usuarios existentes).
- Creados via modelos existentes (idempotente, sin duplicados):
- `tecnicos.tecnico_id=1` (PabloVT, `usuarios_id=2`, activo=1).
- `tecnicos.tecnico_id=2` (Marian, activo=1).
- `cuadrilla_tecnicos (1,1)` y `(1,2)` hacia ServiceVT.
- Cero codigo de negocio modificado: solo datos + `tests/f3b-tecnicos.js` + docs.

## Archivos

Modificados: ninguno de codigo (solo `docs/ROADMAP.md`, `docs/DECISIONS.md`).
Creados: `tests/f3b-tecnicos.js`.
Backup: `.backup-f3b-20260923-031500/` (modelos, schema, conteos pre).

## Base de datos

`tecnicos=2`, `cuadrilla_tecnicos=2`, `usuarios=10` (un alta con rol cliente, sin cambios de rol). Sin migraciones.

## Tests

`tests/f3b-tecnicos.js`: 4/4 PASS (PabloVT+rol, Marian en ServiceVT, asociaciones/FK/duplicados, ciclo agenda con pago intacto).
Regresion F2: 19/19 PASS. Regresion F3A: 8/8 PASS. Cleanup: 0 huerfanos.

## Resultado

COMPLETADA: cuadrilla ServiceVT con sus dos tecnicos asociados.

## Decisiones

- Marian creado como usuario con rol cliente (aprobacion explicita) via codigo existente, sin tocar `authController.js`/`userModel.js`.
- Idempotencia en registro y asociacion para evitar duplicados.

## Pendientes

Estabilizacion del nucleo turno-agenda; evaluar `POST /api/turnos/crear`; deprecacion legacy.

## Riesgos

Ninguno nuevo: capacidad sigue siendo unica por diseno aunque haya dos tecnicos.

## Proxima fase

F4 u operativa segun prioridad del negocio.

---

# F4-A — AUDITORIA READ-ONLY turno → agenda (2026-09-23)

**Estado:** AUDITADA (solo informe, sin codigo modificado, sin migraciones, sin datos tocados).

**Hallazgos nuevos que deben quedar registrados:**

1. `TurnoModel.crear()` (models/turnoModel.js:19) acepta `estadoTurno` arbitrario, incluido `en_progreso` sin bloque. Ningun caller de produccion lo usa hoy con `en_progreso`, pero es el bypass potencial principal para F4-B (restringir o eliminar callers).
2. `TURNOS_PROGRAMABLES` (models/agendaModel.js:12) acepta legacy `pendiente_pago` y `en_lista_espera` ademas de `pendiente_programacion`: programar legacy sigue siendo posible por compatibilidad F2.
3. Auto-promocion legacy intacta y alcanzable: `POST /api/pagos/finalizar-trabajo` → `obtenerSiguienteEnFila()` + `activarTurnoPendiente()` (`en_lista_espera` → `en_progreso` sin bloque) para turnos sin agenda. Protegido con 409 solo si hay bloque `reservado`/`en_progreso`.
4. `index.html` solo crea turnos via `POST /api/pagos/solicitar`; sin escrituras directas de `estado_turno`. `chatController`, `agente_planta.js` y `analizador.js` no escriben `turnos`/`agenda_bloques` (solo `servicios` en el caso del agente).
5. DB verificada read-only: `usuarios=10, tecnicos=2, cuadrillas=1, cuadrilla_tecnicos=2, servicios=5, turnos=0, agenda_bloques=0, turno_historial=0`; DEFAULT `turnos.estado_turno='pendiente_programacion'`.

**Veredicto:** F4-A PASS CON HALLAZGOS — requiere decision antes de F4-B (alcance del bloqueo legacy y de `TurnoModel.crear`).

**Proxima fase propuesta:** F4-B (correcciones minimas segun informe F4-A, sin tocar auth/webhook-firma/.env/config-db/IA/index.html/_legacy).

---

# F4-B — Endurecer flujo turno → agenda

**Estado:** COMPLETADA

**Fecha:** 2026-09-23

## Objetivo

Cerrar los bypass que permitian llegar a `en_progreso` sin bloque valido en
`agenda_bloques`. Flujo nuevo protegido:

```text
pendiente_programacion
        ↓
    programado
        ↓
   en_progreso
        ↓
    finalizado
```

## Implementado

- `models/turnoModel.js`: `crear()` con whitelist
  `['pendiente_programacion','pendiente_pago']` (firma intacta); cualquier otro
  `estadoTurno` (`en_progreso`, `en_lista_espera`, etc.) se rechaza con error
  controlado `ESTADO_TURNO_NO_PERMITIDO`. `pendiente_pago` se conserva
  temporalmente por compatibilidad (fixtures F2 antiguos); el flujo nuevo usa
  `pendiente_programacion`. `activarTurnoPendiente()` endurecida con transaccion
  + `FOR UPDATE`: exige bloque en `reservado`/`en_progreso`, si no existe lanza
  `SIN_BLOQUE_AGENDA` sin modificar el turno. `verificarTrabajoActivo`,
  `obtenerSiguienteEnFila` marcadas legacy deprecadas (solo lectura).
- `models/agendaModel.js`: `TURNOS_PROGRAMABLES = ['pendiente_programacion']`.
  Se eliminaron los legacy `pendiente_pago` y `en_lista_espera` tras comprobar
  callers: MP convierte `pendiente_pago`→`pendiente_programacion` al aprobar, y
  `en_lista_espera` no lo genera ningun flujo nuevo. `iniciar()` sigue siendo el
  unico responsable `programado/reservado`→`en_progreso`; `finalizar()` el unico
  `en_progreso`→`finalizado` con `liberado`. `estado_pago` intacto.
- `controllers/paymentController.js` (`POST /api/pagos/finalizar-trabajo`):
  mantiene 409 si el turno tiene bloque activo; nuevo 409 controlado (sin
  modificar turno) si el turno sin bloque no esta `en_progreso` sino en
  `pendiente_programacion`/`pendiente_pago`/`en_lista_espera`/`programado`/
  `reprogramado` (debe usar `/api/turnos/programar`+`/iniciar`); el caso legacy
  `en_progreso` sin agenda sigue finalizando 200 por compatibilidad, pero la
  auto-promocion (`obtenerSiguienteEnFila`+`activarTurnoPendiente`) queda
  DESHABILITADA: siempre responde `siguienteTurno:null` con
  `autoPromocion:'deshabilitada_f4b_usar_agenda'`. No se creo
  `POST /api/turnos/crear` (sigue `/api/pagos/solicitar`).
- Fixtures de regresion migrados al estado oficial (sin cambiar produccion):
  `tests/f2-agenda.js` (helper a `pendiente_programacion`; legacy `en_progreso`
  via INSERT directo), `tests/f3-turnos-pagos.js` (idem + agenda via
  `pendiente_programacion`), `tests/f3b-tecnicos.js` (ciclo via
  `pendiente_programacion`).
- Sin tocar: `middlewares/*`, `authController`, `chatController`, `index.html`,
  `.env`, `config/db.js`, `package.json`, dependencias, webhook/firma MP,
  IA/Ollama/Qwen, `_legacy/`, `serviceController`, `serviceModel`. Sin migracion
  (DDL intacto, solo codigo). Sin `init-backend.js`.

## Archivos

Modificados: `models/turnoModel.js`, `models/agendaModel.js`,
`controllers/paymentController.js`, `tests/f2-agenda.js`,
`tests/f3-turnos-pagos.js`, `tests/f3b-tecnicos.js`, `docs/ROADMAP.md`,
`docs/DECISIONS.md`.
Creados: `tests/f4b-turno-agenda.js`.
Backup: `.backup-f4b-20260923-084014/` (modelos, controlador, turnosRoutes,
admin, ROADMAP, DECISIONS + snapshot read-only de `turnos`, `agenda_bloques`,
`turno_historial` + `conteos_pre.json`).

## Base de datos

Sin migraciones, sin ALTER, sin filas tocadas. Snapshot pre/post verificado.
Conteos finales: `usuarios=10, tecnicos=2, cuadrillas=1, cuadrilla_tecnicos=2,
servicios=5, turnos=0, agenda_bloques=0, turno_historial=0`.

## Tests

`tests/f4b-turno-agenda.js`: 16/16 PASS (t1 crear rechaza `en_progreso`/
`en_lista_espera`; t2 crear `pendiente_programacion` ok; t3 programar
`pendiente_pago`/`en_lista_espera` → `TURNO_NO_PROGRAMABLE`; t4 programa; t5
inicia; t6 finaliza; t7 `activarTurnoPendiente` sin bloque → `SIN_BLOQUE_AGENDA`
intacto; t8 legacy `en_lista_espera`→409 intacto y legacy `en_progreso` 200 sin
promover siguiente; t9 ciclo completo; t10 bloque `liberado`; t11 pago intacto;
t12 idempotencia; t13 F2 19/19; t14 F3A 8/8; t15 F3B 4/4; t16 cleanup cero
restos + reales intactos).
Regresion `tests/f2-agenda.js`: 19/19 PASS standalone.
Regresion `tests/f3-turnos-pagos.js`: 8/8 PASS standalone (secuencial; en
paralelo con F2 colisiona por mismo slot, esperado por diseno de capacidad
unica).
Regresion `tests/f3b-tecnicos.js`: 4/4 PASS standalone.
Checks: `node --check` OK en `turnoModel`, `agendaModel`, `paymentController`,
`turnosRoutes`, `app`, `f4b`, `f2`, `f3`.
Callers: `TurnoModel.crear` productivo solo `paymentController` con
`pendiente_programacion`; `activarTurnoPendiente`/`obtenerSiguienteEnFila` sin
callers productivos (solo tests de rechazo); UPDATEs a `en_progreso`
autorizados restantes: `AgendaModel.iniciar` y `activarTurnoPendiente`
(endurecida con bloque). Cleanup: 0 restos (`F4BTEST%`), 0 huerfanos.

## Resultado

COMPLETADA: nucleo turno→agenda protegido contra `en_progreso` sin agenda.
Invariantes A–E verificadas por tests.

## Decisiones

Ver `docs/DECISIONS.md` (F4-B 11–15).

## Problemas encontrados

- `tests/f3b-tecnicos.js` usaba `crearPendientePago` + `programar`: tras F4-B
  devuelve `TURNO_NO_PROGRAMABLE`. Solucion: fixture migrado a
  `pendiente_programacion` (dato de prueba, sin tocar produccion ni tecnicos).
- Correr F2 y F3A en paralelo da `CONFLICTO_AGENDA` en uno: esperado (una sola
  capacidad, mismos slots futuros). Solucion: ejecucion secuencial (asi lo hace
  la suite F4-B via subprocesos).

## Pendientes

- Evaluar `POST /api/turnos/crear` en fase posterior si hace falta.
- Deprecacion/eliminacion final de `verificarTrabajoActivo`,
  `obtenerSiguienteEnFila`, `activarTurnoPendiente` y
  `POST /api/pagos/finalizar-trabajo` cuando ningun flujo dependa de ellos.
- Migracion manual de turnos antiguos en `en_lista_espera`/`pendiente_pago` si
  deban entrar al flujo nuevo (hoy no programables).

## Riesgos

- Turnos legacy `en_progreso` sin agenda anteriores a F4-B siguen finalizables
  por via legacy (compatibilidad intencional); ningun flujo nuevo los genera.
- INSERTs SQL directos fuera del modelo podrian crear `en_progreso` sin
  bloque; la proteccion esta en modelo + endpoints, no en CHECK de DB (sin
  migracion por alcance F4-B).

## Proxima fase

No implementar F4-C ni mejoras adicionales por ahora (alcance cerrado en F4-B).

