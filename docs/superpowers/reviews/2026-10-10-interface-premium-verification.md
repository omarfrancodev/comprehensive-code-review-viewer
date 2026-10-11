# Verificación de la interfaz premium — 2026-10-11

Registro de la verificación final del rediseño descrito en
[la spec](../specs/2026-10-10-interface-premium-design.md) y ejecutado según
[el plan](../plans/2026-10-10-interface-premium-implementation.md). Cubre la
tarea 14 (PK-01) y consolida la evidencia de los criterios de §12. Un criterio
sin evidencia directa se marca «no verificado». Todo total de este documento
procede de la ejecución del 2026-10-11 descrita abajo, salvo las dos secciones
que declaran expresamente otro origen (laboratorio de la tarea 13 e inspección
visual).

## Árbol verificado

- Rama `feat/interfaz-premium`, commit `314e669`
  (`314e6692c0ea9851c36fca24b2b7a310306a796b`). Es el árbol que se ejecutó.
- Sobre `7edcaa4` (tareas 1–14) contiene las correcciones de producto de la
  revisión final: `4f8398e` (interactuar con el inspector o seleccionar a mano
  suspende el seguimiento, §6.3 y §8.2), `2cdab5f` (se muestra el repositorio
  declarado y no la identidad normalizada) y `dccd390` (sin «Copiar resumen» en
  las tarjetas), y las cinco del review del PR #4: `b3b2281` (un `verified`
  desconocido no se presenta como negativo), `976995a` (Documentos conserva la
  selección hecha durante una recarga), `63a10a5` (buscar pausa el recorrido y
  suspende el seguimiento), `c05adbf` (la lista de tarjetas se limita al prefijo
  presentado) y `314e669` (Atrás a una entrada de Trazabilidad sin `event`
  restaura el hito por defecto). El commit que actualiza este informe solo
  cambia documentación.
- Las suites se ejecutaron con el árbol de trabajo limpio en ese commit (más este
  documento aún sin confirmar, que ninguna prueba lee). Las de navegador usaron
  el servidor estático de pruebas en otro puerto (`CCR_STATIC_PORT=8791` y
  `CCR_BASE_URL=http://127.0.0.1:8791`) porque el 8765 lo ocupaba un proceso
  ajeno a este worktree.

## Entorno

| Elemento | Valor |
| --- | --- |
| Sistema | Windows 11 Home 10.0.26200 (`Windows-11-10.0.26200-SP0`), x64 |
| Python | 3.14.3 (el proyecto declara `>=3.10`; 3.10 y 3.12 corresponden a CI y no se ejecutaron aquí) |
| Node | v24.15.0 |
| Playwright | 1.64.0 |
| Navegadores | Chromium 156.0.8078.4 y Firefox 157.0 (headless) |
| CPU / memoria | AMD Ryzen 7 6800H, 16 hilos lógicos, 23 GiB |
| Dependencias de ejecución | ninguna (`dependencies = []`) |

## Comandos y resultados

Todos desde la raíz del worktree, con `PYTHONPATH=src` para Python.

| Comando | Resultado de esta ejecución |
| --- | --- |
| `python -m unittest discover -s tests -p "test_*.py"` | **267 pruebas, OK**, 0 fallos, 0 errores, 0 omitidas (63.0 s), una ejecución |
| `node --test "tests/js/*.test.mjs"` | **420 pruebas en 59 suites: 420 aprobadas**, 0 fallos, 0 omitidas |
| `node tools/vendor.mjs` y `git diff --exit-code src/ccr_viewer/web/vendor` | **No repetido en esta ejecución** (las correcciones no tocan `vendor/`); en la anterior (`2cdab5f`), salida 0 en ambos |
| `npx playwright test --project=chromium` | **263 aprobadas**, 0 fallos, 0 omitidas (6.2 min) |
| `npx playwright test --project=firefox` | **259 aprobadas, 4 omitidas**, 0 fallos (6.9 min). Una ejecución anterior sobre el mismo commit tuvo 1 fallo en `readonly.spec.mjs` «RO-01: revisión en procesamiento…» (la vista del Archivo, leída durante una escritura del productor real, no mostró «Integridad:» en 15 s); la prueba pasó 3 de 3 veces aislada y la suite completa se repitió sin fallos |
| `python -m pip wheel . --no-deps --wheel-dir <temporal>` | **No repetido en esta ejecución.** En la ejecución anterior (`78168ff`) se construyó `comprehensive_code_review_viewer-0.1.0-py3-none-any.whl`; ver «Hallazgo de empaquetado». La construcción desde una copia limpia la repite `tests/test_packaging.py`, que pasó en la suite Python de esta ejecución |

