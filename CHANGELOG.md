# Changelog

Los cambios publicados de este proyecto se registran por versión. El visor y la
skill productora tienen versiones independientes.

## Sin publicar

Rediseño de la interfaz del visor en la rama `feat/interfaz-premium`. No cambia
la versión del paquete, la API local ni las garantías de solo lectura, y no ha
sido fusionado ni publicado.

### Añadido

- Interfaz rediseñada: tokens visuales, tema del sistema/claro/oscuro, densidad
  cómoda o compacta y preferencia de movimiento reducido, guardadas solo en el
  navegador.
- Biblioteca compacta con búsqueda, selector Todas/Abiertas, filtros tipados con
  borradores, chips aplicados, total filtrado y paginación de 50.
- Cabecera de revisión con ID copiable y estados separados; vistas Resumen,
  Hallazgos, Validación, Seguimiento, Documentos y Archivo con presentación
  estructurada y JSON original desplegable.
- Navegación local `?run=<clave>&tab=<pestaña>&event=<ID>` con historial.
- Explorador de trazabilidad: franja de actores, línea de tiempo en ventanas de
  50, tarjetas en orden de secuencia, inspector, relaciones navegables y
  evidencia enlazada solo por inventario local.
- Reproducción pausada al abrir, revelado progresivo del elemento completo y
  «Mostrar tarjeta completa»; sin animaciones con movimiento reducido.
- En Vivo, disponible solo cuando el cierre declara `processing`, con indicador
  del último hito activo, cola «N nuevos sin presentar», lectura coherente de
  vista y traza con reintentos y estados «Archivo en actualización» y «Datos no
  actualizados».

### Cambiado

- La wheel instalada sirve los 42 recursos registrados en `STATIC_RESOURCES` con la
  política de contenido vigente, sin `unsafe-inline`; no declara dependencias de
  ejecución.
- La prueba de empaquetado construye la wheel desde una copia limpia de las
  fuentes, de modo que un `build/` obsoleto del checkout no la contamine.

### Validación y límites

- Ejecución local del 2026-10-11 en Windows con Python 3.14.3 y Node 24.15.0:
  267 pruebas Python, 414 JavaScript, 253 Chromium y 249 Firefox (4 omitidas por
  ser solo de Chromium). La matriz CI no formó parte de esa ejecución. El detalle
  está en
  [el informe de verificación](docs/superpowers/reviews/2026-10-10-interface-premium-verification.md).
- Mediciones de laboratorio en Chromium (p95 de 30 interacciones con 10 000
  eventos); no son una medición de INP de usuarios reales.
- Se acotan 50 tarjetas, 50 marcadores, 50 corridas por página y 10 000 eventos
  por traza.
- La reconexión nativa con `Last-Event-ID` no se ejercitó en un navegador, y el
  zoom del 400 % se aproximó con un ancho de 320 px.

## [0.1.0] - 2026-10-10

Primera versión del visor local de solo lectura para archivos de Comprehensive
Code Review.

### Añadido

- Servidor Python sin dependencias de ejecución, sesión local y acceso protegido
  a los archivos mediante handles y claves opacas.
- Biblioteca con búsqueda, filtros, agrupación por revisión y paginación.
- Siete vistas: ficha, hallazgos, validación, seguimiento, documentos,
  trazabilidad y archivo.
- Seguimiento por SSE de hitos persistidos, reproducción temporal y conservación
  de la pestaña y del cursor pausado al recibir nuevos registros.
- Markdown sanitizado, previews locales, acceso al JSON original y comprobación
  explícita de integridad por archivo.
- Compatibilidad con registros de revisión 1–7, archivos 1–5 y trazas 1;
  diagnóstico de versiones y datos desconocidos.
- Distribución como wheel y ejecución mediante `ccr-viewer` o
  `python -m ccr_viewer`, con Python 3.10 o posterior.
- Licencia MIT para el proyecto, conservando las licencias de recursos de terceros.

### Corregido durante la validación inicial

- Contención de rutas, sustitución por junctions, identidad de archivos POSIX y
  lectura coherente de cierres y trazas durante escrituras concurrentes.
- Actualización de la revisión seleccionada, descarte de respuestas obsoletas,
  filtros, paginación y repintado de reproducción.
- Resolución de relaciones declaradas, orden temporal entre bases distintas,
  campos JSON malformados y conservación de literales de código Markdown.
- Preservación de bytes de recursos vendor en checkouts Windows.

### Validación y límites

- 264 pruebas Python, 45 JavaScript y 84 Chromium/Firefox aprobadas localmente;
  matriz CI aprobada en Ubuntu/Windows, Python 3.10/3.12 y Node 22.
- Instalación de la wheel verificada en un entorno limpio fuera del checkout;
  fixtures públicos sintéticos e inmutabilidad de los archivos comprobada.
- Interfaz inicial funcional. Se conocen problemas de densidad, jerarquía visual
  y presentación de identificadores largos; la trazabilidad requiere un diseño
  de exploración más elaborado. Esta versión conserva la interfaz actual.
- No se certifica cada archivo real del productor; los campos no disponibles
  permanecen desconocidos y no se infieren ejecuciones, tiempos ni evidencias.

[0.1.0]: https://github.com/omarfrancodev/comprehensive-code-review-viewer/releases/tag/v0.1.0
