# Interfaz premium y explorador de trazabilidad — Spec de diseño

**Fecha:** 2026-10-10, America/Mexico_City. **Responsable:** omarfrancodev.
**Estado:** dirección visual aprobada; documento preparado para revisión del usuario.
**Base:** v0.1.0, commit `aca0a01839c581d975ba9df52939315e1387f50f`.
**Rama:** `docs/interfaz-premium`, worktree `interfaz-premium`.

Esta spec define el rediseño del visor publicado. Complementa el
[diseño original](2026-10-09-review-viewer-design.md): sus garantías de archivo,
compatibilidad, seguridad y separación del productor siguen vigentes. Para las
interacciones visuales descritas aquí, este documento sustituye la presentación
de v0.1.0. No acredita una implementación del rediseño.

## 1. Propósito y decisiones aprobadas

Permitir localizar una revisión rápidamente y comprender sus hitos, actores,
procedencia, relaciones y evidencias sin interpretar grandes bloques de JSON.
«Premium» significa jerarquía legible, densidad útil, componentes consistentes,
interacciones cuidadas y movimiento que explica cambios de contexto.

El usuario aprobó un espacio compacto con biblioteca lateral, cabecera de la
revisión, siete vistas e inspector. Tras comparar A/B/C y ajustar D, aprobó:

1. Actores en una franja superior; las tarjetas permanecen en una lista lineal,
   sin secciones ni reordenación por actor.
2. Timeline lineal global sincronizado con tarjetas e inspector.
3. Revelado progresivo del elemento completo: estructura, cabecera, contenido
   y acciones. El efecto no se limita a escribir palabras del resumen.
4. El mismo tratamiento para nuevos hitos en En Vivo.
5. En Vivo disponible exclusivamente cuando `cierre.state === 'processing'`.
6. Último hito recibido con un estilo de carga mientras siga ese estado,
   independientemente del hito seleccionado. Al salir de `processing`, cesa.

Referencia visual principal:
[maqueta D aprobada](../mockups/2026-10-10-trace-hybrid.html).
Su selector de cierre y sus llegadas automáticas son simuladores con datos
sintéticos, exclusivos de la maqueta. No aparecerán en el producto.
La [investigación](../research/2026-10-10-interface-research.md), las
[alternativas](../research/2026-10-10-trace-alternatives.md) y la
[nota de D](../research/2026-10-10-trace-hybrid-streaming.md) explican las decisiones.
A/B/C se conservan como antecedentes, no como tres modos adicionales del producto.

## 2. Alcance y límites

Incluye shell, biblioteca, filtros, cabecera, temas y densidad, navegación,
presentación consistente de las siete vistas y el explorador D con reproducción,
En Vivo, inspector y relaciones navegables. Incluye estados de carga, vacío,
error, incompatibilidad, actualizaciones, accesibilidad y verificación visual.

Se mantiene Python con servidor local, APIs actuales y frontend ESM con
HTML/CSS/JavaScript y SVG locales. No se añade un framework, servicio de IA,
chat generado, telemetría externa, CDN, fuentes remotas o dependencia de runtime.
El parecido al streaming de un chat es un efecto visual sobre registros completos.

El visor sigue siendo de solo lectura: no modifica artefactos, ejecuta scripts,
invoca agentes, recupera transacciones del productor, consulta evidencia remota
ni reconstruye identidades o tiempos ausentes. La validación explícita de
integridad sigue disponible y no modifica el veredicto. Instalar desde wheel y
ejecutar como módulo conservan su funcionamiento; no se cambia el PATH del usuario.

## 3. Sistema visual y distribución

- Temas sistema, claro y oscuro. Grafito/neutros para superficies; índigo para
  selección, foco y acciones. Colores semánticos acompañados por texto e iconos.
- Tipografía del sistema, monospace para IDs/rutas/comandos y cifras tabulares.
  Texto principal de lectura de 14–16 px; etiquetas y metadata de 12–13 px.
  La maqueta fija composición, no obliga a reproducir sus textos pequeños.
- Espaciado 4/8/12/16/24/32 px, radios 6/10/14 px, bordes discretos y elevación
  para overlays. Estados hover, foco, seleccionado, deshabilitado y ocupado
  distinguibles en ambos temas.