Las 4 pruebas omitidas en Firefox son las que dependen de Chromium:
`explorer-playback.spec.mjs` «copiar el resumen desde el inspector durante el revelado
copia el texto completo», `inspector.spec.mjs` «copiar usa el valor completo», `views.spec.mjs`
«copiar ID copia el valor completo» y `perf.spec.mjs`.

Chromium por archivo de especificación: a11y 6, acceptance 7, document-content 2,
explorer 23, explorer-playback 20, hostile 2, inspector 26, library 33, live-real 3,
live-transition 1, live-ui 32, markdown 8, perf 1, profile 8, readonly 2, shell 16,
views 39, visual 26, wiring 8.

Pruebas de empaquetado de `tests/test_packaging.py` (11, todas OK):
las siete de contenido de la wheel (módulos Python, 42 recursos estáticos
exactamente iguales a las claves de `STATIC_RESOURCES`, recursos vendor con su
inventario, licencias de terceros, contratos, exclusión de árboles de desarrollo e
inventario vendor frente a bytes), `METADATA` sin `Requires-Dist`, y tres de
ejecución instalada:
arranque con `python -I -m ccr_viewer` fuera del repositorio, servicio de **cada**
recurso de `STATIC_RESOURCES` por `/assets/<clave>` con su `Content-Type`, la
`Content-Security-Policy` igual a `CONTENT_SECURITY_POLICY` y `nosniff`, y el
mismo servicio arrancando con el script instalado `ccr-viewer`. Además comprueban
que el índice servido no contiene `unsafe-inline`, `<style>`, atributos `style=`,
manejadores `on*=` ni `<script>` sin `src`, y que `/assets/lifecycle.js` responde 404.

## Mapa criterio → evidencia

Los nombres corresponden a archivos y títulos de prueba presentes en el árbol.
Las pruebas de navegador usan datos sintéticos; las que interceptan la API
(`page.route`) lo indican, y las que usan el servidor Python real se marcan
«servidor real».

