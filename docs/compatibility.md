# Compatibilidad con el productor

El visor consume los artefactos de **Comprehensive Code Review** por contratos
publicados y versionados. No importa la skill instalada, no busca su ruta local y
no descarga nada en tiempo de ejecución.

## Versión fijada

- Repositorio: <https://github.com/omarfrancodev/comprehensive-code-review>
- Etiqueta: `v2.9.0`
- Commit: `7828852aaab390ebfeca78b229964f0b04af82d8`

Las rutas fuente y los seis grupos de referencia se detallan en
[contracts/sources.md](../contracts/sources.md). Las capacidades por versión
vivem en [`compatibility.json`](../src/ccr_viewer/contracts/compatibility.json),
que se empaqueta con el visor.

Actualizar esta versión exige: fijar la nueva etiqueta, actualizar
`compatibility.json` y ampliar las pruebas de conformidad con fixtures sintéticos.
No se hace de forma automática.

## Alcance probado

| Contrato | Soportado | Notas |
|---|---|---|
| Registro final | esquemas 1–7 | El esquema 7 es el vigente y su forma no cambia |
| Archivo y cierre | esquemas 1–5 | Más cierres históricos sin `schema_version` |
| Traza | esquema 1 | Conjunto de campos y algoritmo de hash sin cambios |

Son contratos **independientes**: que el número de esquema sea válido no demuestra
que el contenido lo sea, y la conformidad de uno no implica la de otro.

### Diferencias por generación del registro final

| Campo | Desde qué esquema |
|---|---|
| `presentation` | 4 |
| `change_authors` | 3 |
| `profile` | 1 (valores `economy`/`balanced`/`deep`) |
| `profile` con `extended` | 5 |
| `review_id`, `previous_reviews`, `grandfathered_ids`, `rereview` | 6 |
| `checks[].reference` | 6 |
| `coverage.areas` | 2 |

Los perfiles **no se normalizan**: `economy` de un esquema antiguo se muestra tal
cual, nunca como `focused`. Un perfil desconocido o una versión desconocida se
conservan y fuerzan compatibilidad `limited`.

### Estados del archivo

`prepared → processing → retaining → closing → complete`

`processing` es válido **sólo en el esquema de archivo 5**. En los esquemas 1–4 es
un valor inválido: el visor lo conserva y emite un diagnóstico específico de
versión en lugar de aceptarlo en silencio.

Un estado desconocido en una **versión desconocida** se conserva tal cual y
obliga a compatibilidad `limited`: el visor no descarta campos que no conoce.

### Cierres sin `schema_version`

Se muestran los campos disponibles, pero la identidad y la propiedad del conjunto
no se pueden verificar. El estado global queda `limited` aunque los hashes de cada
archivo sean válidos: bytes correctos no prueban que el conjunto sea el que dice
ser.

### Reglas de emisión de la traza

La regla del esquema de archivo 5 —un destino local `E000001` debe existir ya en
la traza verificada— se aplica a los **eventos nuevos**. La verificación
estructural de las cadenas históricas de traza de esquema 1 **no** se endurece
retroactivamente: una traza histórica con ocurrencia no nula y `provenance.source`
nulo sigue siendo válida, tal como se grabó.

Un destino de hallazgo o comprobación que no aparece en el registro final puede
haber sido un candidato descartado: es un diagnóstico de referencia, **no**
corrupción de la cadena de hashes. Tampoco se infiere causalidad por adyacencia
de grabación ni por textos parecidos.

## Contrato de la API local

El sobre de la API del visor es `{api_version: 1, data, diagnostics}` y es
independiente de la versión de esquema del productor: cambiar el productor no
cambia la forma de la respuesta del visor.

## Dependencias de navegador

| Recurso | Versión | Uso |
|---|---|---|
| marked | 18.1.0 | Análisis de Markdown GFM |
| DOMPurify | 3.4.16 | Depuración del HTML generado |

Se sirven desde copias locales en `src/ccr_viewer/web/vendor/`, con su SHA-256,
origen, versión y licencia en `manifest.json`. El visor **no** pide nada a una CDN
en tiempo de ejecución.

Para actualizarlas:

1. Cambiar la versión exacta en `package.json`.
2. `npm install` y `npm run vendor`.
3. Revisar el diff de `vendor/` y del inventario, incluidas las licencias.
4. Ejecutar las pruebas de Markdown antes de continuar.

El paso 3 es deliberado: un cambio de dependencia se documenta y se revisa, no se
acepta en silencio.

## Licencia del proyecto

Este proyecto **no tiene todavía una licencia decidida** por su propietario. No se
infiere ninguna del hecho de que el repositorio sea público. Publicar una
distribución exige decidirla antes. Las licencias de terceros que se empaquetan
(`vendor/LICENSE.*`) se conservan intactas.