- Densidad cómoda y compacta: varía padding y separación, sin reducir objetivos
  interactivos por debajo de 24 × 24 CSS px. En pantallas táctiles se usan 44 px
  para controles principales y acciones de icono.
- Cabecera global compacta con nombre del visor, acceso al contexto de raíz,
  tema y conexión. La ruta de archivo completa queda en un detalle explícito.
  No ocupa una franja permanente de avisos cuando todo funciona.

En anchos desde 1200 px: biblioteca de 280–320 px, contenido flexible e inspector
de 300–340 px. Entre 800 y 1199 px: biblioteca de 240 px, contenido flexible e
inspector debajo del explorador. Por debajo de 800 px: una columna, biblioteca
como superficie desplegable con retorno a la revisión e inspector debajo.
No se exige arrastrar separadores ni implementar un splitter en esta entrega.

Todo grid flexible usa contención de ancho; IDs/URLs extensos se ajustan o se
truncan solo en su etiqueta compacta. El valor completo siempre puede leerse y
copiarse. La página no tiene scroll horizontal; tablas, código y pestañas pueden
tener scroll propio con nombre accesible. A 400% de zoom se aplica la composición
móvil según el ancho CSS, sin perder controles ni información.

## 4. Biblioteca y filtros

La biblioteca es una lista de selección paginada, no una pared de tarjetas grandes.
Cada fila muestra título compacto, repositorio, estado y fecha. Se agrupa por
repositorio, sin repetir el alcance completo en el encabezado y en cada fila.

El título se obtiene de datos declarados: número de MR/PR solo cuando una
referencia tiene una forma reconocible, o referencia/alcance disponible. No se
inventa un título humano a partir de una URL. Si dos filas tienen la misma
etiqueta, se añade el ID de revisión o un fragmento de su clave opaca para
distinguirlas. Un detalle muestra identidad, alcance y referencia completos.
La selección usa `summary.key`, nunca el título de presentación.

Búsqueda visible, chips «Todas»/«Abiertas», botón de filtros y contador de filtros
activos. Los filtros avanzados mantienen las claves existentes: repositorio,
veredicto, perfil, modo, referencia, tipo y fechas desde/hasta. `open` usa un
selector Todas/Abiertas/Cerradas, no un campo que obligue a escribir true/false.
Fechas inválidas o desde posterior a hasta impiden aplicar y explican el error.

Los enums ofrecen valores del contrato empaquetado y permiten introducir un
valor original desconocido. Las sugerencias obtenidas de la página actual se
etiquetan como tales; nunca se presentan como inventario global. No se necesita
un endpoint de facetas. Repositorio y referencia admiten búsqueda escrita.

Los cambios avanzados son borradores hasta «Aplicar»; cancelar los descarta.
Los filtros aplicados aparecen como chips eliminables y «Limpiar». Búsqueda se
aplica con Enter o tras 250 ms sin escritura. Cada cambio aplicado reinicia
offset a cero, conserva foco/caret y cancela lógicamente respuestas obsoletas.
La página usa `getRuns` con 50 elementos; muestra total filtrado y página.
No se cambia de revisión solo porque su fila deje de coincidir con el filtro.

Hay estados distintos para biblioteca vacía, sin coincidencias, carga y fallo
con reintento. Un fallo de recarga conserva la última lista con un aviso de que
no está actualizada; no aparenta que se eliminaron las revisiones.

## 5. Contexto, navegación y siete vistas

La cabecera muestra título, repositorio, ID copiable, referencia, estado del
cierre, veredicto y conteos existentes. Integridad, cierre, veredicto y resultados
de checks son conceptos separados. No se crea una puntuación de calidad ni un
porcentaje de ejecución. Los conteos incluyen su alcance y provienen del modelo.

Las pestañas conservan las claves actuales; `ficha` se etiqueta «Resumen».
Se implementa tablist con activación manual: flechas/Home/End cambian foco;
Enter/Espacio activan. Cada tab enlaza su tabpanel. Al cambiar de pestaña se
pausan reproducción y revelado, conservando selección de hito por corrida.