| ID | Evidencia | Estado |
| --- | --- | --- |
| UI-01 | `tests/browser/library.spec.mjs`: «UI-01 lista y paginación» (1000 corridas con 50 filas, total y página, y total filtrado; títulos coincidentes distinguibles por ID; URL larga sin desbordar; repositorio declarado en fila, detalle, cabecera y Resumen con agrupación por identidad normalizada), «UI-01 filtros» (selector Todas/Abiertas/Cerradas, fechas inválidas, borradores, chips, enums con valor libre, sugerencias rotuladas), «UI-01 búsqueda» (250 ms, Enter, foco y caret tras recarga), «UI-01 estados, selección y recarga». Apoyo: `tests/js/filters.test.mjs`, `tests/js/present.test.mjs` | Verificado con API interceptada; no con 1000 corridas reales en disco |
| UI-02 | `tests/browser/views.spec.mjs` (cabecera con cierre, veredicto, integridad y checks separados; Resumen, Seguimiento, Archivo, Hallazgos, Validación, Documentos; «residuos vacíos son ausencia declarada y el JSON original queda desplegable»), `tests/browser/profile.spec.mjs` («responsable y autores del cambio aparecen por separado», «la validación no convierte ausencia en aprobado»), `tests/browser/wiring.spec.mjs` | Verificado en estructura y conservación de originales; la consistencia visual entre las siete vistas no tuvo inspección manual propia (ver «Inspección visual») |
| TR-01 | `tests/browser/explorer.spec.mjs`: «tarjetas en secuencia, actores solo en franja», «TR-01: actor, punto y tarjeta convergen en el mismo ID e inspector», «seleccionar no roba el foco ni lo lleva al inspector»; `tests/js/trace-model.test.mjs` («buildTraceModel: actores») | Verificado |
| TR-02 | `tests/browser/explorer.spec.mjs`: «0 eventos», «1 evento», «50 hitos», «51 hitos», «TR-02: 10 000 hitos y 60 actores con render acotado», «las bases temporales se distinguen sin depender del color» (incluido el marcador «sin hora») y «la cadena y las bases se rotulan sin fabricar duración»; `tests/browser/inspector.spec.mjs` («el orden temporal declarado es un dato en un detalle, no una lista paralela»: horas fuera de secuencia, `E000003 → E000002 → E000001`; «sin relaciones, evidencia, actor ni hora: un mensaje propio para cada caso»); `tests/js/trace-model.test.mjs` («ventanas», «cadena, tiempos y relaciones» con «conserva horas iguales, respaldos de secuencia y el orden temporal del backend», «reconcileTrace», «trazaSintetica»); `tests/js/presenter.test.mjs` («orden único del modelo con secuencias no confiables»); servidor: `tests/test_trace.py` (`test_canonical_recording_order_is_always_available`, `test_sequence_fallback_is_diagnosed_and_ordered_last`, `test_basis_labels_distinguish_occurrence_from_recording_fallback`). `tests/js/wiring.test.mjs` («el orden temporal intercala instantes efectivos de distintas bases») ejercita `playback.temporalOrder()`, que el producto no usa, y **no** es evidencia de TR-02 | Verificado |
| TR-03 | `tests/browser/explorer-playback.spec.mjs` (sin autoplay, Reiniciar, «Reiniciar: la lista solo muestra el prefijo presentado y la búsqueda alcanza el resto», 1×/2×, etapas sin salto de altura, pausa que congela y reanuda, «Mostrar tarjeta completa», foco con acciones inertes, movimiento reducido del sistema y de la UI, pausa por contexto, duraciones); `tests/js/presenter.test.mjs` («reproducción y revelado»); `tests/js/playback.test.mjs` | Verificado |
| LV-01 | `tests/browser/live-ui.spec.mjs` «LV-01 disponibilidad por cierre» (cada estado distinto de `processing` deshabilita con la conexión abierta; `processing` habilita); `tests/js/presenter.test.mjs` («disponibilidad de En Vivo») | Verificado |
| LV-02 | `tests/browser/live-ui.spec.mjs` «LV-02 último hito activo» (carga en el último por secuencia con otro seleccionado, persiste tras el revelado y se mueve con la llegada, cesa al salir de `processing`, «Esperando el primer registro», último fuera de página o filtro) | Verificado |
| LV-03 | Servidor real: `tests/browser/live-real.spec.mjs` (3 pruebas: `add_check` por SSE, ráfaga, cierre real, `transient_retention`, cierre y reapertura del canal sin repetir). API interceptada: `tests/browser/live-ui.spec.mjs` («lectura en actualización», «prefijo reducido: pausa y aviso», «mismo ID modificado»). `tests/js/live-sync.test.mjs`, `tests/js/live-reload.test.mjs`, `tests/js/presenter.test.mjs` («recepción en vivo»). Servidor: `tests/test_live.py` (reanudación por cursor, `resync`, cola llena), `tests/test_readonly.py` (`FixtureProducerTests`) | Verificado, salvo la reconexión nativa con `Last-Event-ID` en un navegador: **no verificado** |
| LV-04 | `tests/browser/live-ui.spec.mjs` «LV-04 pausa y cola de lectura» (pausa conserva ID, foco y scroll; buscar no borra el contador; «Mostrar nuevos» no reanuda; cierre durante pausa conserva pendientes; desconexión con icono estático; interactuar con el inspector produce la misma lectura: «abrir «JSON original» en seguimiento es lectura: la llegada va a la cola y el inspector conserva hito, JSON y foco; «Reanudar En Vivo» retoma» y «enfocar «Copiar JSON» en seguimiento es lectura: el foco y el hito se conservan; «Seguir recorrido» retoma»), «error de lectura», «anuncios: un mensaje por ráfaga»; selección manual en replay: `tests/browser/explorer-playback.spec.mjs` «seguir recorrido: una selección manual o leer en el inspector lo desactiva y el botón lo retoma»; escribir en la búsqueda también es lectura: «escribir en la búsqueda en seguimiento es lectura: la llegada queda en la cola y la selección se conserva» (`live-ui.spec.mjs`) y «escribir en la búsqueda durante «Reproducir» pausa el recorrido y conserva la selección» (`explorer-playback.spec.mjs`). Las tres pruebas de la interacción con el inspector pasaron en Chromium y Firefox en esta ejecución | Verificado |
| RF-01 | `tests/browser/inspector.spec.mjs` («relaciones»: local resuelta, hallazgo y check, entre corridas con retorno, `dangling`/`ambiguous` sin botón, ciclo etiquetado; «evidencia»: coincidencia exacta por clave opaca, hostil inerte, fallo del inventario); `tests/js/relations.test.mjs` | Verificado |
| AX-01 | `tests/browser/a11y.spec.mjs` (flujo completo con teclado en servidor real, región polite sin repeticiones, diálogos con foco y retorno, foco visible ≥3:1 en claro y oscuro); `tests/browser/shell.spec.mjs` («tabs»); `tests/js/contrast.test.mjs`; `explorer-playback.spec.mjs` (movimiento reducido) | Verificado por roles, foco, anuncios y contraste calculado; **no verificado** con un lector de pantalla real |
| VS-01 | `tests/browser/visual.spec.mjs`: «VS-01: matriz 320–1920 px × claro/oscuro × cómoda/compacta» (sin scroll horizontal, controles visibles y objetivos ≥24×24 CSS px) y 24 pruebas de captura de estados | Parcial: zoom del 200 % y 400 % aproximado con 640 y 320 px de ancho (**zoom real no verificado**); 1920 y 1024 px forman parte de la matriz pero solo se inspeccionó manualmente un subconjunto de capturas |
| SC-01 | `tests/browser/hostile.spec.mjs` (servidor real con `/trace` interceptada: HTML, `javascript:`, traversal, metadata desconocida y objetos hostiles inertes; sesión y claves opacas); `tests/browser/markdown.spec.mjs`; `tests/browser/document-content.spec.mjs`; `views.spec.mjs` («el contenido hostil de los hallazgos queda inerte»); `tests/js/links.test.mjs`; `tests/test_server.py`, `tests/test_access_regressions.py` | Verificado |
| PK-01 | `tests/test_packaging.py` (wheel instalada en entorno limpio: todos los recursos con Content-Type y CSP vigente, arranque como módulo y con el entrypoint `ccr-viewer`, sin `Requires-Dist`); `tests/test_static_resources.py` (los archivos de `web/` coinciden con `STATIC_RESOURCES`); `hostile.spec.mjs` (ninguna petición sale de 127.0.0.1) | Verificado en Windows con Python 3.14.3; Linux/POSIX y Python 3.10/3.12 **no ejecutados aquí** (CI) |
| RO-01 | `tests/browser/readonly.spec.mjs` (servidor real: huella de **toda** la raíz —bytes, SHA-256 y mtime— idéntica tras abrir, recorrer las siete vistas, reproducir, verificar integridad y seguir En Vivo, con una revisión cerrada y una en procesamiento); `tests/test_readonly.py` (`ReadOnlyTests`); `tests/test_live.py` («viewer_never_writes_to_the_archive», «transition_never_writes_to_the_archive») | Verificado |

