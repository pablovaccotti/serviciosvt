# ServiceVT — Instrucciones para el agente

## Propósito

Este archivo contiene las reglas operativas que deben seguir OpenCode, Muse Spark o cualquier agente de código que trabaje sobre este proyecto.

El proyecto es el backend de ServiceVT, un sistema de servicios técnicos que incluye:

* Landing/campañas.
* Bot de diagnóstico.
* WhatsApp.
* Presupuestos preliminares.
* Turnos.
* Agenda de visitas.
* Técnicos y cuadrillas.
* Mercado Pago.
* Panel administrativo.
* Historial operativo.

---

# REGLA PRINCIPAL: ESTADO DEL PROYECTO

Antes de modificar código:

1. Leer `README.md` si existe.
2. Leer `docs/ROADMAP.md`.
3. Leer `docs/DECISIONS.md` si existe.
4. Inspeccionar el código relacionado con la tarea.
5. No asumir que una fase anterior está implementada solamente porque aparece como pendiente en una conversación.

Al finalizar una fase:

1. Ejecutar los tests correspondientes.
2. Ejecutar los checks de sintaxis necesarios.
3. Revisar el diff.
4. Verificar que no haya archivos o cambios fuera de alcance.
5. Actualizar obligatoriamente `docs/ROADMAP.md`.
6. Registrar:

   * fase terminada;
   * fecha;
   * objetivo;
   * archivos creados/modificados;
   * migraciones ejecutadas;
   * tests realizados;
   * resultado de los tests;
   * decisiones tomadas;
   * problemas encontrados y solución;
   * riesgos o pendientes;
   * próximo paso recomendado.
7. Si se tomó una decisión arquitectónica importante, actualizar también `docs/DECISIONS.md`.

Una fase NO debe considerarse terminada hasta que `docs/ROADMAP.md` haya sido actualizado.

---

# REGLAS DE SEGURIDAD

## No hacer cambios destructivos sin autorización

No ejecutar ni introducir:

* `DROP TABLE`
* `DROP DATABASE`
* `TRUNCATE`
* eliminación masiva de datos;
* migraciones destructivas;
* modificación irreversible de tablas existentes;

sin autorización explícita.

Las migraciones nuevas deben ser preferentemente:

* aditivas;
* reversibles;
* idempotentes cuando sea posible.

Antes de una migración importante:

1. realizar backup;
2. comprobar el schema actual;
3. ejecutar la migración;
4. verificar el resultado.

---

# NO INVENTAR DATOS

No inventar:

* usuarios;
* técnicos;
* teléfonos;
* nombres;
* precios;
* turnos;
* pagos;
* diagnósticos;
* credenciales;
* IDs;
* relaciones entre usuarios y técnicos.

Si falta información real, detener esa parte y pedir el dato necesario.

---

# PAGOS

Mercado Pago y la lógica de pagos son componentes sensibles.

No modificar pagos como parte de otra fase salvo que la integración sea explícitamente parte de esa fase.

Regla de negocio:

> Pagar un servicio NO significa que el trabajo esté comenzado.

El pago y el estado operativo del turno deben mantenerse separados.

---

# AGENDA

La agenda representa capacidad real de trabajo.

Actualmente existe una única cuadrilla:

`ServiceVT`

La cuadrilla representa una única capacidad operativa.

Los dos técnicos actuales trabajan juntos sobre la misma visita. No deben modelarse como dos capacidades independientes.

No permitir dos trabajos simultáneos para la misma cuadrilla.

Los solapamientos deben controlarse dentro de transacciones y con locking apropiado.

---

# ESTADOS

Los estados existentes deben preservarse salvo autorización explícita.

Estados nuevos introducidos por F2:

* `programado`
* `cancelado`
* `reprogramado`

Estados operativos existentes:

* `en_progreso`
* `finalizado`
* `en_lista_espera`
* `pendiente_pago`

No cambiar nombres de estados solamente por preferencia estética.

---

# FINALIZACIÓN DE TRABAJO

Cuando un trabajo programado, por ejemplo:

`14:00 → 17:00`

comienza a:

`14:10`

y termina:

`15:32`

debe conservarse el horario originalmente programado y registrar:

* `inicio_real = 14:10`
* `fin_real = 15:32`
* `duracion_real_min = 82`

La capacidad queda libre desde `fin_real`.

No crear automáticamente un bloque residual.