| Vista | Presentación y comportamiento |
| --- | --- |
| Resumen | Identidad y alcance compactos, responsabilidad y autores separados, cobertura y limitaciones legibles. Campos originales en detalles, sin reinterpretar flags desconocidos. |
| Hallazgos | Lista densa con ID, prioridad, estado y ubicación; filtros locales con conteo; selección abre detalle con descripción, evidencia y referencias. Prioridad y estado conservan el valor original. |
| Validación | Checks y resultados declarados, comandos como texto inerte, diagnóstico y evidencia navegable. No se ofrece ejecutar comprobaciones. |
| Seguimiento | Entradas de re-review estructuradas cuando su forma es reconocida; aliases e historia preservados. Revisiones anteriores resueltas se abren explícitamente. Formas desconocidas conservan JSON secundario. |
| Documentos | Inventario seleccionable y preview local con ruta, formato y aviso de truncamiento; Markdown sanitizado. Falta de informe distinta de inventario vacío o lectura fallida. |
| Trazabilidad | Explorador D descrito en las secciones siguientes; una selección compartida por las tres superficies. |
| Archivo | Cierre, limpieza y residuos con estados legibles; diagnósticos agrupados por gravedad; «Verificar integridad» con resultado independiente; JSON original desplegable. Una lista vacía se expresa como ausencia de elementos declarados, no como `[]` principal. |

La navegación local admite `?run=<clave-opaca>&tab=<clave>&event=<id>` después
del canje de sesión. Solo claves permitidas; no rutas, tokens, contenido ni
filtros privados en URL. Un hito se abre en Trazabilidad; un ID ausente produce
aviso y selección segura, sin resolver otra corrida por parecido. Historial
Atrás/Adelante restaura selección y vista, sin activar reproducción automática.
El token de arranque sigue solo en el fragmento y se elimina tras canjearlo.

## 6. Explorador D: actores, timeline y tarjetas

### 6.1 Modelo y orden

Se usa el prefijo de eventos aceptado por el lector actual, con
`valid_prefix_length`, `chain_status`, `temporal_order`, relaciones y diagnósticos.
No se interpretan líneas pendientes o inválidas en el navegador. Una cadena
limitada/fallida se muestra con sus diagnósticos: no se rotula íntegramente
verificada por el hecho de que se puedan presentar sus eventos aceptados.

Timeline, tarjetas y reproducción siguen `sequence`. El orden temporal
alternativo del backend se conserva como dato en un detalle, sin sustituir el
orden lineal aprobado. Cada hito conserva ID, secuencia, kind/status, summary,
actor, recorder, executor, provenance, authority, evidencia y campos desconocidos.

Los tiempos muestran valor local con acceso a UTC y original, y base explícita:
ocurrencia observada, respaldo de registro o respaldo de secuencia sin hora.
Las distancias del timeline son pasos de presentación, no duraciones. No se
deducen concurrencia, critical path, dependencia o tiempos de ejecución.

### 6.2 Franja de actores

Participantes deduplicados por la identidad de actor declarada, en orden de
primera aparición. La clave usa kind/name/provider_id originales, sin fusionar
actores que solo comparten nombre. Identidad ausente aparece como «Actor no
declarado»; no se sustituye por recorder o executor. Identidades completas se
consultan en el detalle. La franja indica quién corresponde al hito seleccionado.

Seleccionar un actor busca su primer hito entre los resultados actuales, pausa
el recorrido y lo selecciona. Si no hay coincidencias, se explica; no se filtra
ni se agrupa automáticamente la lista. La búsqueda puede incluir actor, ID,
tipo, estado y resumen. Con muchos participantes, la franja tiene controles de
avance y acceso a una lista de actores; todos son alcanzables por teclado.

### 6.3 Timeline, lista e inspector

Timeline horizontal con puntos seleccionables, cursor, secuencia y base de tiempo.
Ocurrencia usa círculo, respaldo de registro rombo y ausencia de hora marcador
hueco; etiquetas accesibles describen la diferencia sin depender del color.
Controles: reiniciar, anterior, reproducir/pausar, siguiente, ir al último,
velocidad 0.5×/1×/2×/4× y deslizador de posición con ID/resumen accesible.

