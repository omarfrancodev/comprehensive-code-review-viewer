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

## Qué muestra cada vista

- **Ficha** — perfil, alcance, responsable (distinto de los autores del cambio),
  veredicto de la fuente, cobertura ABCDE, estado del archivo y limpieza.
- **Hallazgos** — confirmados, no resueltos, candidatos y descartados por
  separado. El recuento por prioridad incluye sólo confirmados.
- **Validación** — comprobaciones con su estado, revisión real, motivo de
  reutilización y clase de fallo. Sin comprobaciones se dice que no hay
  comprobaciones; nunca se muestra como un aprobado.
- **Seguimiento** y **Documentos** — linaje declarado e informe Markdown y
  archivos acotados.
- **Trazabilidad** — hitos con sus tiempos, procedencia y relaciones, con
  controles de reproducción.
- **Archivo** — resultado de integridad por archivo, a petición explícita.

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

## Biblioteca y seguimiento

Los filtros se aplican al servidor y vuelven a la primera página. Se pueden
combinar repositorio, modo, referencia, tipo, perfil, veredicto, fecha de creación
y estado abierto/cerrado (`true`/`false`). Las fechas Desde/Hasta son inclusivas
y usan el día declarado en la creación de la fuente; una fecha desconocida no
coincide con un filtro de fechas. Cada página contiene hasta 50 corridas.

La primera observación no demuestra actividad reciente. «Último registro» viene
del productor; «Último cambio detectado por el visor» es la hora en que el visor
observó un cambio posterior. El estado de conexión del seguimiento se muestra
aparte del estado de la corrida. Las interrupciones sólo se indican si existe un
hito explícito y dejan de ser actuales al observar trabajo posterior.

Los avisos SSE recargan la revisión seleccionada al aparecer el registro final,
sin restablecer la pestaña ni el cursor pausado. El contador de la reproducción
cuenta IDs nuevos de la traza, no avisos de red. Seguimiento conserva títulos,
IDs históricos, aliases y referencias anteriores.

## Atajos de teclado

- `Tab` recorre controles y revisiones; `Enter` o `Espacio` activa.
- En la reproducción: flechas para avanzar y retroceder, `Inicio` y `Fin` para
  los extremos.
- `Espacio` alterna la reproducción **sólo dentro de la región de controles**,
  para no interferir con campos de texto ni con otros botones.

Con `prefers-reduced-motion` activado no hay animación ni reproducción automática;
los pasos manuales siguen disponibles.
