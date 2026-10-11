# Uso del visor

El visor es una aplicación local de **solo lectura**. Explora revisiones ya
archivadas: no produce revisiones, no modifica el archivo y no ejecuta nada de lo
que encuentra dentro de él.

## Instalación y arranque

```bash
python -m pip install .
ccr-viewer
```

También sirve el módulo, que usa el mismo punto de entrada:

```bash
python -m ccr_viewer
```

Opciones:

| Opción | Efecto |
|---|---|
| `--root PATH` | Selecciona explícitamente el archivo que se explora |
| `--port N` | Puerto local de escucha; `0` elige uno libre (por omisión) |
| `--no-browser` | No abre el navegador; sólo imprime la dirección |
| `--version` | Muestra la versión y termina |

La precedencia de la raíz es: `--root`, luego `CCR_ARTIFACTS_DIR`, y por último
`~/.comprehensive-code-review/reviews`. Si la ruta indicada no existe o no es un
directorio, el visor **no crea nada** y **no cae** a otra ruta: lo dice y termina
con código distinto de cero.

Si la carpeta seleccionada contiene una corrida completa (cualquiera de
`cierre.json`, `review.json`, `informe.md` o `trazabilidad.jsonl`), se usa tal
cual. Si contiene una subcarpeta real `reviews/`, se usa esa. En cualquier otro
caso, la carpeta es la raíz del archivo. La dirección resuelta se muestra al
arrancar.

## Acceso y sesión

El servidor escucha **sólo en 127.0.0.1**. Al arrancar genera una URL con un token
de capacidad en el **fragmento**:

```text
http://127.0.0.1:8765/#token=…
```

La aplicación canjea ese token por una cookie de sesión `HttpOnly` y borra el
fragmento del historial. Las peticiones de API y el flujo en vivo usan esa cookie;
el token no se guarda en `localStorage` ni aparece en la ruta.

Sin sesión, las rutas privadas responden `403`. También se rechazan un `Host`
ajeno, un `Origin` externo y las peticiones marcadas como de otro sitio.

La interfaz no usa Node, CDN, fuentes remotas ni un framework en tiempo de
ejecución: todos sus recursos viajan dentro del paquete y se sirven con una
política `Content-Security-Policy` que no admite scripts ni estilos en línea.

## Qué muestra cada vista

La revisión seleccionada tiene siete vistas, en pestañas. Las flechas, `Inicio` y
`Fin` mueven el foco entre ellas; `Enter` o `Espacio` activan. Cambiar de pestaña
pausa la reproducción y el revelado.

- **Resumen** — identidad y alcance, responsable (distinto de los autores del
  cambio), veredicto de la fuente, cobertura ABCDE, estado del archivo y
  limpieza. Los campos originales quedan en detalles desplegables.
- **Hallazgos** — confirmados, no resueltos, candidatos y descartados por
  separado, con filtros locales y conteo. El recuento por prioridad incluye sólo
  confirmados. Prioridad y estado conservan el valor original.
- **Validación** — comprobaciones con su estado, revisión real, motivo de
  reutilización y clase de fallo. Los comandos se muestran como texto inerte; el
  visor no ejecuta comprobaciones. Sin comprobaciones se dice que no hay
  comprobaciones; nunca se muestra como un aprobado.
- **Seguimiento** — linaje declarado, aliases e historia de re-revisiones. Las
  revisiones anteriores resueltas se abren de forma explícita.
- **Documentos** — informe Markdown y archivos acotados, con vista previa local.
  La ausencia de informe se distingue de un inventario vacío y de una lectura
  fallida.
- **Trazabilidad** — explorador de hitos con actores, línea de tiempo, tarjetas,
  inspector, relaciones, evidencia y En Vivo (ver más abajo).
- **Archivo** — cierre, limpieza y residuos, diagnósticos agrupados por
  gravedad y resultado de integridad por archivo, a petición explícita.

La cabecera de la revisión muestra título, repositorio, ID copiable, referencia,
estado del cierre, veredicto y los conteos existentes. Integridad, cierre,
veredicto y resultado de las comprobaciones son conceptos separados: no hay
puntuación de calidad ni porcentaje de ejecución.

## Última actividad frente a estado de la fuente

Son dos cosas distintas y el visor las mantiene separadas:

- **El estado de la fuente** es lo que el productor escribió: `prepared`,
  `processing`, `retaining`, `closing` o `complete`. `processing` significa
  **trabajo iniciado**, no que haya un proceso vivo ahora mismo.
- **La última actividad del visor** es el momento en que el visor detectó un
  cambio de archivo. Se muestra por separado y caduca a los 120 segundos.

Un estado `processing` inicial, o un `updated_at` por sí solo, **no** demuestran
actividad reciente: la actividad se infiere de un cambio observado.

## Trazas parciales