La lista tiene tarjetas en orden de secuencia: metadata breve, resumen, estado
original y acciones sobre relaciones/evidencia disponible. No imprime todos los
metadatos de cada hito ni duplica después una lista de todos sus IDs. Seleccionar
una tarjeta o un punto abre el mismo ID en el inspector, sin mover foco a él.

El inspector presenta original completo, bases temporales, actor/registrador/
ejecutor diferenciados, procedencia, relaciones, evidencia y JSON desplegable.
Copiar usa valores completos. La selección persiste si la búsqueda la oculta;
un aviso permite «Mostrar hito seleccionado» limpiando la búsqueda explícitamente.

«Seguir recorrido» desplaza solo el panel de tarjetas. Scroll manual, selección
manual, foco de lectura o apertura de detalle suspenden el seguimiento; un botón
permite retomarlo. No se desplaza la página ni se roba foco con nuevas llegadas.

### 6.4 Escala

Hasta 50 eventos el timeline muestra marcadores individuales. Con más, muestra
ventanas consecutivas de 50 con anterior/siguiente, rango visible y acceso al
hito por deslizador o búsqueda. El conteo total y la secuencia global se mantienen;
seleccionar un evento cambia a su ventana. No se renderizan 10 000 botones a la vez.

La lista pagina 50 tarjetas en orden; el recorrido cambia de página al alcanzar
su límite, sin retirar el foco de controles/inspector. Buscar recorre el modelo
completo y muestra total/rango de coincidencias, no solo la página. Como máximo
se montan 50 tarjetas y 50 marcadores; no se requiere virtualización de alturas
variables para esta entrega. Los actores muestran 8 accesos por ventana y una
lista paginada de 50 si se abre su selector. La cantidad de actores no altera
el orden de las tarjetas.

## 7. Reproducción y streaming del elemento

Al entrar a una revisión, reproducción pausada y registros completos disponibles;
se selecciona el último hito salvo navegación explícita a otro. No hay autoplay.
«Reiniciar» selecciona el primero y comienza un recorrido de presentación con
solo ese hito mostrado. «Reproducir» incorpora los siguientes en su secuencia.
Buscar/seleccionar manualmente puede abrir cualquier registro recibido y deja
el recorrido en pausa; el contenido completo sigue en el modelo.

En movimiento guiado cada tarjeta nueva se presenta durante 1800 ms a 1×:

| Etapa | Fracción de presentación | Efecto |
| --- | --- | --- |
| Estructura | 0–22% | Superficie/borde y espacio del elemento aparecen con brillo de presentación. |
| Cabecera | 18–42% | Metadata y título adquieren visibilidad progresivamente. |
| Contenido | 36–72% | Bloques completos del resumen o contenido sanitizado se revelan. |
| Acciones | 68–100% | Estado, vínculos y acciones terminan de aparecer. |

Las etapas se solapan para dar continuidad. El siguiente hito empieza tras
finalizar el elemento y una separación de 550 ms a 1×. Velocidad divide ambas
duraciones; no estima tiempo del productor. Cursor del timeline hasta 420 ms,
transición del inspector 160–180 ms y pulso de llegada único hasta 560 ms.
Estas duraciones son decisiones de diseño, no medidas de ejecución reales.

Se reserva espacio estable para evitar saltos grandes; el revelado usa máscara,
opacidad y transformaciones del contenido. Si se usa expansión de altura,
se limita a una sola tarjeta con dimensiones medidas una vez, sin medir todo
el listado por frame. Solo un elemento se revela a la vez. El inspector y los
datos originales están completos desde el comienzo, sin efecto de escritura.

Pausa congela progreso y avance; reanudar continúa desde el punto conservado.
«Mostrar tarjeta completa» termina el efecto. Acciones visualmente ocultas no
reciben foco; el botón principal y su descripción accesible ofrecen el texto
completo de inmediato. No se parsean fragmentos de Markdown/HTML ni se presenta
una línea incompleta como un hito. Copiar y buscar nunca usan una versión parcial.

