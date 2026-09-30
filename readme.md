ServiceVT --- Arquitectura del Asistente Técnico y Búsqueda Semántica

Estado del proyecto

Este documento resume el estado alcanzado hasta septiembre de 2026 y
define el camino técnico previsto para continuar el desarrollo del
asistente conversacional de ServiceVT.

El objetivo es mantener una referencia única para poder retomar el
proyecto sin perder decisiones, problemas detectados ni próximos pasos.

1. Objetivo del asistente

ServiceVT incorpora un asistente técnico conversacional para realizar un
prediagnóstico de problemas de electrodomésticos.

El asistente no debe:

realizar reparaciones;

afirmar diagnósticos definitivos;

inventar precios;

inventar repuestos;

inventar stock;

inventar garantías;

pedir información innecesaria;

realizar una entrevista interminable.

Su objetivo es obtener el mínimo conjunto de datos necesario para
orientar técnicamente el caso y, cuando la información sea suficiente,
derivar al cliente a un asesor por WhatsApp.

La regla central es:

No preguntar por preguntar.

Cada pregunta debe reducir una incertidumbre concreta.

2. Arquitectura actual

El backend utiliza:

Node.js

Express

MySQL / MariaDB

Ollama

modelos locales de lenguaje

una base de conocimiento Markdown

arquitectura MVC

La comunicación principal actualmente sigue este flujo:

Frontend
   |
   | POST /api/chat
   v
Controller
   |
   +--> MySQL
   |      |
   |      +--> servicio
   |      +--> precio
   |      +--> garantía
   |
   +--> Base de conocimiento
   |
   +--> Construcción del prompt
   |
   v
Ollama
   |
   v
Modelo local
   |
   v
Respuesta

3. Modelo utilizado

El modelo principal utilizado para el asistente ha sido:

qwen2.5:7b

También se creó un modelo personalizado:

servicevt-bot:latest

y posteriormente se trabajó con:

servicevt-chat:latest

El equipo utilizado para ejecutar Ollama actualmente funciona con:

CPU
sin GPU dedicada

Esto es importante porque la inferencia de un modelo de aproximadamente
7B parámetros puede ser lenta.

4. Problema de rendimiento detectado

Durante las pruebas se observaron tiempos muy variables.

Ejemplos registrados:

6.6 segundos
7.8 segundos
9.8 segundos
17.7 segundos
22.3 segundos
25.6 segundos
55.1 segundos
66 segundos
74 segundos
90 segundos -> timeout

También se observó:

servicevt-bot:latest
100% CPU

La primera llamada suele ser mucho más lenta que las siguientes debido a
la carga del modelo en memoria.

Por ejemplo:

Primera llamada:
~54 segundos

Segunda llamada:
~8 segundos

Esto confirmó que existe un componente importante de cold start /
carga del modelo.

Se agregó:

keep_alive: "10m"

a la petición de Ollama para intentar mantener el modelo cargado.

5. Timeout del backend

El backend utiliza AbortController para cancelar solicitudes demasiado
largas.

La estructura actual es aproximadamente:

const controller = new AbortController();

const timeout = setTimeout(
    () => {
        controller.abort();
    },
    OLLAMA_TIMEOUT_MS
);

Luego se envía:

fetch(
    OLLAMA_URL,
    {
        method: 'POST',
        ...
        signal: controller.signal
    }
)

Cuando Ollama tarda demasiado aparece:

This operation was aborted

y el backend responde:

504 Gateway Timeout

Por ejemplo:

[OLLAMA] Timeout después de 90003 ms
[CHAT] Error: This operation was aborted

El 504 es generado por nuestro propio backend como consecuencia del
timeout de Ollama.

6. Problema de calidad conversacional

El problema más importante actualmente no es solamente la velocidad.

El asistente también mostró problemas para interpretar correctamente las
respuestas del cliente.

Ejemplo:

Asistente:
¿El aire sigue saliendo con fuerza pero no enfría de golpe?

Cliente:
no enfria

Asistente:
¿El aire sale débil o sale con fuerza pero no enfría?

La segunda pregunta vuelve a plantear una distinción relacionada con
información que el cliente ya había intentado comunicar.

Otro ejemplo:

Cliente:
si no sale bien, no tiene potencia

Asistente:
¿El aire sale débil o sale con fuerza pero no enfría?

Esto demuestra que el modelo puede tener dificultades para:

interpretar respuestas cortas;

mantener hechos confirmados;

distinguir hipótesis de hechos;

evitar repetir preguntas;

