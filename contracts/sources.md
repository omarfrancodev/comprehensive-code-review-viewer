# Procedencia de los contratos del productor

Estos metadatos fijan, para el visor, la versión publicada del contrato que consume.
No se resuelve nada en tiempo de ejecución: el visor nunca importa la skill
instalada, no busca la ruta local de la instalación y no descarga contratos.

- Repositorio del productor: <https://github.com/omarfrancodev/comprehensive-code-review>
- Etiqueta fijada: `v2.9.0`
- Commit fijado: `7828852aaab390ebfeca78b229964f0b04af82d8`

Un cambio posterior del productor no se refleja aquí automáticamente. Actualizar
este archivo requiere volver a fijar la versión, actualizar
`compatibility.json` y ampliar las pruebas de conformidad con fixtures sintéticos.

## Grupos de referencia en la versión fijada

| Grupo | Contenido |
|---|---|
| `workflow/` | Área de revisión, re-review y decisiones de alcance |
| `execution/` | Ejecución, aislamiento y datos observados del ejecutor |
| `contracts/` | Registro final, identidades y formato del informe |
| `archive/` | Archivo persistente, cierre y traza del ciclo de vida |
| `reporting/` | Informe, entregas explícitas e handoff histórico |
| `maintenance/` | Mantenimiento y referencias auxiliares |

Estos grupos son ubicaciones de documentación del productor, no directorios de
artefactos ni dependencias de ejecución del visor.

## Rutas fuente fijadas

| Ruta | Qué aporta |
|---|---|
| `references/contracts/result-contract.md` | Esquemas 1–7 del registro final |
| `references/contracts/identifiers.md` | Identidad de revisión, hallazgo y comprobación |
| `references/archive/artifacts.md` | Esquemas 1–5 del archivo y del cierre |
| `references/archive/lifecycle-trace.md` | Traza de esquema 1, emisión y relaciones |
| `scripts/review_artifacts.py` | Bytes canónicos, marcador de propiedad y estados |
| `scripts/review_trace.py` | Algoritmo de digest, cadena y contrato de evento |
| `references/workflow/re-review.md` | Linaje de revisiones previas |
| `references/workflow/review-areas.md` | Matriz de áreas A–E |
| `references/reporting/report-format.md` | Presentación del informe |
| `references/reporting/delivery.md` | Entregas explícitas (fuera del alcance de v0.1) |
| `references/reporting/handoff.md` | Handoff histórico opcional |

## Contratos separados

- **Registro final**: esquemas 1–7. El esquema 7 es el vigente y su forma no cambia.
- **Archivo y cierre**: esquemas 1–5, más cierres históricos sin `schema_version`,
  que se muestran con compatibilidad `limited`.
- **Traza**: esquema 1, con conjunto de campos y algoritmo de hash sin cambios.

Son contratos independientes: un número de esquema por sí solo no demuestra
contenido válido, y la conformidad de uno no implica la de otro.

## Reglas que esta versión fija

- `processing` sólo es un estado válido del **esquema de archivo 5**. En los
  esquemas 1–4 es un valor inválido y produce un diagnóstico específico de versión.
- Un estado desconocido en una versión desconocida se conserva tal cual y obliga a
  compatibilidad `limited`.
- La regla de emisión de la traza (un destino local `E` debe existir antes) aplica a
  eventos nuevos del esquema de archivo 5; no invalida retroactivamente las cadenas
  históricas de traza de esquema 1, que se verifican igual que antes.
- Un cierre sin `schema_version` puede tener hashes válidos por archivo sin que la
  identidad y la propiedad del conjunto estén verificadas: el estado global queda
  `limited`.