Movimiento del sistema reducido o preferencia «Sin animaciones» muestra elementos
completos inmediatamente, elimina shimmer/pulsos/transiciones y convierte carga
en icono y etiqueta estáticos. Los controles y el avance discreto siguen disponibles.
En modo reducido la espera entre pasos es `2350 / velocidad` ms, para permitir
lectura sin convertir el recorrido en un salto inmediato al final.

Cambiar de corrida o pestaña, ocultar la página o abrir un diálogo pausa la
presentación. El retorno no reanuda solo. Se cancelan timers/animaciones al
desmontar y ninguna tarea antigua puede escribir en la nueva revisión.

## 8. En Vivo: disponibilidad y último activo

La disponibilidad se calcula exclusivamente con `view.closure?.state` de la
revisión seleccionada, tras una lectura coherente. El estado desconocido no
equivale a `processing`. El botón deshabilitado tiene explicación visible.

| Estado del cierre | En Vivo | Indicador del último hito |
| --- | --- | --- |
| `processing` | Habilitado; se activa por acción del usuario | Carga en el último evento aceptado por secuencia, incluso si se selecciona uno anterior. |
| `prepared`, `retaining`, `closing`, `complete` | Deshabilitado | Sin carga de revisión activa. |
| Ausente, ilegible o valor desconocido | Deshabilitado | Estado desconocido; sin actividad inferida. |

La conexión SSE es independiente: puede seguir actualizando biblioteca y estado
cuando En Vivo no esté habilitado. Conexión establecida, revisión abierta, cambio
reciente, evento de tipo agent o reproducción automática no habilitan En Vivo.
Una interfaz de carga no convierte un hito con status completed en running.

Al activar En Vivo se selecciona el último evento y se habilita el seguimiento.
Si `processing` no tiene hitos, se muestra espera de primer registro, sin tarjeta
ni actor ficticios. El último hito lleva borde distintivo, carga y «Último hito
activo · revisión en procesamiento». El punto correspondiente en el timeline
tiene la misma indicación. Este marcador representa el cierre de la revisión,
no prueba que un actor esté pensando o ejecutando una acción concreta.

El indicador de fuente y el de revelado visual son distintos. El primero persiste
con `processing` después de acabar la animación del elemento; el segundo termina
cuando la tarjeta está completa. Si el último hito está fuera de página o filtro,
se muestra «Último activo: <ID>» con acceso explícito, sin marcar un hito anterior.
En pausa se conserva la etiqueta; la animación de carga también se congela.

### 8.1 Recepción y nuevas tarjetas

Un aviso completo de `/api/events` solicita una recarga. Se acepta solo una
generación vigente de la corrida seleccionada. Las rutas de vista y traza son
peticiones separadas: se lee vista A, traza y vista B; ambas vistas deben tener
el mismo cierre original y no declarar `view.updating`. Si cambian, se conserva
el modelo anterior con aviso «Archivo en actualización» y se reintenta hasta
tres veces, a 250/500/1000 ms. Después se espera otro aviso o reintento explícito.
Esta comprobación detecta cambios observados entre rutas; no promete una
transacción atómica nueva del backend. Se conservan sus lectores de snapshot.

`chain_status = updating` también se usa para una corrida abierta normal: por
sí solo no impide presentar un prefijo aceptado ni habilitar En Vivo. Se distingue
de `view.updating` y diagnósticos `snapshot.transition_pending`/`transition_detected`.
No se habilita En Vivo a partir de un cierre parcial. Un cierre coherente nuevo
que ya no sea `processing` deshabilita En Vivo aunque falle la recarga de traza;
se conserva la última traza con su aviso de falta de actualización.

Los IDs nuevos se comparan por corrida con el modelo completo anterior. Modelo,
índice de búsqueda y datos accesibles se actualizan inmediatamente. En seguimiento,
la tarjeta se añade al final, se selecciona y usa el revelado del elemento.
El estado de carga se mueve al último recibido, no al cursor de reproducción.

En ráfagas solo se anima el más reciente: los anteriores se muestran completos.
Si llega otro durante un revelado, se completa el anterior y comienza el nuevo.
Se conserva cada registro; no se acumulan minutos de retraso visual. Se agrupan
avisos durante 100 ms y hay una sola recarga activa más una recarga pendiente.
Respuestas obsoletas se ignoran. Reconexión o resync no repiten eventos existentes.

