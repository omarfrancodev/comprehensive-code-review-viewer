# Investigación de interfaz para el visor — 2026-10-10

## Propósito y alcance

Se estudió cómo convertir la interfaz inicial en un espacio de revisión más
profesional, con prioridad en encontrar corridas y explorar hitos, procedencia,
relaciones y evidencias. Base: release `v0.1.0`, commit
`aca0a01839c581d975ba9df52939315e1387f50f`. Esta investigación propone decisiones;
no acredita un rediseño implementado ni resultados de pruebas de usabilidad.

El usuario aportó tres capturas de su instalación. Se observaron sus problemas
visuales sin abrir sus archivos de revisión, consultar servicios privados o
copiar las imágenes, rutas, nombres ni contenido real al repositorio. Los
ejemplos de la propuesta deben ser sintéticos, como `equipo/proyecto-demo`,
`MR #42`, `E000003`, `F002` y `C003`.

Se consultaron fuentes primarias de productos comparables y estándares. Se
distinguen observaciones del código, patrones de referencia y recomendaciones
propias. Las referencias no implican instalar esos productos o sus frameworks.

## Diagnóstico de la versión publicada

| Observación | Evidencia local | Consecuencia para el diseño |
| --- | --- | --- |
| Identidad y alcance extensos se repiten en encabezados de grupo y tarjetas | `web/library.js`, concatenación de `repository_identity` y `scope_label`, seguida de ambas etiquetas completas en cada botón | Dificulta distinguir corridas; exige título corto de presentación y acceso explícito al dato original |
| Tarjetas invaden el ancho del panel en las capturas | `web/styles.css`: grids descendientes sin contención uniforme y alcance destacado sin política para tokens extensos | Añadir casos de URLs, hashes y etiquetas sin espacios a la aceptación; no basta un fixture de nombres cortos |
| Una clase mezcla responsabilidades | `.revision` identifica el contenedor principal en `web/index.html` y los botones en `web/library.js`; CSS aplica grid, cursor y estilos de selección | Separar shell, fila de biblioteca y panel de detalle, con nombres y tokens propios |
| Diez campos de filtro preceden la lista | `renderLibrary()` muestra todos los campos como inputs, incluso booleanos/enums | Búsqueda visible, filtros rápidos y disclosure de filtros avanzados; controles que expliquen valores válidos |
| Estado de conexión consume una franja completa | `dibujarAvisos()` siempre muestra un párrafo de conexión | Estado compacto en la cabecera; avisos extensos solo ante situaciones que requieren atención |
| Trazabilidad imprime todos los metadatos de cada hito y luego una segunda lista de IDs | `web/lifecycle.js`, `filaEvento()` y `pintarCuerpo()` | Separar exploración de detalle, ofrecer una sola selección coherente y dejar la procedencia en el inspector |
| Elementos seleccionables no ofrecen contrato completo de teclado | Hitos con listener sobre `li`; pestañas sin recorrido de foco ni enlace completo tab/panel | Usar controles semánticos y patrones de interacción verificables |
| Archivo y seguimiento presentan JSON como vista principal | `web/views.js` imprime residuals y rereview en `pre` | Mostrar estado y elementos estructurados; conservar JSON como detalle secundario y fallback |
| Cambio de estado puede reconstruir superficies completas | `web/app.js` y renderizadores llaman `replaceChildren()` | Preservar foco, scroll, selección y borradores de filtros; limitar actualizaciones a las regiones afectadas |

Estas observaciones explican riesgos de diseño. No se reprodujo la biblioteca
privada del usuario para declarar una única causa de cada desbordamiento.

## Referencias y aplicación al proyecto

### 1. Exploración de trazas: resumen, selección e inspector

Grafana organiza su visor con búsqueda, minimapa, timeline y detalle del span
seleccionado. Permite filtrar elementos y acceder a información relacionada.
[Documentación oficial de Grafana](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/).

