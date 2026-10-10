# Propuesta D: agentes, timeline y streaming de presentación

Fecha: 2026-10-10, America/Mexico_City. Estado: maqueta aprobada por el usuario.
Base: v0.1.0; worktree `interfaz-premium`, rama `docs/interfaz-premium`.

## Solicitud del usuario

Combinar B y C conservando los actores en la franja superior, el timeline lineal
y las tarjetas del registro de actividad. En su última corrección, el usuario
precisó que las tarjetas deben permanecer en orden lineal, sin grupos por actor.
El streaming debe afectar al elemento completo, no solo al texto. En Vivo solo
se habilita cuando `cierre.state` es exactamente `processing`; el último hito
recibido debe tener un estilo de carga mientras esa condición siga vigente.

La [maqueta D](../mockups/2026-10-10-trace-hybrid.html) conserva el espacio de
revisión aprobado: biblioteca compacta, cabecera, pestañas e inspector. A/B/C
siguen disponibles como referencias. No se ha cambiado código del producto.

## Composición e interacción

1. Participantes: agentes y herramientas declarados, con acceso a sus hitos.
2. Timeline horizontal: selección y recorrido por secuencia global. La forma
   del punto distingue ocurrencia y registro como respaldo; las distancias no
   representan duración. En la demo En Vivo aparecen solo hitos ya recibidos.
3. Una lista de tarjetas en la secuencia global original, sin secciones por actor.
   La identidad del actor permanece en cada tarjeta y en la franja superior.
4. Inspector: original completo, timestamps, registrador, relaciones y evidencia.
   La selección conecta timeline, tarjeta y actor, sin reordenar la fuente.

En reproducción, reiniciar muestra el primer hito. Reproducir va incorporando
tarjetas al recorrido y construye visualmente cada elemento: estructura inicial,
cabecera, contenido y acciones. La superficie crece y las secciones aparecen
progresivamente, con un brillo de presentación. No se usa un cursor que escriba
palabras. La duración total propuesta es 1800 ms a velocidad 1×, seguida de una
separación breve antes de avanzar al siguiente hito.
La velocidad modifica presentación; no reconstruye tiempos de ejecución.

Pausar congela el revelado del elemento y el recorrido. Reanudar continúa desde
ese punto. «Mostrar tarjeta completa» permite terminar el efecto sin esperar. Buscar
filtra tarjetas, mientras la selección y el inspector conservan su contexto.
«Seguir recorrido» controla el desplazamiento automático dentro del panel.

## En Vivo y significado de los indicadores

La maqueta inicia con una revisión cerrada y En Vivo deshabilitado. Un selector
de estados sintéticos permite probar `complete`, `processing`, `prepared`,
`retaining`, `closing` y desconocido/sin cierre. Ese selector solo pertenece a
la maqueta; el producto deberá usar el valor leído del archivo, sin permitir editarlo.
Ninguna condición distinta de `processing` habilita En Vivo, aunque la revisión
parezca abierta o la conexión SSE esté establecida.

Al seleccionar `processing`, la demo muestra cuatro registros completos y
habilita En Vivo. Al activarlo simula nuevas llegadas cada cuatro segundos y
ofrece «Simular nuevo hito». Cada llegada incorpora una tarjeta al final de la
lista lineal y activa el mismo revelado del elemento completo.
Las llegadas manuales rápidas completan el efecto anterior y presentan el nuevo
hito, conservando ambos registros completos en el modelo.

El último hito recibido, identificado por la secuencia de la fuente y no por
la selección del usuario, tiene un borde destacado, un indicador de carga y
la etiqueta «Último hito activo · cierre processing». Su punto en el timeline
también muestra carga. Seleccionar un hito anterior no mueve ese indicador.
Los estados originales del hito se conservan: la carga indica el estado de la
revisión, no demuestra que ese agente esté ejecutando una tarea concreta.
Si el último hito queda oculto por búsqueda o por la pausa, no se atribuye su
actividad a una tarjeta anterior; se mantienen el estado y el contador pendiente.

Los textos separan estados de interfaz:

- «Esperando nuevos registros»: todavía no llegó otro hito.
- «Presentando tarjeta»: existe el registro completo y se revela el elemento.
- «Presentación pausada»: recepción y presentación llevan curso separado.
- «N nuevos sin presentar»: registros recibidos mientras la selección está fijada.
- «Cierre complete»: se recibió el cierre, cesan la carga y En Vivo.

Pausar En Vivo conserva tarjeta, etapa de revelado e inspector. La demo sigue recibiendo
registros y muestra un contador. Reanudar presenta lo recibido y anima el más
reciente. Leer mediante foco en tarjetas, abrir evidencia o interactuar con el
inspector pausa la presentación para preservar el contexto de lectura.