No iniciar automáticamente el siguiente turno.

El siguiente trabajo permanece `programado` hasta que los técnicos realmente lo inicien.

---

# CONCURRENCIA

Las operaciones que puedan generar doble reserva o doble trabajo deben utilizar transacciones y locking apropiado.

Especialmente:

* programar;
* iniciar;
* finalizar;
* cancelar;
* reprogramar.

No confiar solamente en validaciones JavaScript del frontend.

La regla debe estar protegida en backend/DB.

---

# FRONTEND ADMIN

El panel administrativo debe:

* requerir autenticación;
* utilizar Bearer token;
* evitar `innerHTML` cuando pueda usarse DOM seguro;
* no confiar en datos enviados desde el navegador;
* usar `window.location.origin` cuando corresponda;
* mantener las operaciones sensibles protegidas en backend.

---

# IA / OLLAMA

El bot de IA debe considerarse un componente no confiable respecto de datos comerciales.

La IA puede:

* recopilar información;
* orientar;
* hacer preguntas;
* generar un prediagnóstico;
* ayudar a estimar.

No debe inventar precios exactos.

Las futuras estimaciones deberán distinguir:

1. precio de mercado de repuestos;
2. estimación preliminar ServiceVT;
3. precio final confirmado durante la visita.

---

# CAMBIOS DE ALCANCE

No modificar componentes fuera del alcance de una fase.

Por ejemplo, una fase de agenda no debe modificar automáticamente:

* Mercado Pago;
* WhatsApp;
* Ollama;
* autenticación;
* precios;
* frontend público;

salvo que el plan de la fase lo indique explícitamente.

Si durante una fase se descubre un problema fuera de alcance:

1. documentarlo;
2. no arreglarlo silenciosamente;
3. agregarlo a `docs/ROADMAP.md`;
4. proponer en qué fase debería resolverse.

---

# TESTS

Cada fase debe tener tests adecuados.

Como mínimo, cuando corresponda:

* happy path;
* autenticación;
* autorización;
* errores de validación;
* concurrencia;
* idempotencia;
* integridad de DB;
* compatibilidad con código legacy.

No declarar una fase como terminada únicamente porque el servidor arranca.

---

# CHECKPOINTS

Antes de una fase importante:

1. crear backup/checkpoint;
2. registrar qué archivos se respaldaron;
3. registrar schema/version de DB;
4. implementar;
5. probar;
6. revisar diff.

El checkpoint debe quedar identificado en `docs/ROADMAP.md`.

---

# DOCUMENTACIÓN OBLIGATORIA

Después de cada fase actualizar:

`docs/ROADMAP.md`

La actualización debe incluir:

```text
FASE:
ESTADO:
FECHA:
OBJETIVO:

IMPLEMENTADO:
- ...

ARCHIVOS:
- ...

BASE DE DATOS:
- ...

TESTS:
- ...

RESULTADO:
- ...

DECISIONES:
- ...

PENDIENTES:
- ...

RIESGOS:
- ...

PRÓXIMA FASE:
- ...
```

No borrar el historial anterior.

---

# PRINCIPIO DE CONSERVACIÓN

Cuando exista una implementación funcionando:

> Preferir cambios pequeños, explícitos y verificables antes que reescrituras completas.

No reemplazar modelos o controladores funcionales sin necesidad.

No refactorizar código no relacionado mientras se implementa una fase.

---

# COMPORTAMIENTO ESPERADO DEL AGENTE

El agente debe actuar como un desarrollador senior que mantiene un sistema existente.

Antes de tocar algo:

* inspeccionar;
* entender;
* respaldar cuando corresponda;
* cambiar lo mínimo necesario;
* probar;
* documentar.

Si existe incertidumbre sobre una regla de negocio importante:

> no inventarla.

Documentar la duda y pedir confirmación.

---

# DEFINICIÓN DE "FASE TERMINADA"

Una fase solamente puede marcarse como `COMPLETADA` cuando:

* la implementación está hecha;
* la base de datos está verificada;
* los tests pasan;
* no existen errores conocidos bloqueantes;
* el diff fue revisado;
* no se modificaron componentes fuera de alcance sin autorización;
* `docs/ROADMAP.md` fue actualizado;
* los pendientes descubiertos quedaron registrados.

Si alguno de estos puntos no se cumple, utilizar:

`PARCIAL`

o

`BLOQUEADA`

en lugar de `COMPLETADA`.