Una corrida en curso puede tener cierre y traza sin registro final ni informe.
El visor la muestra con lo que hay y con un diagnóstico; no inventa un informe ni
presenta una traza incompleta como verificada. Cuando el productor está a mitad de
una transacción (`pending_trace`), el visor **espera**: conserva la última
instanteánea coherente y la marca como «en actualización». No consume ni recupera
esa intención.

## Tiempos: observado frente a registrado

Cada hito muestra el tiempo declarado y de dónde salió:

Los tiempos utilizables se presentan en la zona horaria del navegador. El detalle
al pasar sobre el tiempo conserva el instante UTC y el valor original. El orden
temporal compara los instantes efectivos: ocurrencia cuando está disponible,
registro como respaldo y secuencia para eventos sin tiempo.

- **ocurrencia observada**: una fuente real entregó ese instante.
- **respaldo de registro**: no hay ocurrencia; se usa la hora de grabación.
- **respaldo de secuencia**: no hay ningún tiempo utilizable.

El visor **no fabrica** una hora de ocurrencia a partir del relato, del registro
ni del reloj actual, y **no resta** dos horas de registro para presentar un
"tiempo de ejecución". La mezcla de fuentes y bases distintas no establece un
orden global entre agentes: por eso el orden de grabación y el orden temporal se
muestran por separado.

## Integridad frente a veredicto

Son dos comprobaciones independientes:

- El **veredicto** es lo que escribió el productor. El visor lo muestra tal cual.
- La **integridad** comprueba los hechos declarados: marcador de propiedad,
  disposición, estados admitidos, inventario y hashes, y cadena de la traza.

Un hash que no coincide significa que el archivo cambió. **No significa** que el
veredicto del código sea falso, y el visor nunca recalcula el veredicto a partir
de los conteos de la interfaz. Tampoco hay reparación: el visor no reemplaza un
hash por el calculado ni escribe en el archivo.

Un cierre sin `schema_version` puede tener hashes válidos por archivo y aun así
queda con estado **limitado**: los bytes se pueden verificar aunque la identidad
del conjunto no.

En la pestaña **Archivo**, «Verificar integridad» muestra cada comprobación por
separado. Si el productor cambia los marcadores durante esa lectura, el resultado
queda «en actualización» y se espera una versión coherente. El JSON original
permanece consultable, incluidos los campos desconocidos.

## Biblioteca y filtros

La biblioteca es una lista de selección paginada, agrupada por repositorio. Cada
fila muestra un título compacto (número de MR/PR cuando la referencia tiene una
forma reconocible, o la referencia o el alcance declarados), estado y fecha. Si
dos filas comparten etiqueta se añade el ID de la revisión o un fragmento de su
clave para distinguirlas. Por debajo de 800 px de ancho la biblioteca es una
superficie desplegable con retorno a la revisión.

La búsqueda se aplica con `Enter` o tras 250 ms sin escribir. El selector
«Todas»/«Abiertas» y el botón de filtros completan la barra. Los filtros
avanzados son borradores hasta pulsar «Aplicar», y los aplicados aparecen como
chips que se pueden quitar, junto con «Limpiar». Los filtros se aplican al
servidor y vuelven a la primera página. Se pueden combinar repositorio, modo,
referencia, tipo, perfil, veredicto, fecha de creación y estado
(todas/abiertas/cerradas). Las sugerencias de valores proceden de la página
actual y se rotulan como tales: no son un inventario global. La lista, su
detalle, la cabecera y el Resumen muestran el repositorio tal como se declaró;
la agrupación y el filtro de repositorio usan su identidad normalizada (sin
esquema ni `.git`), que es el valor que sugiere el filtro, rotulado con la forma
declarada. Las fechas Desde/Hasta son inclusivas y usan el día declarado en la
creación de la fuente; una fecha desconocida no coincide con un filtro de
fechas. Cada página contiene hasta 50 corridas y se muestra el total filtrado.

Si una recarga falla, la lista anterior se conserva con un aviso de que no está
actualizada; no se aparenta que las revisiones desaparecieron. Cambiar un filtro
no cambia la revisión seleccionada aunque su fila deje de coincidir.

## Seguimiento de la fuente

La primera observación no demuestra actividad reciente. «Último registro» viene
del productor; «Último cambio detectado por el visor» es la hora en que el visor
observó un cambio posterior. El estado de conexión del seguimiento se muestra
aparte del estado de la corrida. Las interrupciones sólo se indican si existe un
hito explícito y dejan de ser actuales al observar trabajo posterior.

Los avisos SSE recargan la revisión seleccionada al aparecer el registro final,
sin restablecer la pestaña ni el cursor pausado. El contador de la reproducción
cuenta IDs nuevos de la traza, no avisos de red. Seguimiento conserva títulos,
IDs históricos, aliases y referencias anteriores.