Modificar un evento con el mismo ID actualiza su representación y muestra un
diagnóstico de cambio; no incrementa nuevos ni se trata como otra llegada. Si
se acorta/cambia el prefijo, se reemplaza el modelo por el prefijo aceptado,
se pausa y se advierte; nunca se conserva silenciosamente una unión obsoleta.

### 8.2 Pausa, lectura y cierre

Pausar conserva ID seleccionado, etapa visual, foco y scroll. Recepción continúa;
los IDs únicos nuevos se acumulan en «N nuevos sin presentar». Interactuar con
inspector/evidencia, seleccionar manualmente o desactivar seguimiento produce
el mismo comportamiento de lectura. No se marca como leído un registro solo
porque una petición o un aviso haya llegado.

«Mostrar nuevos» incorpora lo pendiente sin desplazar ni reanudar. «Reanudar
En Vivo» reconoce la cola, selecciona el último y retoma seguimiento; registros
anteriores completos y animación solo del último. Buscar no borra el contador.

Cuando una instantánea coherente cambia el cierre a cualquier estado distinto
de `processing`, En Vivo se deshabilita de inmediato, se detienen espera/carga y
el revelado en curso se completa. Se vuelve a reproducción pausada. Los datos
recibidos quedan disponibles; si el usuario estaba en pausa, selección/foco/
scroll se conservan y el contador permanece hasta «Mostrar nuevos» o navegación
explícita a esos registros. El cierre no inicia una reproducción automática.
La maqueta muestra todas las tarjetas al cerrar; el producto debe además
conservar esta cola de lectura para no perder los nuevos pendientes.

Si hay desconexión o error de lectura, se conserva el último modelo con un aviso
«Datos no actualizados». Si su último cierre era `processing`, En Vivo puede
seguir seleccionado para esperar reconexión, pero el spinner activo se sustituye
por icono estático y «Último estado conocido: processing · sin conexión».
No se simula recepción ni ejecución mientras la fuente no pueda actualizarse.
Al reconectar se recarga antes de restablecer la carga o contar nuevos IDs.

## 9. Relaciones y evidencia

El inspector enumera relaciones declaradas con tipo, destino y resolución del
backend. Solo `resolved` con destino dentro de la raíz habilita navegación.
E/F/C locales abren hito, hallazgo o check; destinos históricos/entre corridas
abren la corrida resuelta con acción explícita y retorno al contexto anterior.
`dangling`, `unresolved`, `ambiguous` y `unavailable` conservan valor original y
explicación, sin seleccionar por parecido ni buscar fuera de la raíz.

Una sección expandible «Relaciones» muestra el vecindario del hito: origen,
destinos y tipo de vínculo como lista navegable. Si hay ciclos, se etiqueta el
diagnóstico y no se recorre automáticamente. No se requiere un grafo con layout
automático para esta entrega; el timeline no inventa aristas por proximidad.

La evidencia enlaza solo coincidencias exactas del inventario local por
`relative_path`, y solicita preview con `run_key`/`file_key` opacos. Rutas absolutas,
traversal, URLs y referencias no resueltas se muestran como texto inerte con
diagnóstico. No se concatena una ruta del archivo a una URL de API. Se conserva
sanitización y política de vínculos existente; ninguna animación relaja esas reglas.

## 10. Componentes y flujo técnico

Se reutilizan `api.js`, `store.js`, renderizadores actuales y utilidades DOM.
La separación siguiente define responsabilidades; el plan fijará las ediciones
y archivos exactos sin migrar el producto a otra arquitectura:

