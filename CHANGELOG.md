# Changelog

Los cambios publicados de este proyecto se registran por versión. El visor y la
skill productora tienen versiones independientes.

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
