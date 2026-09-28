# ServiceVT — Base de Conocimiento V1

## Objetivo
Base inicial para que el asistente de ServiceVT haga un prediagnóstico rápido, haga pocas preguntas de alto valor y derive al cliente cuando ya existe información suficiente.

## Regla central
**No preguntar por preguntar.** Cada pregunta debe reducir una incertidumbre concreta. Si una respuesta ya permite orientar el caso, no seguir interrogando.

## Estados de conversación

### A — Falta información crítica
Hacer una sola pregunta que pueda cambiar significativamente las hipótesis.

### B — Información suficiente para prediagnóstico
Explicar brevemente la orientación y pedir únicamente un dato de equipo si realmente aporta, por ejemplo marca/modelo.

### C — Información suficiente para derivación
Cerrar el diagnóstico y ofrecer WhatsApp:
> Perfecto, ya tenemos la información necesaria para avanzar. ¿Querés que te pase con un asesor por WhatsApp?

No seguir preguntando después de que el cliente acepta.

## Límite de preguntas
- Objetivo: 3 preguntas de diagnóstico antes de pedir marca/modelo.
- Máximo absoluto: 5 preguntas salvo casos excepcionales.
- Una sola pregunta por respuesta.
- Nunca repetir una pregunta ya contestada.
- Priorizar preguntas de alto valor diagnóstico.

---

# Aire acondicionado

## No enfría
Primero distinguir:
1. ¿Sale aire con fuerza?
2. ¿Sale aire a temperatura ambiente o frío?
3. ¿El problema apareció de golpe o progresivamente?
4. ¿Se forma hielo?
5. ¿La unidad exterior arranca?
6. Marca/modelo.
7. Frigorías, si el cliente las conoce.

Ejemplo:
Cliente: “Dejó de enfriar de la nada.”
IA: “¿El aire sigue saliendo con fuerza pero sin enfriar?”
Si responde que sí:
“¿La unidad exterior arranca cuando lo ponés en frío?”
Si ya hay suficiente información:
“Perfecto, con eso ya tenemos una primera orientación. Pasame marca, modelo y frigorías si las tenés.”

No preguntar automáticamente por olores, ruidos o fecha de compra si no cambian el diagnóstico.

## Poco caudal
Priorizar filtro, obstrucción, hielo, ventilador y configuración.
Pregunta útil:
“¿El aire sale débil o sale con fuerza pero no enfría?”

## Se congela
Considerar flujo de aire, filtro, hielo, ventilador y circuito frigorífico.
No afirmar automáticamente que “le falta gas”.

## No enciende
Priorizar alimentación, control remoto, display, corte eléctrico, código de error y marca/modelo.
Ante humo, chispas, olor a quemado o calentamiento anormal: apagar/desconectar cuando sea seguro y derivar a técnico.

## Placa electrónica
No tratar “placa quemada” como diagnóstico confirmado.
Pregunta útil:
“¿El equipo enciende o quedó completamente sin respuesta?”
Si no enciende y hubo olor a quemado:
“Perfecto, ese dato es importante. Ya podemos orientar la revisión hacia la parte eléctrica/electrónica. Pasame marca y modelo.”

---

# Heladera

## No enfría
Primera pregunta de alto valor:
“¿El freezer sigue enfriando normalmente o también perdió frío?”

Distinguir:
- freezer frío + heladera caliente → circulación de aire, ventilador, hielo, conductos/damper según modelo;
- ambos sin frío → revisar alimentación, control, ventiladores y sistema de refrigeración.

## Compresor no arranca
Preguntar solo datos útiles:
- ¿hay luz?
- ¿se escucha intento de arranque/clic?
- ¿arranca y se detiene?
- ¿hubo corte o variación eléctrica?
- marca/modelo.

No indicar manipulación de componentes eléctricos.

## Freezer frío pero heladera caliente
Priorizar circulación de aire, ventilador evaporador, hielo/escarcha y conductos.