utilizar correctamente el historial.

7. Regla de datos confirmados

Se incorporó una regla explícita para evitar que el modelo convierta
preguntas en respuestas.

Ejemplo:

Asistente:
¿La unidad exterior arranca cuando lo ponés en frío?

Cliente:
Te dije que sale aire común.

Debe interpretarse:

Sale aire común = CONFIRMADO

Unidad exterior = DESCONOCIDO

Nunca:

Unidad exterior = NO ARRANCA

porque el cliente nunca lo confirmó.

Esta regla es fundamental para el razonamiento conversacional.

8. Regla de suficiencia

El asistente debe preguntarse internamente:

¿Qué hipótesis separa esta pregunta?

¿La respuesta puede cambiar mi orientación?

Si la respuesta es NO:

NO PREGUNTAR.

El objetivo no es obtener todos los datos posibles.

El objetivo es obtener:

mínimo conjunto de datos
+
orientación técnica suficiente
+
derivación

9. Límite de preguntas

La base de conocimiento establece:

Objetivo:
3 preguntas de diagnóstico

Máximo:
5 preguntas de diagnóstico

Después:

resumen breve
+
marca/modelo si realmente aporta
+
derivación a WhatsApp

10. Base de conocimiento

Se creó:

knowledge/serviceVT_base_conocimiento_v1.md

La base tiene aproximadamente:

7031 caracteres

Contiene reglas y conocimiento técnico para:

aire acondicionado;

heladeras;

lavarropas;

seguridad;

selección de preguntas;

suficiencia;

datos de equipo;

errores que deben evitarse.

La base incluye ejemplos de diagnóstico.

Por ejemplo, para aire acondicionado:

No enfría
    |
    +--> ¿Sale aire con fuerza?
    |
    +--> ¿Sale aire a temperatura ambiente o frío?
    |
    +--> ¿Apareció de golpe o progresivamente?
    |
    +--> ¿Se forma hielo?
    |
    +--> ¿La unidad exterior arranca?
    |
    +--> Marca/modelo
    |
    +--> Frigorías

11. Problema descubierto con la base de conocimiento

Inicialmente se utilizó una búsqueda basada en palabras clave /
secciones del Markdown.

El problema es que una base de conocimiento relativamente pequeña puede
terminar enviando demasiado contenido al modelo.

Actualmente se estaba obteniendo:

Contexto técnico seleccionado:
1551 caracteres

pero el prompt completo llegó a:

9979 caracteres

y en otras pruebas:

11479 caracteres

Esto significa que la base de conocimiento no es necesariamente el único
problema.

El problema real es:

System
+
Prompt de reglas
+
Datos del servicio
+
Knowledge
+
Historial
+
Mensaje actual

todo junto dentro del contexto del modelo.

12. Duplicación de instrucciones

Se detectó otro problema importante.

El Modelfile de servicevt-bot contiene un SYSTEM extenso.

Por ejemplo:

Sos el Ingeniero de Software Principal y Administrador Autónomo
de la plataforma serviceVT...

Ese SYSTEM fue pensado originalmente para tareas de desarrollo del
software.

Sin embargo, el asistente de atención al cliente recibe además un prompt
enorme con reglas conversacionales.

Esto genera dos capas de instrucciones:

SYSTEM del Modelfile
        +
prompt dinámico del controller

Para un modelo de 7B esto puede perjudicar la consistencia.

La dirección propuesta es separar responsabilidades:

SYSTEM
    =
reglas permanentes del asistente

Prompt runtime
    =
solamente datos actuales

13. Próxima arquitectura de prompt

La arquitectura recomendada es:

SYSTEM
│
├── identidad del asistente
├── idioma
├── límites
├── reglas de conversación
├── reglas de seguridad
├── regla de datos confirmados
├── regla de suficiencia
└── regla contra repeticiones

PROMPT DINÁMICO
│
├── equipo
├── falla
├── servicio
├── precio/garantía si corresponde
├── conocimiento relevante
├── historial
└── mensaje actual

No duplicar las mismas reglas en ambos lugares.

14. Embeddings

Se incorporó una mejora importante:

nomic-embed-text:latest

Está instalado mediante Ollama.

Comando utilizado:

ollama pull nomic-embed-text

Tamaño aproximado:

274 MB

El objetivo es utilizar este modelo exclusivamente para búsqueda
semántica.

No reemplaza al modelo conversacional.

Arquitectura:

nomic-embed-text
        |
        +--> transforma texto en vector
        |
        v
