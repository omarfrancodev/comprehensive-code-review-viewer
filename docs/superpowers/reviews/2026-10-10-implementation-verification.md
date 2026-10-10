# Verificación de implementación — 2026-10-10

Se retomó el worktree `.worktrees/visor-implementacion`, rama
`feat/visor-implementacion`, desde `6a5049430720d7c44b64866b02c2a1aa884f3c04`.
Las diez tareas del plan tenían commits, pero su integración conservaba brechas
que impedían considerar terminada la implementación. Se mantuvo la spec aprobada
y se completaron esas conexiones mediante ejecución inline y pruebas sintéticas.

## Revisión independiente y resolución

La revisión independiente examinó el estado previo sin editarlo. Sus hallazgos
se verificaron contra el código y se resolvieron como sigue; la evidencia de
corrección corresponde a las pruebas ejecutadas por el implementador.

| Hallazgo | Resolución y evidencia |
| --- | --- |
| Raíz catalogada sustituida por junction | No se vuelve a resolver una nueva raíz confiable. Se rechazan reparse points y ancestros, conservando aliases Windows 8.3. `test_access_regressions.py` y `test_paths.py`. |
| Cierre leído fuera del opener protegido | Integridad usa los bytes acotados de la instantánea y vuelve a comprobar la transacción tras el hashing. Prueba que prohíbe `Path.read_bytes` para cierre y prueba con escritura concurrente sintética. |
| Identidad POSIX y cierre doble del descriptor | Se distinguen identidad de raíz y de archivo; el recorrido posee un descriptor duplicado. Regresión de identidad y suite de acceso; ejecución POSIX real corresponde a CI en Ubuntu. |
| Traza fresca con cierre anterior | El endpoint interpreta cierre, review y traza de la misma instantánea; conserva el prefijo coherente durante `pending_trace`. |
| Resultado seleccionado obsoleto y respuestas tardías | SSE recarga detalle y biblioteca. Los identificadores de solicitud y generaciones descartan respuestas obsoletas, sin restablecer pestaña/cursor. Aceptación real preparada → discovery → final. |
| Filtros sin efecto y corridas posteriores a 50 inaccesibles | Las acciones vuelven a consultar la API; paginación anterior/siguiente. Se completaron modo, referencia, fecha y cerrado. Regresiones backend y navegador. |
| Autoplay sin repintado y controles incompletos | Reproducción publica cambios al renderizador; controles conservan el foco. Slider, flechas, Inicio, Fin, Espacio y retorno a vivo. Pruebas de reloj y navegador. |
| Orden temporal agrupado por base | Se comparan instantes efectivos entre bases; se conserva secuencia canónica. También se corrige orden de creación entre zonas horarias. |
| Tipos JSON inesperados rompen el catálogo | Conteos y listas verifican sus tipos; se conserva metadata original y se informa compatibilidad limitada. Un cierre que no es objeto tampoco interrumpe el endpoint de traza. |
| Seguimiento y Archivo ausentes | Siete pestañas conectadas; IDs/títulos históricos, aliases, enlaces anteriores, integridad explícita por archivo y JSON original. |
| Relaciones sin resolver en API | Resolución local y entre revisiones por identidad de origen única y existencia de E/F/C. Referencias ausentes/ambiguas quedan diagnosticadas; los ciclos se detectan con DFS iterativo sin alterar la cadena de hashes. |
| Fase, actividad y último registro desconectados | Fase deriva de hitos explícitos; primera observación no implica actividad. Interrupción y trabajo posterior se distinguen. Sondeo de metadata cada 2 s y descubrimiento cada 10 s. Hora del último cambio observado separada del registro. |
| Enlaces Markdown locales navegan fuera de la aplicación | Abren una preview por clave opaca y conservan la aplicación. Ningún enlace se ejecuta automáticamente. |
| Escape de HTML altera literales de código | Se escapan tokens HTML e imágenes mediante un Renderer completo; el código se conserva y DOMPurify usa una whitelist estricta. Regresión con `<div>` y `a&b`, junto con pruebas de contenido hostil. |
| Tiempos no muestran zona local y UTC | Elementos `time` muestran hora local, con UTC y dato original en el detalle. Prueba de navegador. |

Se añadieron comprobaciones de bytes de los marcadores antes/durante/después de
la instantánea, reanudación SSE con cursor fuera del buffer, limpieza de cachés
de corridas retiradas y estado de conexión separado. La ficha muestra versión,
harness y declaraciones originales de perfil/ejecutores/dependencias sin
convertirlas en hechos verificados.

## Validación

Se ejecutaron las suites completas tras las correcciones. Los comandos
usan Windows, Python 3.12.14 y Node 24.15.0; CI contiene matrices Ubuntu/Windows
con Python 3.10/3.12, frontend Node 22 y Chromium/Firefox.

- JavaScript: `node --test tests/js/*.test.mjs`, 45 pruebas aprobadas.
- Python: `python -m unittest discover -s tests -p test_*.py`, 264 pruebas aprobadas, sin omisiones en esta ejecución de Windows. Incluye creación real de junctions y comprobaciones de handles.
- Navegadores: `npm run test:browser`, 84 pruebas aprobadas entre Chromium y Firefox.
- Vendor: `node tools/vendor.mjs` seguido de `git diff --exit-code -- src/ccr_viewer/web/vendor`, sin diferencias.
- Git conserva los bytes originales de vendor mediante `.gitattributes`, evitando que `autocrlf` invalide los hashes al obtener el proyecto en Windows.
- Wheel: `python -m pip wheel . --no-deps --wheel-dir dist`, construida. La prueba de instalación crea un venv limpio, instala la wheel sin dependencias y arranca con `-I` fuera del checkout; no depende de `PYTHONPATH` ni del editable.
- Capturas inspeccionadas a 375/900/1440 px, claro y oscuro: controles y navegación visibles, sin desbordamiento horizontal. Los archivos generados quedan fuera de Git.
- Inmutabilidad: navegación, previews, referencias, seguimiento e integridad conservan tamaño, SHA-256 y mtime de fixtures. La transición real registra únicamente las escrituras explícitas del productor de prueba.

## Decisiones y límites

- Se reutilizó el worktree existente; no se creó otra implementación ni se modificó el productor o el repositorio de skills.
- Los fallos del sandbox al consultar handles Windows/crear junctions y lanzar navegadores se trataron como límites del entorno. Se ejecutaron esas pruebas fuera del sandbox con autorización automática, manteniendo las comprobaciones de seguridad.
- Las rutas 8.3 se expanden sin resolver junctions; las comparaciones del test de instalación resuelven aliases del entorno temporal. No se debilitaron garantías para acomodar diferencias de nombres de Windows.
- Una prueba antigua mezclaba «processing sin evidencia de fase» con un fixture que sí conserva discovery. Se separaron ambas afirmaciones; ninguna prueba declara un proceso vivo por el estado `processing`.
- El Markdown se valida con contenido público sintético; no se inspeccionaron ni copiaron revisiones reales. La compatibilidad se prueba contra contratos fijados, no constituye una certificación exhaustiva de todo artefacto del productor.
- La revisión independiente no ejecutó suites ni emitió una aprobación del estado corregido; las comprobaciones finales y CI son la evidencia de las correcciones.
- La wheel y el PR son resultados de desarrollo. La licencia permanece pendiente del propietario y la fusión/publicación requieren autorización específica. Se conserva el worktree para revisión.