## Laboratorio de rendimiento

`tests/browser/perf.spec.mjs`, solo Chromium, modelo `trazaSintetica(10000,
{actors: 60})` servido por `/trace`, como máximo 50 tarjetas y 50 marcadores
montados, 6 interacciones de calentamiento y 30 medidas (clic en marcador,
búsqueda sobre los 10 000 eventos, «Evento siguiente»), cada una desde el
`timeStamp` del evento de entrada hasta el segundo `requestAnimationFrame`.
Carga inicial y latencia de API se informan aparte. **Es un ensayo de laboratorio
y no una medición de INP.** Objetivo de la spec: p95 < 200 ms.

| Origen | p50 | p95 | máx. | Carga inicial | `/trace` (8.4 MB) |
| --- | --- | --- | --- | --- | --- |
| Implementador de la tarea 13, tres ejecuciones | 28.8, 29.8, 29.5 ms | 45.1, 44.2, 48.4 ms | 46.6, 44.5, 48.5 ms | 387 ms | 100 ms |
| Esta verificación, una ejecución | 28.9 ms | 48.8 ms | 49.1 ms | 335 ms | 91 ms |

Máquina: AMD Ryzen 7 6800H, 16 hilos, 23 GiB, win32 x64, Node v24.15.0,
Playwright 1.64.0, Chromium 156.0.8078.4. Las cifras de la tarea 13 son las que
registró su implementador; la fila de esta verificación procede de la salida de la
suite Chromium de hoy. Ningún ajuste fue necesario para cumplir el objetivo.