| Unidad | Responsabilidad e interfaz |
| --- | --- |
| Shell y navegación | Montar regiones estables, tabs, biblioteca móvil, historial y selección; recibir estado del store, emitir acciones. |
| Presentación y preferencias | Etiquetas compactas sin alterar originales; tokens visuales; tema/densidad/movimiento en preferencias locales. |
| Biblioteca | Filtros aplicados/borradores, filas y paginación con las APIs existentes. |
| Modelo de traza | Derivar índices de eventos/actores/búsqueda desde snapshot completo; diferencias por ID y secuencia, sin DOM. |
| Playback y controlador de presentación | Una sola autoridad para selección, reloj, cola y pausa; coordinación de playback existente con revelado; disponibilidad por cierre. |
| Timeline y tarjetas | Render acotado por ventanas/páginas, mismo ID seleccionado, estados activo/recibido/revelándose separados. |
| Inspector y relaciones | Dato completo, navegación explícita y evidencia por claves del inventario. |
| Overlays | Foco inicial/retorno, Escape, cierre y pausa; sin HTML de archivo insertado como instrucciones. |

Se adapta `createPlayback`: el modo inicial será pausado; entrada/retorno a vivo
se guardan por disponibilidad de cierre en el controlador. No habrá un segundo
reloj independiente que avance eventos mientras todavía se revela la tarjeta.
El contador de IDs de la traza se separa del contador de avisos de biblioteca.
`app.js` conserva sus generaciones para descartar peticiones tardías y evita
recrear tabs/controles/inspector no afectados por cada aviso.

El backend no cambia schemas, rutas privadas, reglas de lectura ni API version.
Sí se actualiza la lista finita `STATIC_RESOURCES` de `server.py` para cualquier
JS/CSS/SVG nuevo, y los patrones de package-data si hay carpetas nuevas. Se
verifica desde una wheel instalada que todos los recursos se sirven con CSP
actual. El HTML inline de las maquetas no se traslada al producto ni se permite
`unsafe-inline` para facilitar el rediseño.

Solo tema, densidad y preferencia de movimiento pueden guardarse en localStorage.
Filtros, selección, datos de archivo, IDs, rutas y token permanecen en memoria
o en la navegación local limitada descrita antes. No se registran contenidos
de revisiones en logs de navegador para depurar la animación.

## 11. Accesibilidad, errores y recuperación

- Texto normal con contraste mínimo 4.5:1; controles/foco/elementos gráficos
  esenciales 3:1. Estados nunca dependen solo de color o movimiento.
- Lista semántica con botones de selección; no se añade `role=feed` sin su
  contrato de interacción. El texto completo queda accesible al recibirlo.
- Región polite anuncia llegada/contador/cierre una vez por cambio, no por
  palabra, frame o tick. Errores que impiden una acción se vinculan a su control.
- Tabs, slider nativo, botones, filtros y actor selector se usan con teclado.
  No hay una acción que solo pueda realizarse arrastrando o con hover.
- Diálogos tienen nombre, foco contenido, Escape y retorno al invocador; si
  ese elemento dejó de existir, retorno al control estable más próximo.
- Actualizar fuente no mueve foco ni borra caret, borradores, scroll o selección.
  Si se elimina el hito seleccionado del prefijo aceptado, se avisa y se elige
  el último disponible sin desplazar al usuario; nunca un hito inválido.
- Traza vacía, sin tiempo, sin actor, sin evidencia o sin relaciones tiene
  mensaje propio. Archivo parcial/incompatible mantiene originales/diagnósticos
  accesibles y no muestra una superficie vacía como éxito.
- Un error de preview conserva lista/selección y ofrece reintentar. Error de
  integridad mantiene resultado de fuente. Al caducar sesión se pide relanzar
  el visor local; no se intenta recuperar tokens del almacenamiento.

## 12. Aceptación y evidencia requerida

El plan deberá convertir estos criterios en verificaciones con datos sintéticos:

| ID | Criterio observable |
| --- | --- |
| UI-01 | Biblioteca compacta con 1000 corridas; títulos coincidentes/URLs/IDs largos distinguibles, filtros tipados, total filtrado y paginación correctos; selección/caret estables durante recarga. |
| UI-02 | Siete vistas consistentes, sin JSON vacío como presentación principal; originales, responsabilidad, veredicto e integridad preservados. |
| TR-01 | Tarjetas en secuencia; actores solo en franja superior; seleccionar actor/punto/tarjeta converge en un mismo ID e inspector. |
| TR-02 | 0/1/50/51/10 000 hitos, muchos actores, horas iguales/ausentes/fuera de orden y bases distintas; como máximo 50 tarjetas/50 puntos montados, todos los eventos alcanzables. |
| TR-03 | Reproducción sin autoplay, reinicio/pasos/último/velocidad; revelado del elemento completo, pausa congela y reanuda; mostrar completo y reduced motion conservan datos/control. |
| LV-01 | Solo `processing` habilita En Vivo; prepared/retaining/closing/complete/ausente/malformado/desconocido no lo habilitan. Conexión sola no habilita. |
| LV-02 | Último activo por secuencia independiente de selección; carga sigue tras revelado, se mueve con llegada y desaparece al salir de processing; sin hitos no se inventa tarjeta. |
| LV-03 | Recepción real por servidor local, cambio de cierre entre peticiones detectado, updating de corrida abierta distinto de transición de snapshot, IDs nuevos únicos, ráfagas/deduplicación/resync; mismo ID modificado no cuenta como nuevo; prefijo reducido pausa con aviso. |
| LV-04 | Pausa/foco/scroll/búsqueda preservan contexto y cola; reanudar/mostrar nuevos explícitos; cierre durante pausa conserva pendientes; desconexión informa estado conocido sin spinner engañoso. |
| RF-01 | Relaciones resueltas navegan explícitamente; ciclos/destinos ambiguos o ausentes se explican; evidencia solo por inventario y claves opacas. |
| AX-01 | Teclado completo, foco/retorno de diálogos, tabs manuales, región de estado sin anuncios repetidos; contraste en claro/oscuro y movimiento reducido del sistema/en la UI. |
| VS-01 | Capturas y revisión visual a 320/375/768/1024/1440/1920 CSS px, zoom 200/400%, ambos temas y densidades; sin overflow horizontal de página ni controles cortados. |
| SC-01 | HTML/Markdown hostil, javascript URLs, traversal y metadata desconocida permanecen inertes; sesión/CSP/opacidad de rutas preservadas. |
| PK-01 | Wheel instalada sirve todos los recursos nuevos; arranque como módulo y entrypoint; no requiere Node/CDN/framework en runtime. |
| RO-01 | Abrir, reproducir, seguir y validar no cambia bytes, SHA256, tamaños ni mtimes de archivos sintéticos de revisión. |

Pruebas de comportamiento JS para modelo/controlador y de navegador para
interacciones. Regresiones Python existentes de acceso, traza, readonly y
packaging cuando haya implementación. No basta validar selectores estáticos
ni la maqueta: En Vivo del producto debe probarse con el servidor local y una
fixture sintética actualizada externamente por el test, nunca por el visor.

Se exige inspección visual de carga del último hito y de al menos dos etapas
del streaming, además de estados vacío/error/cerrado. Las capturas actuales
de la maqueta ya se inspeccionaron; no sustituyen esas pruebas del producto.

Objetivo de laboratorio: p95 menor de 200 ms desde interacción hasta actualización
visible de selección/búsqueda local con modelo de 10 000 eventos ya cargado,
Chromium en un equipo documentado y 30 interacciones tras calentamiento. Separar
latencia API/carga inicial; no declarar este ensayo como una medición de INP de
usuarios reales. Si no se cumple, perfilar y ajustar render acotado sin perder
acceso a eventos, controles o datos originales.

## 13. Referencias y siguiente etapa

Patrones adaptados, con límites propios del archivo de hitos:
[Grafana Explore](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/),
[trazas de OpenTelemetry](https://opentelemetry.io/docs/concepts/signals/traces/),
[tablas de Carbon](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines)
y [grafo de Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph).
No se trasplantan intervalos o dependencias que la fuente no declare.

Contratos de interacción y presentación:
[tabs APG](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
[Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html),
[mensajes de estado](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
y [SSE WHATWG](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).
Son fuentes de criterios, no una certificación de conformidad del producto.

La aprobación visual permite redactar este documento. El siguiente paso es la
revisión explícita de esta spec escrita por el usuario. Después se elaborará el
plan de implementación con Superpowers writing-plans. Esta sesión no ha recibido
una elección de método de ejecución del futuro plan; no se inicia código de producto.