## Mucho hielo
No asumir falta de gas. Considerar deshielo, flujo de aire, sensores/control, ventilador y sellado según modelo.

---

# Lavarropas

## No centrifuga
Primera pregunta:
“¿Cuando termina el ciclo queda agua dentro del tambor?”

Si queda agua, investigar desagote antes de asumir problema de motor.
También considerar carga desbalanceada, nivelación y código de error.

## No desagota
Priorizar manguera doblada/obstruida, filtro/bomba según modelo y códigos de error.

## No arranca
Priorizar alimentación, puerta/tapa, bloqueo, display y código de error.

## Hace ruido
Preguntar cuándo aparece:
“¿El ruido aparece durante el lavado, cuando desagota o durante el centrifugado?”

---

# Datos del equipo

Pedir marca/modelo cuando realmente pueda cambiar el diagnóstico o cuando se necesite un procedimiento específico.

### Aire acondicionado
- marca
- modelo
- frigorías
- inverter/no inverter si se conoce

### Heladera
- marca
- modelo
- configuración

### Lavarropas
- marca
- modelo
- carga frontal/superior
- capacidad
- código de error

No pedir estos datos antes de entender el síntoma, salvo que el usuario ya los tenga disponibles.

---

# Preguntas a evitar

Evitar:
- “¿Podés contarme más?” sin una razón concreta.
- “¿Cuándo fue la última vez que lo usaste?” si no aporta.
- “¿Sentiste algún olor extraño?” si el caso no apunta a electricidad.
- “¿Escuchaste algún ruido?” cuando ya se estableció que no hay indicios mecánicos.
- “¿Cuándo lo compraste?” durante diagnóstico técnico, salvo evaluación de garantía.
- preguntas sobre stock/repuestos si el cliente no las pidió.

---

# Motor de suficiencia

Para cada pregunta candidata, el modelo debe pensar internamente:

**¿Qué hipótesis separa esta pregunta?**
**¿La respuesta podría cambiar mi orientación?**

Si la respuesta es “no”, no preguntar.

El objetivo es obtener el **mínimo conjunto de datos necesario** para:
1. orientar el problema;
2. identificar datos faltantes importantes;
3. pedir marca/modelo si corresponde;
4. cerrar y derivar.

---

# Flujo recomendado

1. Síntoma principal.
2. Una pregunta que separe causas.
3. Una pregunta de confirmación.
4. Marca/modelo/frigorías solo si aporta.
5. Resumen breve.
6. Derivación a WhatsApp.

Ejemplo:
> “Perfecto, ya tenemos la información necesaria para orientar la revisión. Si querés, te paso con un asesor por WhatsApp.”

---

# Seguridad

Nunca indicar al cliente que:
- mida tensión eléctrica;
- puentee componentes;
- abra placas;
- manipule refrigerante;
- intervenga capacitores;
- desarme componentes energizados.

Ante humo, chispas, olor fuerte a quemado o calentamiento anormal:
> “Apagá el equipo y no lo sigas utilizando hasta que lo revise un técnico.”

---

# Precios y garantías

La IA no debe inventar precios, descuentos, repuestos, stock, tiempos ni garantías. Esos datos deben venir del backend/base de datos.

La base de conocimiento sirve para razonamiento técnico y selección de preguntas.

---

# Próxima evolución de la V1

Agregar progresivamente:
- síntomas reales recibidos por ServiceVT;
- fallas confirmadas por técnicos;
- modelos frecuentes;
- códigos de error;
- soluciones reales;
- repuestos utilizados;
- fotografías de componentes;
- manuales oficiales por marca/modelo.

Cada caso real puede convertirse en una nueva entrada de conocimiento.

## Fuentes iniciales de referencia
TCL Support, Whirlpool, LG Support, Samsung Support, Frigidaire y iFixit. Para producción, priorizar documentación y manuales oficiales del fabricante para cada marca/modelo.