búsqueda semántica
        |
        v
fragmentos relevantes
        |
        v
qwen2.5:7b
        |
        v
respuesta al cliente

15. ¿Por qué embeddings?

La búsqueda tradicional intenta detectar palabras.

Ejemplo:

"no enfría"

puede encontrar:

No enfría

pero puede tener dificultades con:

dejó de tirar frío

o:

sale aire común

o:

enfría muy poco

Los embeddings permiten comparar el significado aproximado de los
textos.

Por ejemplo:

Consulta:
"sale sin fuerza y no enfría"

puede encontrar:

1. Poco caudal
2. No enfría

aunque las palabras no coincidan exactamente.

16. Primera implementación de embeddings

Se creó el archivo:

utils/embeddings.js

Su responsabilidad será:

cargar el Markdown;

dividirlo en bloques;

generar embeddings;

guardar el índice en memoria;

recibir una consulta;

generar el embedding de la consulta;

calcular similitud coseno;

devolver los fragmentos más relevantes.

La estructura prevista es:

server-servicevt/
│
├── knowledge/
│   └── serviceVT_base_conocimiento_v1.md
│
├── utils/
│   └── embeddings.js
│
├── controllers/
├── models/
├── routes/
├── config/
└── server.js

17. Ruta real de la base

La ruta correcta es:

knowledge/serviceVT_base_conocimiento_v1.md

Desde:

utils/embeddings.js

se accede mediante:

const KNOWLEDGE_PATH = path.join(
    __dirname,
    '..',
    'knowledge',
    'serviceVT_base_conocimiento_v1.md'
);

18. Primera prueba de embeddings

Antes de modificar handleChat, se decidió probar el sistema de
embeddings de manera aislada.

Esto es importante.

No conviene modificar simultáneamente:

búsqueda;

prompt;

modelo;

timeout;

controller.

Primero hay que comprobar que la búsqueda semántica funciona.

La prueba debe ejecutarse desde:

C:\Users\pablovt\Desktop\servicios\server-servicevt

con:

node utils/embeddings.js

La consulta de prueba es:

Equipo:
Aire acondicionado

Falla:
No enfría

Mensaje:
no enfría y no tiene potencia

Se esperan resultados relacionados con:

No enfría
Poco caudal

y no con temas irrelevantes.

19. Qué debemos validar en esa prueba

No debemos mirar únicamente el número de similitud.

Primero hay que comprobar:

Correcto

#1 Aire acondicionado → Poco caudal
#2 Aire acondicionado → No enfría

o:

#1 Aire acondicionado → No enfría
#2 Aire acondicionado → Poco caudal

Incorrecto

#1 Heladera → Mucho hielo
#2 Lavarropas → No centrifuga

Si devuelve información incorrecta, no conectamos todavía los embeddings
al chat.

20. Próximo paso después de validar embeddings

Una vez validada la búsqueda:

obtenerConocimientoRelevante(...)

será reemplazada progresivamente por:

buscarConocimientoSemantico(...)

El flujo quedará:

cliente
   |
   v
equipo + falla + mensaje
   |
   v
nomic-embed-text
   |
   v
similitud semántica
   |
   v
1-2 fragmentos relevantes
   |
   v
prompt pequeño
   |
   v
qwen2.5:7b
   |
   v
respuesta

21. Objetivo de reducción del prompt

Actualmente se registraron prompts cercanos a:

9979 caracteres

El objetivo es reducirlos significativamente.

No necesariamente hay que eliminar información.

Hay que eliminar información:

irrelevante
duplicada
repetida
no aplicable

La búsqueda semántica debe permitir que el modelo vea solamente la
información técnica que corresponde al caso actual.

22. Rendimiento esperado

Hay dos costos diferentes:

Embedding

nomic-embed-text es pequeño y está dedicado a búsqueda.

Debe ser mucho más liviano que utilizar el modelo conversacional para
hacer la selección.

Generación

qwen2.5:7b seguirá siendo el componente más pesado.

Los embeddings no van a convertir mágicamente un modelo 7B en uno
rápido.

Su beneficio principal será:

menos contexto
+
menos información irrelevante
+
mejor recuperación de conocimiento
+
prompt más pequeño
+
mayor consistencia

23. Cold start

Se comprobó que el modelo puede tardar mucho más cuando debe cargarse.

Ejemplo observado:

Primera llamada:
~54 segundos

Segunda llamada:
~8 segundos

Se utiliza:

keep_alive: "10m"