## Inspección visual

Hallazgos de la inspección manual de capturas hecha por el implementador de la
tarea 13 (archivos de `test-results/`, fuera de Git). **Esta ejecución volvió a
generar esas capturas con las pruebas de `visual.spec.mjs`, que pasaron, pero no
repitió la inspección manual.**

- **Carga del último hito** (1440 claro y 375 oscuro): el último hito muestra
  borde y fondo destacados, el icono de carga y «Último hito activo · revisión en
  procesamiento» en su propia línea; el marcador de la línea de tiempo repite la
  indicación y «En Vivo» muestra su punto activo. A 375 px la etiqueta pasa a dos
  líneas sin cortarse; sin solapes y con contraste correcto en ambos temas.
- **Revelado, ~25 %** (1440 claro y 375 oscuro): estructura y borde completos con el
  brillo; cabecera apenas visible; resumen y acciones ocultos y con el espacio
  reservado a la altura final.
- **Revelado, ~55 %**: cabecera completa y resumen parcialmente revelado con
  máscara inferior; acciones aún ocultas; sin saltos de altura.
- **Vacío**: «Esperando el primer registro» en procesamiento sin hitos (sin
  tarjetas, actores ni carga, con En Vivo disponible) y «No hay revisiones
  archivadas en esta raíz.» en la biblioteca vacía.
- **Error** (375 claro): «No se pudo leer la trazabilidad: …» en rojo dentro del
  panel, conservando cabecera y pestañas.
- **Cerrado** (1440 oscuro): «cadena verificada»; En Vivo deshabilitado con su
  motivo visible; «Reproducir» inactivo con la nota «Ya estás en el último hito…».
- **Matriz** (320 oscuro compacto, 1920 claro compacto y otras): sin desbordamiento
  horizontal y con los controles envueltos; a 320 px la franja de actores muestra
  dos columnas con su paginación.

## Hallazgo de empaquetado durante esta tarea

El worktree conservaba un directorio `build/` ignorado por Git, de construcciones
en el árbol anteriores, con un `build/lib/ccr_viewer/web/lifecycle.js` de un módulo
ya retirado. Como `pip wheel .` reutiliza `build/`, la wheel construida **desde el
árbol** contenía `ccr_viewer/web/lifecycle.js` (62 entradas), un archivo que ni
existe en `src/` ni está registrado en `STATIC_RESOURCES`. La prueba nueva lo
detectó (falló con `['lifecycle.js']`). Un checkout limpio no tiene ese problema:
la wheel construida desde una copia limpia de las fuentes tiene 61 entradas, 42 en
`web/`, exactamente las claves de `STATIC_RESOURCES`.