## Dirección local

Tras canjear el token, el visor refleja en la barra de direcciones la revisión,
la pestaña y el hito seleccionados:

```text
http://127.0.0.1:8765/?run=<clave>&tab=<pestaña>&event=<ID>
```

- `run` es la clave opaca de la revisión (32 caracteres hexadecimales).
- `tab` es una de `ficha` (Resumen), `hallazgos`, `validacion`, `seguimiento`,
  `documentos`, `trazabilidad` o `archivo`.
- `event` es un ID de hito con la forma `E000001`; sin pestaña se abre en
  Trazabilidad.

Sólo se aceptan esas tres claves y esos formatos. La dirección nunca lleva rutas,
el token, contenido ni filtros. Un hito inexistente produce un aviso y se
selecciona uno válido; no se busca otra revisión por parecido. Atrás y Adelante
restauran la selección y la vista sin iniciar la reproducción. El token de
arranque sigue estando sólo en el fragmento y se elimina al canjearlo.

## Preferencias

Tres preferencias se guardan en este navegador (`localStorage`), y sólo ellas:

- **Tema** (selector de la cabecera): sistema, claro u oscuro.
- **Densidad** (diálogo «Preferencias»): cómoda o compacta. Cambia el espaciado,
  no el tamaño mínimo de los objetivos interactivos.
- **Movimiento** (diálogo «Preferencias»): «Según el sistema» o «Reducido».

Filtros, selección, rutas, token y datos del archivo no se guardan; viven en
memoria o en la dirección local descrita arriba.

## Explorador de trazabilidad

La pestaña **Trazabilidad** presenta los hitos aceptados del archivo. Al abrirla,
la reproducción está pausada y se selecciona el último hito, salvo que la
dirección indique otro.

- **Actores.** Una franja superior lista los participantes por orden de primera
  aparición, deduplicados por su identidad declarada (tipo, nombre e ID de
  proveedor). Muestra ocho accesos por ventana y «Ver todos los actores» abre una
  lista paginada de 50. Elegir un actor selecciona su primer hito entre los
  resultados actuales y pausa; no filtra ni reordena las tarjetas. Un hito sin
  identidad declarada aparece como «Actor no declarado».
- **Línea de tiempo.** Es global y sigue el orden de `sequence`. Hasta 50 hitos se
  muestran como marcadores individuales; con más, en ventanas consecutivas de 50
  con anterior/siguiente, rango visible y deslizador. La forma del marcador
  indica la base temporal (círculo: ocurrencia observada; rombo: respaldo de
  registro; hueco: sin hora). La separación entre marcadores son pasos de
  secuencia, no duraciones.
- **Controles.** «Reiniciar», «Evento anterior», «Reproducir»/«Pausar», «Evento
  siguiente», «Ir al último», velocidad 0.5×/1×/2×/4× y un deslizador de
  posición. «Reiniciar» muestra sólo el primer hito y «Reproducir» incorpora los
  siguientes. La búsqueda recorre el modelo completo (actor, ID, tipo, estado y
  resumen).
- **Tarjetas.** Una lista lineal de hasta 50 tarjetas por página, en orden de
  secuencia, con metadata breve, resumen, estado original y acciones de
  relaciones, evidencia y «Copiar resumen». Seleccionar una tarjeta, un marcador
  o un actor converge en el mismo ID y en el mismo inspector, sin mover el foco a
  él. «Seguir recorrido» desplaza sólo el panel de tarjetas y se suspende al
  desplazar, al seleccionar manualmente o al interactuar con el inspector (foco,
  puntero o desplegar una sección); un botón lo retoma.
- **Inspector.** Muestra el hito completo: tiempos con hora local, UTC y valor
  original; actor, registrador y ejecutor por separado; procedencia, autoridad,
  relaciones y evidencia; y el JSON original desplegable, con los campos
  desconocidos. Los botones de copia usan los valores completos.
- **Relaciones.** Se muestran las declaradas, con tipo, destino y la resolución
  del backend. Sólo las `resolved` con destino dentro de la raíz navegan: los
  destinos locales abren el hito, hallazgo o comprobación, y los de otras
  revisiones abren esa revisión con una acción explícita. Las `dangling`,
  `unresolved`, `ambiguous` y `unavailable` conservan su valor y su explicación.
  El visor no infiere vínculos por proximidad ni resuelve nada fuera de la raíz.
- **Evidencia.** Sólo se enlaza una referencia que coincida exactamente, por
  `relative_path`, con un archivo del inventario local de la revisión; su vista
  previa se pide con claves opacas. Las rutas absolutas, `..`, las URL y las
  referencias no resueltas se muestran como texto inerte con un diagnóstico.