La intención es mantener el modelo cargado durante períodos de uso.

También se debe considerar posteriormente:

ollama ps

para comprobar si el modelo está cargado y cuánto tiempo permanecerá en
memoria.

24. No tenemos GPU

Actualmente Ollama trabaja:

100% CPU

Por lo tanto, no debemos diseñar el sistema suponiendo aceleración por
GPU.

Si después de optimizar:

prompt;

knowledge;

embeddings;

system;

keep_alive;

la generación sigue siendo demasiado lenta, una futura alternativa puede
ser probar un modelo conversacional más pequeño.

Por ejemplo:

llama3.2:3b

o un modelo Qwen más pequeño.

Pero esto no debe hacerse todavía.

Primero hay que corregir la arquitectura de contexto.

25. Modelo conversacional vs modelo de embeddings

Son responsabilidades distintas.

qwen2.5:7b
    =
razonamiento + conversación + generación

nomic-embed-text
    =
representación semántica + búsqueda

No debemos pedirle al embedding model que responda al cliente.

26. Problema pendiente: modelo personalizado

El servicevt-bot contiene actualmente instrucciones orientadas a:

Ingeniero de Software Principal
Administrador de ServiceVT
MVC
Node.js
MySQL

Eso no corresponde directamente al rol de:

asistente técnico de atención al cliente

Por eso se debe revisar el Modelfile.

El objetivo futuro debería ser tener un modelo/personalidad dedicada al
asistente técnico, por ejemplo:

ServiceVT Chat

y separar completamente:

Agente de desarrollo

de:

Agente de atención al cliente

27. Arquitectura futura recomendada

La arquitectura objetivo es:

                         ┌─────────────────────┐
                         │      Frontend       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   /api/chat         │
                         │   Controller        │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┼────────────────┐
                    │               │                │
                    ▼               ▼                ▼
                 MySQL          Embeddings       Historial
                    │               │                │
                    │               ▼                │
                    │        nomic-embed-text       │
                    │               │                │
                    │               ▼                │
                    │        Knowledge relevante     │
                    │               │                │
                    └───────────────┼────────────────┘
                                    │
                                    ▼
                             Prompt dinámico
                                    │
                                    ▼
                              qwen2.5:7b
                                    │
                                    ▼
                               Respuesta
                                    │
                                    ▼
                              Frontend

28. Orden de implementación

Para evitar romper el sistema, seguir este orden.

Fase 1 --- Validar embeddings

Ejecutar:

node utils/embeddings.js

Confirmar que encuentra:

No enfría
Poco caudal

para:

no enfría y no tiene potencia

Fase 2 --- Medir

Registrar:

cantidad de bloques
tiempo de indexación
tiempo de búsqueda
cantidad de caracteres recuperados

No conectar todavía al chat si la búsqueda no es correcta.

Fase 3 --- Integrar búsqueda

Modificar el controller para utilizar:

buscarConocimientoSemantico(...)

en lugar de:

obtenerConocimientoRelevante(...)

manteniendo el resto del sistema igual.

Fase 4 --- Reducir prompt

Separar:

SYSTEM permanente

de:

datos dinámicos

Eliminar reglas duplicadas del prompt runtime.

Fase 5 --- Mejorar historial

Asegurar que el modelo reciba claramente:

ASISTENTE:
...

CLIENTE:
...

ASISTENTE:
...

CLIENTE:
...

y que pueda distinguir:

pregunta

de:

respuesta

Fase 6 --- Probar conversaciones reales

Casos mínimos:

Aire acondicionado

no enfría

sale sin fuerza

sale aire común

se congela

Heladera

no enfría

el freezer enfría pero la heladera no

Lavarropas

no centrifuga

queda agua

Fase 7 --- Medir rendimiento

Registrar:

tiempo embedding
tiempo Ollama
tiempo total
caracteres del prompt
tokens de salida

Comparar contra los valores actuales.

29. Qué NO hacer todavía

No hacer simultáneamente:

Cambiar modelo
+
cambiar prompt
+
cambiar embeddings
+
cambiar timeout
+
cambiar frontend

porque después no sabremos qué cambio solucionó o empeoró el problema.

La estrategia correcta es:

una modificación
        ↓
prueba
        ↓
medición
        ↓
decisión

30. Criterio de éxito

El asistente estará mejor encaminado cuando pueda manejar algo como:

Cliente:
sale sin fuerza y no enfría

Asistente:
Entiendo. Si además de no enfriar el aire sale con poco caudal,
¿notás hielo o escarcha en la unidad?