`construir_wheel` en `tests/test_packaging.py` construye ahora desde una copia
limpia (`pyproject.toml`, `README.md`, `LICENSE` y `src/` sin cachés ni `egg-info`),
de modo que la prueba valida lo que publicaría un checkout limpio y deja de
escribir `build/` y `egg-info` en el repositorio. No se borró el `build/`
obsoleto del worktree: es un directorio generado e ignorado, pero no se verificó
que pertenezca a esta tarea; conviene eliminarlo antes de construir una wheel de
publicación en este árbol.

## Limitaciones y decisiones

- **Reconexión nativa con `Last-Event-ID`.** No se ejercitó en el navegador:
  `setOffline` de Playwright no cierra un `EventSource` ya abierto en Chromium ni
  en Firefox. La reconexión se simula cerrando y reabriendo el canal del lado
  cliente, lo que reconecta sin `Last-Event-ID` y el servidor responde con
  `catalog_changed`. La reanudación del servidor por cursor está cubierta por
  `tests/test_live.py`.
- **Zoom 400 %.** Se aproxima con un ancho CSS de 320 px (y el 200 % con 640 px),
  como permite la spec para la composición móvil; no se probó el zoom real del
  navegador.
- **Fallo único de Python en la tarea 13.** Durante la tarea 13 una ejecución de la
  suite Python terminó con un fallo cuyo nombre no se capturó y que no se
  reprodujo en cuatro ejecuciones posteriores. En esta verificación se ejecutó la
  suite completa tres veces sobre `78168ff` y una vez sobre `2cdab5f`: todas
  terminaron con 267 pruebas OK, sin fallos ni errores. No se puede afirmar que
  esté resuelto: no se identificó qué prueba falló.
- **«Copiar resumen» por tarjeta** se añadió como acción interina en la tarea 10
  y se eliminó por decisión del usuario tras la revisión final: la copia del
  resumen queda sólo en el inspector, y las acciones de tarjeta son «Relaciones
  (n)» y «Evidencia (n)» cuando el hito las declara.
- **Rótulos de carga.** El indicador de carga tiene variantes de etiqueta estática
  según el motivo (sin conexión, datos no actualizados, esperando recarga),
  aceptadas durante la tarea 13; no se unificaron.
- **Barra de pestañas entre 375 y 640 px.** Se recorta («Seguimien…») y tiene
  desplazamiento horizontal propio; todas las pestañas son alcanzables con el
  desplazamiento o con las flechas, pero hay poca indicación visual de que existan
  más. Observación cosmética sin corregir.
- **Cursor de la línea de tiempo.** En el primer montaje se desliza desde el centro
  durante 420 ms; las capturas tomadas justo después de abrir lo muestran desplazado
  unos 40 px del marcador seleccionado. Una captura posterior lo muestra alineado.
- **Firefox** omite 4 pruebas exclusivas de Chromium (tres de portapapeles y el
  ensayo de rendimiento).
- **Entorno.** Una sola plataforma (Windows) y una sola versión de Python (3.14.3),
  Chromium y Firefox de escritorio; no se ejecutó WebKit, POSIX ni la matriz de
  CI. La mayoría de las pruebas de navegador usan el servidor estático de pruebas
  con la API interceptada; usan el servidor Python real `a11y`, `acceptance`
  (migración final), `hostile` (solo `/trace` interceptada), `live-real`,
  `live-transition` y `readonly`.
- **La etiqueta «Sin animaciones».** La preferencia de la interfaz se presenta
  como «Movimiento» con las opciones «Según el sistema» y «Reducido»; el título
  de una prueba de `explorer-playback.spec.mjs` la llama «Sin animaciones» de la
  UI. La documentación de usuario usa los rótulos reales de la interfaz.
- **Documentación ajena a esta tarea.** `docs/compatibility.md` afirma que el
  proyecto no tiene licencia decidida, mientras que el repositorio contiene
  `LICENSE` y el `README.md` declara MIT. No se modificó porque el documento no
  lista vistas; queda como observación para el propietario.
- **Publicación.** No se cambió la versión, no se etiquetó ni se publicó. La
  fusión y cualquier publicación requieren la autorización del usuario.