- **Revelado.** En reproducción guiada, cada tarjeta se presenta a 1× durante
  1800 ms en cuatro etapas solapadas (estructura, cabecera, contenido y
  acciones), con 550 ms entre elementos; la velocidad divide ambas duraciones.
  Son decisiones de diseño, no tiempos de ejecución del productor. Sólo se
  revela una tarjeta a la vez y «Mostrar tarjeta completa» termina el efecto.
  El inspector y el modelo están completos desde el inicio, y copiar o buscar
  nunca usan una versión parcial. Abrir un diálogo, cambiar de pestaña o de
  revisión, u ocultar la página, pausa la presentación; no se reanuda sola.

## En Vivo

El botón **En Vivo** sólo está disponible cuando el cierre de la revisión
seleccionada declara `processing`, tras una lectura coherente. No lo habilitan la
conexión, tener la revisión abierta ni un cambio reciente. Con otro estado
(`prepared`, `retaining`, `closing`, `complete`), con un cierre ausente o
ilegible y con un valor desconocido queda deshabilitado, con el motivo a la
vista.

Mientras el cierre sea `processing`, el último hito por secuencia lleva el
indicador «Último hito activo · revisión en procesamiento», aunque haya otro
seleccionado; el marcador correspondiente de la línea de tiempo lo repite. Es un
estado de la revisión, no prueba que un agente esté ejecutando algo en ese
momento. Si todavía no hay hitos se muestra «Esperando el primer registro», sin
tarjetas ni actores.

- Al activarlo se selecciona el último hito y se sigue el recorrido. Cada hito
  nuevo se añade al final y se presenta con el revelado; en una ráfaga sólo se
  anima el más reciente y los anteriores aparecen completos.
- Al **pausar**, la recepción continúa: los IDs nuevos se acumulan en «N nuevos
  sin presentar». Interactuar con el inspector (por ejemplo, abrir el JSON
  original o enfocar un botón de copia), seleccionar un hito a mano o desactivar
  «Seguir recorrido» tiene el mismo efecto: el hito, el foco y el desplazamiento
  se conservan. «Mostrar nuevos» los incorpora sin desplazar ni reanudar, y
  «Reanudar En Vivo» (o «Seguir recorrido») reconoce la cola y vuelve al último
  hito.
- Si el cierre deja de ser `processing`, En Vivo se deshabilita, el indicador de
  carga cesa y el revelado en curso se completa. Los registros recibidos siguen
  disponibles y los pendientes se conservan hasta mostrarlos.
- Un archivo en transacción (`pending_trace`) o una lectura incoherente entre
  rutas se muestran como «Archivo en actualización»: se conserva el último modelo
  y se reintenta (hasta tres veces) antes de esperar otro aviso.
- Sin conexión o ante un error de lectura se conserva el último modelo con «Datos
  no actualizados», y el indicador pasa a un icono estático con «Último estado
  conocido: processing». Al reconectar se recarga antes de contar nuevos IDs.
- Modificar un hito con el mismo ID actualiza su presentación y muestra un
  diagnóstico; no cuenta como hito nuevo. Si el prefijo aceptado se acorta o
  cambia, se reemplaza el modelo, se pausa y se advierte.

En Vivo sólo lee: el visor no modifica el archivo para seguirlo.

## Límites

- 50 corridas por página en la biblioteca.
- 50 hitos por ventana de la línea de tiempo y 50 tarjetas por página; como
  máximo 50 tarjetas y 50 marcadores montados a la vez. Todos los hitos son
  alcanzables por ventana, deslizador o búsqueda.
- 8 accesos de actor por ventana y 50 actores por página en la lista completa.
- 10 000 eventos por traza: con más, el visor declara en un diagnóstico que se
  muestran los primeros 10 000. Una traza de más de 8 MiB no se interpreta y
  queda un diagnóstico de error en su lugar.
- «Copiar resumen» de cada tarjeta es una acción provisional: copia el resumen
  declarado del hito y no sustituye a los botones de copia del inspector.

## Atajos de teclado

- `Tab` recorre controles y revisiones; `Enter` o `Espacio` activa el control
  enfocado, incluido «Reproducir»/«Pausar».
- En las pestañas, las flechas, `Inicio` y `Fin` mueven el foco sin activar;
  `Enter` o `Espacio` activan.
- En el deslizador de posición, las flechas, `Inicio` y `Fin` cambian el hito.
- Los diálogos («Preferencias», «Contexto de raíz» y la lista de actores)
  contienen el foco, se cierran con `Escape` y devuelven el foco al control que
  los abrió.

Con movimiento reducido (preferencia «Reducido» o `prefers-reduced-motion` del
sistema) las tarjetas aparecen completas al instante, no hay brillos, pulsos ni
transiciones y el indicador de carga es un icono con etiqueta estática. No hay
reproducción automática, y los pasos manuales siguen disponibles; en reproducción
guiada la espera entre tarjetas es `2350 / velocidad` ms.