Al recibir el séptimo hito, la demo cambia el cierre a `complete`, deshabilita
En Vivo, detiene su temporizador y retira el estilo de carga. Regresa a
reproducción pausada con los registros completos disponibles. Si el usuario
había pausado, conserva el hito seleccionado; no inicia otro recorrido.
En el producto, cualquier transición de `processing` a otro estado debe aplicar
esa misma condición de salida sin inferirla del título ni del tipo del hito.

La demo usa datos sintéticos y no abre una conexión SSE a revisiones reales.
Los indicadores de presentación no declaran que un agente esté pensando,
generando una respuesta o ejecutando una herramienta.

## Cómo encaja con el producto existente

El código actual de `web/api.js` recibe avisos completos por `EventSource` y
`web/app.js` recarga la revisión seleccionada. `trace.py` devuelve eventos
completos y `valid_prefix_length` junto a diagnósticos e integridad. Esa ruta
permite identificar nuevos IDs después de una instantánea coherente; no entrega
tokens del texto de una revisión.

La futura implementación debe separar datos y efecto visual:

1. Recibir un aviso, obtener la instantánea y conservar la secuencia de eventos
   completa del prefijo aceptado por el lector actual.
2. Comparar IDs estables para incorporar solo nuevos hitos. Reconectar o recargar
   un mismo evento no vuelve a reproducirlo. Cambiar contenido de un mismo ID es
   una actualización con diagnóstico, no un nuevo mensaje.
3. Actualizar el modelo completo inmediatamente. El original, copiar, buscar,
   relaciones y accesibilidad usan los valores completos.
4. Revelar solo la presentación visual de la tarjeta completa. Para Markdown, trabajar
   sobre bloques completos ya sanitizados; nunca parsear fragmentos de HTML o
   Markdown no confiables como si fueran nuevas instrucciones.
5. Mantener separadas cola de datos recibidos y animación. En ráfagas, mostrar
   registros anteriores completos y animar el último para evitar retraso artificial.
6. En pausa, conservar foco, scroll, ID seleccionado y contador de nuevos. Resync,
   cambio de corrida o pestaña cancelan el trabajo visual anterior.

El [estándar de SSE de WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)
define cómo se acumulan y despachan eventos del transporte. Ese mecanismo no
justifica mostrar líneas incompletas del archivo como hitos ni interpretar
fragmentos de transporte como fragmentos del contenido de una revisión.

## Accesibilidad y límites de la propuesta

- La preferencia de movimiento del sistema y «Sin animaciones» presentan el
  contenido completo de inmediato. Mantienen selección, controles y recepción.
- El texto completo está disponible para tecnologías de asistencia desde que
  se recibe el evento. La copia visual del resumen se marca `aria-hidden` y se
  proporciona una descripción completa; no se anuncia cada etapa al lector de
  pantalla. Las acciones aún ocultas permanecen fuera del recorrido de teclado
  hasta finalizar el efecto; el inspector permite acceder al registro completo.
- Una región de estado comunica la llegada de un hito y el contador pendiente.
  Esa separación sigue el objetivo de
  [mensajes de estado de W3C](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- Los controles permiten pausar presentación y movimiento, en línea con
  [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
  Estas decisiones no son una certificación de conformidad WCAG.
- Timeline y tarjetas no crean dependencias ni tiempos; se conservan campos y
  estados originales. Los comandos de evidencia se muestran, no se ejecutan.
- Para grandes archivos, la spec final deberá fijar presentación de actores
  desconocidos, paginación de la lista lineal, clustering del timeline, cancelación,
  ráfagas y preservación del foco. La maqueta de siete eventos no prueba esa escala.

## Verificación y siguiente etapa

La comprobación de esta iteración cubre lista lineal, actores arriba, construcción
por etapas de la tarjeta completa, pausa/reanudación, disponibilidad exclusiva
para `processing`, indicador del último hito independiente de la selección,
deshabilitación al recibir cierre, acumulación en pausa, llegada automática,
preferencias de movimiento, temas, vistas móviles y conservación del JSON de
los eventos sintéticos. Esta evidencia corresponde a la maqueta, no al producto.
La comprobación final terminó con código de salida 0 en Chromium, incluyendo
la página del acompañante visual y anchos de 375 y 768 píxeles. Se inspeccionaron
capturas de la tarjeta durante el revelado y de la distribución móvil.

El usuario aprobó esta versión de D. La
[spec integral](../specs/2026-10-10-interface-premium-design.md) incorpora sus
decisiones, define la escala y conserva la cola de lectura al recibir cierre,
incluso si se deshabilita En Vivo. La revisión escrita de esa spec precede al
plan de implementación, conforme al flujo de Superpowers elegido por el usuario.
