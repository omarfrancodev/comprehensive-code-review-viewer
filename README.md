# Comprehensive Code Review Viewer

Visor web local de **solo lectura** para explorar revisiones de Comprehensive
Code Review, consultar sus reportes y cierre, seguir hitos persistidos en vivo y
reproducir su trazabilidad.

El visor es independiente del agente y de la instalación de la skill: servidor
Python local, interfaz HTML/CSS/JavaScript, sin servicios externos. Nunca escribe,
repara ni renombra nada del archivo.

## Instalación y uso

```bash
python -m pip install .
ccr-viewer
```

También funciona como módulo, con el mismo punto de entrada:

```bash
python -m ccr_viewer
```

Si pip avisa que `ccr-viewer.exe` se instaló en un directorio que no está en
`PATH`, la instalación sí terminó. Puedes usar `python -m ccr_viewer` con el
mismo intérprete que usaste para instalar. Para disponer del comando directamente,
instala en un entorno virtual activado o añade a tu `PATH` el directorio `Scripts`
que indica pip; no es necesario modificar `PATH` para ejecutar el módulo.

La [release v0.1.0](https://github.com/omarfrancodev/comprehensive-code-review-viewer/releases/tag/v0.1.0)
incluye una wheel descargable. Desde el directorio donde la descargaste:

```bash
python -m pip install comprehensive_code_review_viewer-0.1.0-py3-none-any.whl
python -m ccr_viewer
```

Consulta [CHANGELOG.md](CHANGELOG.md) para conocer las capacidades y límites de
cada versión publicada.

Opciones: `--root PATH`, `--port N`, `--no-browser` y `--version`. La raíz se
selecciona con `--root`, luego `CCR_ARTIFACTS_DIR`, y por último
`~/.comprehensive-code-review/reviews`. Consulta [docs/usage.md](docs/usage.md).

La primera versión incluye biblioteca, ficha de revisión, hallazgos, validación,
Markdown, documentos, cierre e integridad, seguimiento en vivo y reproducción de
eventos. La disponibilidad de cada vista depende de los artefactos existentes: una
corrida en curso se muestra con lo que hay y con su diagnóstico, nunca inventando
lo que falta.

## Verificación

```bash
python -m pip install -e .
python -m unittest discover -s tests -p "test_*.py" -v
npm ci
node --test "tests/js/*.test.mjs"
npx playwright install chromium firefox
npm run test:browser
python -m pip wheel . --no-deps --wheel-dir dist
```

Todas las pruebas usan archivos **sintéticos y públicos**. No se copia contenido de
revisiones reales a este repositorio.

## Compatibilidad

Contratos fijados contra la skill publicada `v2.9.0`
(commit `7828852aaab390ebfeca78b229964f0b04af82d8`). Registros finales de esquema
1–7, archivos y cierres de esquema 1–5 (más cierres históricos sin versión), y
trazas de esquema 1. El detalle está en [docs/compatibility.md](docs/compatibility.md)
y en [contracts/sources.md](contracts/sources.md).

## Estado

La implementación cuenta con pruebas de backend, interfaz, navegador y
empaquetado. Las correcciones y la evidencia de la validación se documentan en
[el informe de implementación](docs/superpowers/reviews/2026-10-10-implementation-verification.md).
La versión 0.1.0 conserva la interfaz inicial. Hay mejoras pendientes de densidad,
jerarquía visual, presentación de identificadores largos y exploración de la
trazabilidad. La publicación actual permite probar esa base; el rediseño se
documenta y revisa por separado.

## Proyecto relacionado

La [skill Comprehensive Code Review](https://github.com/omarfrancodev/comprehensive-code-review)
produce los artefactos. Este proyecto los consume; sus releases y su instalación
son independientes.
