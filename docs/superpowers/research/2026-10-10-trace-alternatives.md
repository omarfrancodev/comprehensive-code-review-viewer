# Alternativas para el explorador de trazabilidad

Fecha: 2026-10-10, America/Mexico_City. Estado: propuestas para revisión del usuario.
Base del producto: v0.1.0. Rama de diseño: `docs/interfaz-premium`.

## Intención y decisiones recibidas

El usuario aprobó la distribución general del espacio de revisión compacto y
pidió explorar formas distintas de presentar la trazabilidad con más animación,
incluyendo un enfoque de interacción con IA o de línea temporal. Solicitó
conservar el diseño actual y preparar dos propuestas adicionales.

Se conservó [A, explorador actual](../mockups/2026-10-10-interface-premium.html).
Se crearon [B, actividad de agentes](../mockups/2026-10-10-trace-proposal-b.html)
y [C, timeline por capítulos](../mockups/2026-10-10-trace-proposal-c.html).
El [comparador interactivo](../mockups/2026-10-10-trace-comparison.html) permite
cambiar entre las tres y funciona también como HTML local independiente.

Las propuestas comparten biblioteca, cabecera, pestañas, paleta e inspector;
usan los mismos siete hitos sintéticos. Los archivos y relaciones mostrados
son ficticios. La variación corresponde al explorador, no a una nueva aplicación.

## Comparación

| Enfoque | Presentación principal | Movimiento | Ventaja esperada | Coste o límite |
| --- | --- | --- | --- | --- |
| A: explorador actual | Carriles por actor, puntos temporales y lista compacta | Cursor sincronizado, pulso del hito, transición del inspector | Inspección precisa y comparación de muchos hitos | Más denso; necesita interpretar carriles y bases temporales |
| B: actividad de agentes | Registro de acciones, participantes y accesos a herramientas/evidencia | Pulso del actor, entrada breve de tarjeta y seguimiento del recorrido | Quién registró cada acción queda cerca de su resultado y evidencia | Tarjetas más altas; requiere búsqueda, límites de render y paginación con grandes trazas |
| C: timeline por capítulos | Una escena principal por hito, capítulos y línea navegable | Cursor de lectura, pulso de marcador, cambio de escena y halo breve | Recorrido y explicación visual centrados en un hito | Menos información simultánea; los capítulos necesitan una regla explícita de presentación |

Las ventajas son hipótesis de diseño, no resultados de una prueba de usuarios.
No se propone implementar tres motores por defecto. La selección del usuario
determinará qué enfoque entra en la spec y qué elementos conviene combinar.

## B: actividad de agentes

La vista toma la composición de una sesión de actividad: participantes en la
parte superior, acciones en tarjetas y evidencia junto a cada acción. Cada
tarjeta conserva ID, actor, hora y estado original. El panel lateral conserva
registrador, base temporal, relaciones y JSON original.

La reproducción resalta el actor asociado al hito seleccionado, muestra una
transición breve de la tarjeta y desplaza el registro dentro de su propio panel.
El control «Seguir recorrido» permite detener ese desplazamiento. Buscar filtra
las tarjetas sin cambiar el ID seleccionado ni alterar la secuencia de replay.
Elegir un participante selecciona su primer hito en el ejemplo.

El estilo visual recuerda una interfaz de agentes, pero presenta acciones
registradas: no añade prompts, respuestas, razonamientos, texto generado ni una
indicación de que el agente esté ejecutándose. «Anterior/posterior en el
recorrido» describe lectura, no el estado de la ejecución archivada.

Para una implementación futura se recomienda una lista ordenada con selección
por botones y paginación explícita. El [patrón Feed de W3C](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)
establece un contrato adicional para lectura y carga dinámica de artículos;
una lista de actividad no debe recibir ese rol solo por parecer un feed.

## C: timeline por capítulos

La escena principal muestra un hito a la vez con resumen, actor, hora y estado.
Una línea de puntos y controles de anterior/siguiente permiten navegar. Tres
capítulos de lectura agrupan los siete hitos del ejemplo. Elegir un capítulo
selecciona su primer hito; elegir un punto abre ese hito y conserva el inspector.

La reproducción mueve el cursor sobre la línea, actualiza la escena mediante
una transición de hasta 260 ms y acompaña el cambio con un halo finito de hasta
620 ms. Los puntos conservan forma distinta según ocurrencia o respaldo de
registro. El movimiento y las distancias no codifican duración.

En esta maqueta el espaciado es por secuencia, con timestamps originales como
etiquetas. Preparación/verificación/conservación son agrupaciones de lectura
ficticias y están identificadas como tales. Para una spec final la clasificación
de capítulos deberá quedar definida con casos de valores desconocidos; no puede
presentarse como fase declarada si el productor no la suministra.

La distinción entre un evento puntual y un intervalo con comienzo/fin se
mantiene conforme a los conceptos de [trazas de OpenTelemetry](https://opentelemetry.io/docs/concepts/signals/traces/).
Ninguna distancia, animación o línea de guía crea una relación de dependencia.

## Comportamiento común y comprobación

- Replay con inicio explícito, reinicio, pausa, anterior/siguiente, deslizador y
  velocidad 1×/2×/4×. La velocidad regula la presentación a cadencia uniforme.
- No autoplay al abrir una propuesta. Interactuar con el inspector o abrir un
  diálogo pausa la reproducción; ocultar la página también la pausa.
- La preferencia del sistema y el selector «Sin animaciones» mantienen contenido,
  selección y avance discreto. Esta decisión sigue el
  [criterio de animación por interacción de W3C](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html),
  sin afirmar certificación de conformidad.
- Cambiar de propuesta carga la maqueta seleccionada y descarta su reproducción
  anterior. A se conserva como referencia; la comparación no modifica producto.
- Chromium: reproducción/pausa, conservación del foco del botón, búsqueda en B,
  capítulos y puntos en C, apertura de relaciones, ambos temas, movimiento
  reducido explícito/del sistema, reflujo a 375/768 CSS px y selector A/B/C.
- Se inspeccionaron capturas de escritorio, móvil y tema claro. No se detectaron
  errores de JavaScript ni desbordamiento horizontal en esas comprobaciones.

Esta evidencia corresponde a maquetas con siete hitos. Rendimiento con 10 000
eventos, SSE, compatibilidad de archivos, seguridad de contenido no confiable y
garantía de solo lectura deberán verificarse durante la implementación del
enfoque seleccionado. El código de demostración no es código de producto.
