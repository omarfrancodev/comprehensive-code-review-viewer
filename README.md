# Comprehensive Code Review Viewer

Visor web local de solo lectura para explorar revisiones de Comprehensive Code Review, consultar sus reportes y cierre, seguir hitos persistidos en vivo y reproducir su trazabilidad.

**Estado: especificación y plan publicados; aplicación pendiente de implementación.** Los comandos siguientes describen la interfaz prevista y todavía no son ejecutables.

El visor será independiente del agente y de la instalación de la skill. Tendrá servidor Python local e interfaz HTML/CSS/JavaScript, sin servicios externos.

## Handoff de implementación

1. Leer [AGENTS.md](AGENTS.md).
2. Leer la [especificación](docs/superpowers/specs/2026-10-09-review-viewer-design.md).
3. Ejecutar el [plan de implementación](docs/superpowers/plans/2026-10-09-review-viewer-implementation.md) en otra sesión, con las revisiones indicadas por Superpowers.
4. Conservar el alcance del visor; los cambios de la skill se realizan en su propio repositorio y sesión.

## Uso previsto

```text
ccr-viewer
ccr-viewer --root <directorio>
ccr-viewer --port 8765 --no-browser
python -m ccr_viewer --root <directorio>
```

La raíz predeterminada será `~/.comprehensive-code-review/reviews`; `CCR_ARTIFACTS_DIR` y `--root` permitirán seleccionarla explícitamente. También se aceptará su carpeta contenedora cuando tenga el subdirectorio `reviews/`.

La primera versión incluirá biblioteca, ficha de revisión, hallazgos, validación, Markdown, cierre/integridad, seguimiento en vivo y reproducción de eventos. La disponibilidad de cada vista dependerá de los artifacts existentes.

## Proyecto relacionado

La [skill Comprehensive Code Review](https://github.com/omarfrancodev/comprehensive-code-review) produce los artifacts. Este proyecto los consume por contratos versionados: sus releases y su instalación serán independientes.