**Aplicación propuesta:** una línea temporal seleccionable, una lista compacta y
un inspector que compartan el mismo ID. La búsqueda resalta o filtra; un resultado
puede abrir sus relaciones y evidencias. La reducción de información repetida
es una decisión propia para esta biblioteca de artefactos.

**Límite:** no trasladar barras de duración, critical path o jerarquías de spans
sin disponer de esos datos. El archivo del visor contiene hitos puntuales, no una
instrumentación distribuida completa.

### 2. Diferenciar hitos de intervalos

OpenTelemetry distingue spans con inicio/fin de eventos que marcan un punto
singular. [Conceptos de trazas de OpenTelemetry](https://opentelemetry.io/docs/concepts/signals/traces/).

**Aplicación propuesta:** representar cada hito como marcador. Las bandas por
actor agrupan identidades declaradas; no prueban concurrencia, sesiones de agente
ni tiempo de ejecución. Mostrar ocurrencia, respaldo de registro y ausencia de
tiempo como condiciones distintas. Ninguna distancia entre marcas se transforma
en una duración de trabajo o en un porcentaje de avance.

### 3. Biblioteca densa con controles coherentes

Carbon documenta búsqueda, toolbar, filtros, expansión y paginación para tablas,
y recomienda espacio suficiente para sus datos.
[Guía de data table de Carbon](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines).

**Aplicación propuesta:** usar filas compactas con jerarquía estable para
repositorio, referencia, estado y fecha. La biblioteca lateral funciona como
lista de selección; en móvil se transforma en una vista de biblioteca completa.
Los filtros activos se muestran como chips eliminables. No añadir selección
masiva ni acciones de edición a un producto de solo lectura.

### 4. Relaciones que se pueden recorrer

El grafo de GitHub Actions muestra estado y dependencias y permite abrir el log
de un nodo. [Documentación del grafo de GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph).

**Aplicación propuesta:** relaciones locales del hito seleccionado con enlaces
a eventos, hallazgos y comprobaciones. La lista textual permanece disponible.
Un destino ambiguo o ausente conserva su referencia y diagnóstico; no genera un
enlace inventado. Un grafo pequeño puede mostrar vecinos declarados, evitando un
grafo global que oculte referencias o fabrique dependencias a partir del orden.

### 5. Pestañas con contrato de foco

WAI-ARIA APG documenta tablist/tab/tabpanel y navegación con flechas, Enter y
Espacio. [Patrón de pestañas del W3C](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

**Aplicación propuesta:** conservar las siete capacidades con navegación
adaptativa y etiquetas en español. Activación manual cuando cargar una vista
requiere una petición; foco estable durante SSE. El tab activo tiene una relación
identificable con su panel, y las superficies nuevas no convierten toda la
pantalla en una región viva.

### 6. Paneles ajustables sin depender del drag

APG describe el separador ajustable y su valor accesible. El propio documento
advierte que su revisión está pendiente; se toma como orientación y requiere
validación práctica. [Window splitter del W3C](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/).

WCAG 2.2 exige una alternativa de puntero sin arrastrar para funcionalidades
basadas en drag; teclado por sí solo no cubre esa exigencia.
[Dragging Movements del W3C](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

**Aplicación propuesta:** botones de anchura y presets para el panel, además de
teclado y drag opcional. Zoom de timeline con botones y rango explícito. Las
funciones principales funcionan con clics/taps y teclado, sin precisión de
puntero ni gestos obligatorios.

### 7. Reflow y contenido extenso

WCAG explica cómo conservar lectura y operación a 320 CSS px, con excepciones
para contenido que necesita dos dimensiones.
[Reflow del W3C](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

**Aplicación propuesta:** sidebar y inspector se convierten en vistas apiladas
en pantallas estrechas o zoom alto. Texto, diálogos y filtros no provocan scroll
horizontal de la página. Tablas técnicas y código pueden tener scroll local con
etiqueta y alternativa de ajuste de línea. El timeline cuenta con lista textual
equivalente y evita exigir una anchura mínima de escritorio.

### 8. Respuesta perceptible y rendimiento

web.dev considera buena una INP de hasta 200 ms.
[Documentación de INP](https://web.dev/articles/inp).

**Aplicación propuesta:** medir interacciones locales con datos sintéticos y
registrar hardware, navegador y condiciones. Fijar un objetivo de respuesta de
selección y filtros de 200 ms después de recibir los datos; no confundirlo con
un INP de campo certificado. Acotar filas y marcadores visibles, evitar renderizar
10 000 tarjetas y reservar dimensiones durante carga. SSE actualiza contenido
sin reconstruir formularios, foco o todos los paneles.

## Alternativas evaluadas

| Alternativa | Valor | Coste y límite |
| --- | --- | --- |
| Espacio de revisión compacto con explorador de trazabilidad | Prioriza localizar una corrida y recorrer sus pruebas conservando contexto | Requiere estado de navegación explícito, render incremental y pruebas de interacción; recomendada para el problema observado |
| Dashboard centrado en resumen y tarjetas | Facilita una visión inicial de resultado y estados | Las tarjetas grandes y métricas no resuelven por sí solas la exploración de hitos; los indicadores deben ser conteos reales y con alcance claro |
| React y biblioteca de componentes | Ofrece primitivas y modelos de composición reutilizables | Añade build, dependencias, actualización de inventarios y migración; no soluciona automáticamente la arquitectura de información ni justifica mezclar ese cambio con una mejora visual |

La recomendación es mantener servidor, APIs, seguridad y distribución existentes,
con HTML/CSS/JavaScript modular y SVG local. Elegir un framework solo si una
decisión posterior demuestra un beneficio que compense la migración. No usar
CDN, telemetría externa, fuentes remotas ni servicios nuevos.

## Dirección visual propuesta

«Premium» se define aquí como jerarquía clara, componentes consistentes,
interacciones predecibles y buena lectura con contenido difícil. Las decisiones
siguientes son propuestas propias que se deben revisar visualmente:

- Superficies grafito en oscuro y gris neutro en claro; acento índigo reservado
  a selección, foco y acciones. Estados semánticos incluyen texto e icono.
- Tipografía de sistema para información y monospace para IDs, hashes, rutas y
  comandos. Cifras tabulares; títulos compactos y detalles con lectura cómoda.
- Escala de espacios 4/8/12/16/24/32 px, radios 6/10/14 px y elevación discreta
  para overlays. Bordes y capas comunican estructura sin enmarcar cada campo.
- Cabecera compacta con contexto de revisión y estado de conexión. La raíz
  completa pertenece al detalle de configuración, no a la primera línea visual.
- Densidad cómoda/compacta, foco visible y objetivos táctiles amplios. Reducir
  movimiento conserva feedback y selección sin autoplay visual decorativo.
- Estados de carga, vacío, ausencia de evidencia, incompatibilidad y fallo con
  explicación y recuperación. `[]` no es el mensaje principal de un estado vacío.

Se aplicaron las guías de accesibilidad, contenido y jerarquía disponibles en
`ui-ux-pro-max`. Su instalación local contiene archivos de referencia a `scripts`
y `data`, pero el buscador `search.py` y el destino de esas referencias no existen.
No se ejecutó ni se inventó una salida de `--design-system`; las recomendaciones
se construyeron con las fuentes primarias y el código del proyecto.

## Criterios que debe fijar la spec

1. Biblioteca con identificadores largos, duplicados visuales, 1000 corridas y
   filtros que explican qué alcance se está mostrando.
2. Timeline útil con 0, 1 y 10 000 hitos; tiempos coincidentes, ausentes, fuera de
   orden y con distintas bases; selección por ID estable.
3. Relaciones ausentes, ciclos, destinos históricos y referencias entre
   revisiones, sin navegación automática fuera de la raíz seleccionada.
4. Pausa y seguimiento en vivo con actualización coherente, inspector estable,
   contadores de eventos nuevos reales y foco preservado.
5. Conservación de veredicto, IDs, campos desconocidos, JSON original y diferencia
   entre integridad, resultado de checks y estado del productor.
6. Teclado, puntero sin drag, reduced motion, ambos temas, 320/375/768/1024/1440/
   1920 CSS px y zoom 200/400%; prueba de componentes, no solo de la página.
7. Evidencia visual revisable y regresiones con URLs sintéticas largas, metadata
   malformada y Markdown hostil; no aprobar únicamente porque los tests pasan.
8. Navegación y consultas conservan SHA-256, tamaño y mtime de los fixtures.

## Estado del handoff

Investigación completada. El usuario seleccionó el espacio de revisión compacto
con explorador de trazabilidad y aprobó la distribución general de la maqueta.
Solicitó más animaciones para la reproducción y después pidió conservar el
explorador actual mientras se preparan otras dos formas de presentar la
trazabilidad. El comparador A/B/C y sus diferencias se documentan en
[Alternativas de trazabilidad](2026-10-10-trace-alternatives.md).
El usuario pidió combinar B y C y después precisó: actores en la franja superior,
tarjetas en orden lineal y streaming de todo el elemento, no solo del texto.
En Vivo solo debe estar disponible con `cierre.state = processing`, con un estilo
de carga en el último hito recibido mientras la revisión conserve ese estado.
La propuesta resultante se documenta en
[Híbrida con streaming](2026-10-10-trace-hybrid-streaming.md).
El usuario aprobó la versión corregida de D. Sus decisiones se incorporaron a la
[spec de interfaz premium](../specs/2026-10-10-interface-premium-design.md),
que espera revisión escrita antes de elaborar el plan.
No se ha modificado código de producto en este worktree.

## Ampliación: reproducción con movimiento guiado

La solicitud de más animaciones se traduce en movimiento que ayuda a localizar
el cambio de selección. La maqueta añade un cursor sincronizado entre carriles,
un pulso finito al llegar al hito, un indicador de posición en el recorrido,
un deslizador de pasos y una transición breve del inspector. El cursor recorre
posiciones de presentación; no representa un proceso activo ni una duración
observada. El indicador de pasos no mide el porcentaje de ejecución de la
revisión. No se añaden flechas de dependencia a partir de la secuencia.

El patrón recomendado es: transiciones de selección de 180 ms, desplazamiento
del cursor de hasta 420 ms y pulso único de hasta 560 ms, acortando el
desplazamiento cuando sube la velocidad. Estos valores son decisiones de diseño
propuestas, no resultados de un estudio de usuarios. La reproducción empieza
solo por una acción explícita y ofrece pausa, reinicio, pasos y velocidad.
La interacción con el inspector pausa el recorrido para permitir leerlo;
cambiar de pestaña u ocultar la página también lo pausa.

El [criterio WCAG 2.3.3 de W3C](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
trata la posibilidad de desactivar movimiento no esencial iniciado mediante
interacciones. Es un criterio de nivel AAA; incorporarlo aquí no equivale a
certificar cumplimiento general. La maqueta respeta la preferencia del sistema
y ofrece además un selector para quitar animaciones. El modo reducido conserva
la selección, los textos y el avance discreto de los hitos.

La [guía de animaciones de web.dev](https://web.dev/articles/animations-guide)
recomienda `transform` y `opacity` para evitar trabajo de layout y pintura
durante el movimiento. Se usan transformaciones para cursor, indicador y
transición del inspector. Los controles y marcadores permanecen en el DOM entre
pasos para que la reproducción no retire el foco del botón utilizado.
La preferencia se consulta con
[`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
y se actualiza si el sistema la cambia durante la sesión.

La comprobación local de esta maqueta usó Chromium y datos sintéticos: avance,
pausa, foco del control, modo reducido explícito y del sistema, ausencia de
errores de JavaScript y ausencia de desbordamiento horizontal a 375/768 CSS px.
Se inspeccionaron capturas de escritorio y móvil. Esta evidencia solo corresponde
a la maqueta; no demuestra que el producto v0.1.0 implemente estas interacciones.