Cliente:
sí, tiene hielo

Asistente:
Perfecto, ese dato es importante. Ya tenemos una primera
orientación para la revisión. Pasame marca y modelo si los tenés.

Y evitar:

Cliente:
no enfría

Asistente:
¿Sale con fuerza?

Cliente:
no

Asistente:
¿Sale débil?

Cliente:
sí

Asistente:
¿Sale con fuerza o débil?

La segunda conducta es precisamente la que debemos eliminar.

31. Regla general de diseño

El asistente no debe intentar demostrar que sabe mucho.

Debe demostrar que:

escucha
+
interpreta
+
recuerda
+
pregunta poco
+
pregunta bien
+
no inventa
+
sabe cuándo detenerse

Ese es el objetivo principal del sistema.

32. Checklist actual

Infraestructura

Node.js

Express

MySQL/MariaDB

Ollama

qwen2.5:7b

nomic-embed-text

ejecución CPU

Knowledge

knowledge/serviceVT_base_conocimiento_v1.md

reglas de suficiencia

reglas de seguridad

casos de aire acondicionado

casos de heladera

casos de lavarropas

Embeddings

modelo instalado

archivo utils/embeddings.js preparado

probar indexación

validar resultados semánticos

integrar al controller

medir reducción de contexto

Chat

endpoint /api/chat

historial

contexto MySQL

generación con Ollama

timeout

keep_alive

separar SYSTEM/runtime

mejorar interpretación del historial

eliminar preguntas repetidas

medir rendimiento después de embeddings

33. Próximo comando

El siguiente paso concreto es:

cd C:\Users\pablovt\Desktop\servicios\server-servicevt

node utils/embeddings.js

No modificar todavía el controller.

Primero hay que verificar que nomic-embed-text sea capaz de recuperar
correctamente los fragmentos relevantes de:

serviceVT_base_conocimiento_v1.md

Una vez validado eso, se puede pasar a la integración con
handleChat().

Conclusión

El problema actual tiene dos dimensiones distintas:

Rendimiento

El modelo 7B ejecutándose sobre CPU recibe prompts grandes y puede
tardar decenas de segundos.

Calidad

El modelo recibe demasiadas instrucciones y contexto, y además el SYSTEM
original de servicevt-bot no fue diseñado específicamente para
atención conversacional.

La solución no es simplemente bajar temperature o num_predict.

La dirección correcta es:

Knowledge
     ↓
embeddings
     ↓
recuperación semántica
     ↓
contexto pequeño y relevante
     ↓
SYSTEM especializado
     ↓
historial claramente estructurado
     ↓
modelo conversacional

Primero validamos la búsqueda semántica. Después optimizamos el prompt.
Finalmente medimos nuevamente el rendimiento y la calidad
conversacional.

---

## 34. KB Etapa 1 — Schema v1.1 de conocimiento (2026-09-30)

Dirección aprobada: el conocimiento técnico vive en manuales JSON por
`{equipo, problema}` y el motor determinístico (`utils/motorDiagnostico.js`)
los evalúa sin código por caso (sin `if (equipo === ...)`).

Schema v1.1 (aditivo, compatible con v1.0):

* `variantes[]` (`{id, etiqueta}`) + `aplica_variantes[]` por causa
  (vacío/ausente = todas; validado referencialmente).
* `sinonimos[]` por dato observable (el extractor los compilará en etapa 2).
* `peso` opcional por evidencia (entero >= 1, ausente = 1; validado pero
  inerte para el scoring en esta etapa: toda evidencia vale ±1).
* `soluciones[]` por causa (`accion/detalle/requiere_visita/servicios_ids`;
  sin precios ni garantías: siguen prohibidos en el JSON y viven en MySQL).
* `nivel_base` se conserva como campo legado (el scoring no lo utiliza).

Manual piloto: `knowledge/diagnostico_lavarropas_no_centrifuga.json`
(Lavarropas → No centrifuga: 7 datos, 6 causas, `servicios_ids: []` sin
inventar). Procedencia del conocimiento en `tests/kb-schema-v11.js`
(header): confirmado vs `PROPUESTA PARA VALIDAR`.

Tests: `tests/kb-schema-v11.js` 10/10 (A–J); regresiones F7-A 11/11,
F7-B 11/11, cierre-compat 5/5, límite-duro 2/2.

Etapa 2 (separada, no implementada): sinónimos en extractor, fix de mensaje
mixto (pendiente + explícitos), registro multi-manual, soluciones en cierre.