# Interfaz premium y explorador de trazabilidad — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el visor v0.1.0 con shell compacto, biblioteca filtrable, siete vistas consistentes y un explorador de trazabilidad (actores, timeline, tarjetas con revelado progresivo, inspector, relaciones y En Vivo gobernado por `closure.state === 'processing'`).

**Architecture:** Se conserva Python con servidor local y frontend ESM sin framework. Los datos se derivan en módulos puros sin DOM (modelo de traza, presentador, lectura coherente) y una capa DOM delgada los pinta con render acotado (≤50 tarjetas, ≤50 marcadores). El backend no cambia contratos ni rutas; solo se amplía la lista finita `STATIC_RESOURCES`.

**Tech Stack:** Python ≥3.10 sin dependencias de ejecución; HTML/CSS/JavaScript ESM y SVG locales; `node --test` para unidades; Playwright 1.64.0 (Chromium y Firefox) para navegador; `unittest` para backend y empaquetado.

**Spec:** [`docs/superpowers/specs/2026-10-10-interface-premium-design.md`](../specs/2026-10-10-interface-premium-design.md). Maqueta de composición aprobada: [`2026-10-10-trace-hybrid.html`](../mockups/2026-10-10-trace-hybrid.html). Diseño original (garantías vigentes): [`2026-10-09-review-viewer-design.md`](../specs/2026-10-09-review-viewer-design.md). Las referencias `§N` de este plan son secciones de la spec premium.

## Global Constraints

Se aplican implícitamente a cada tarea.

- **Solo lectura (§2, AGENTS.md):** abrir, reproducir, seguir y validar no modifican bytes, SHA256, tamaños ni mtimes de archivos de revisión. No se ejecutan scripts, no se invocan agentes, no se consulta evidencia remota ni se reconstruyen identidades o tiempos ausentes.
- **Sin dependencias nuevas (§2):** sin framework, servicio de IA, chat generado, telemetría, CDN, fuentes remotas ni dependencia de runtime. `pyproject.toml` conserva `dependencies = []`.
- **CSP vigente (§10):** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Prohibido `unsafe-inline`, `<style>`/`<script>` inline, atributo `style="…"` en markup y `setAttribute("style", …)`. Las propiedades CSS dinámicas se escriben con `element.style.setProperty(...)` (CSSOM, permitido).
- **Recursos estáticos (§10):** cada archivo nuevo/eliminado bajo `src/ccr_viewer/web/` se refleja en el mismo commit en `STATIC_RESOURCES` de `server.py` y en la lista de `tests/test_packaging.py`. `package-data` ya cubre `web/*.js`, `web/*.css`, `web/*.html`, `web/vendor/*`; no se crean carpetas nuevas.
- **Texto no confiable:** todo valor de archivo se escribe con `textContent`/`elemento()`; ningún HTML de archivo se interpreta salvo Markdown vía el sanitizador existente.
- **localStorage (§10):** solo tema, densidad y preferencia de movimiento (una clave, `ccr-viewer:prefs`). Filtros, selección, datos, IDs, rutas y token nunca se guardan; lectura/escritura siempre dentro de `try/catch`.
- **URL local (§5):** únicamente `?run=<clave-opaca>&tab=<clave>&event=<id>`; sin rutas, tokens, contenido ni filtros. El token solo vive en el fragmento y se elimina tras canjearlo.
- **Visual (§3):** espaciado 4/8/12/16/24/32 px; radios 6/10/14 px; texto de lectura 14–16 px, metadata 12–13 px; objetivos ≥24×24 CSS px (44 px en táctil); contraste texto ≥4.5:1 y controles/foco ≥3:1; sin scroll horizontal de página. Breakpoints: ≥1200 px biblioteca 280–320 px + contenido + inspector 300–340 px; 800–1199 px biblioteca 240 px e inspector debajo; <800 px una columna con biblioteca desplegable.
- **Escala (§6.4):** páginas y ventanas de 50; actores 8 accesos por ventana y lista paginada de 50; `getRuns` con `limit=50`.
- **Tiempos de presentación (§7, §8):** 1800 ms de revelado + 550 ms de separación a 1× (paso = **2350 ms**); etapas estructura 0–22 %, cabecera 18–42 %, contenido 36–72 %, acciones 68–100 %; velocidades 0.5×/1×/2×/4×; movimiento reducido: espera `2350 / velocidad` ms; cursor del timeline ≤420 ms, inspector 160–180 ms, pulso de llegada ≤560 ms; agrupar avisos 100 ms; reintentos de lectura coherente 250/500/1000 ms (máximo tres); búsqueda de biblioteca 250 ms o Enter.
- **Idioma y Git:** UI y comentarios en español. Commits Conventional Commits en español (`feat(visor): …`). Identidad local `omarfrancodev` / `fofe2803@gmail.com`; no tocar la configuración global. Nunca commitear worktrees, artefactos privados, fixtures reales, `node_modules`, `test-results`.
- **Pruebas honestas:** datos sintéticos públicos; no se afirma un criterio cumplido sin la evidencia de su comando. No se modifica el repositorio de la skill productora.

## Review Focus

Entradas que la spec implica pero ninguna tarea cubriría por sí sola; cada una tiene su prueba en la tarea indicada.

1. **Sesión caducada a mitad de uso** (API devuelve `403 session_required` en una recarga en vivo): mensaje «relanza el visor local», sin bucle de reintentos ni tokens recuperados. → Tarea 12, `live-ui.spec.mjs › sesión caducada`.
2. **Títulos idénticos, URLs/IDs gigantes sin espacios y 1000 corridas:** filas distinguibles, sin desbordar. → Tarea 3, `library.spec.mjs › URL larga sin espacios`, `› etiquetas coincidentes`.
3. **El hito seleccionado desaparece o el prefijo aceptado se acorta tras una recarga:** aviso, último disponible, nunca un hito inválido ni unión obsoleta. → Tareas 6 y 7 (`reconcileTrace`, presentador L-13) y 12.
4. **El cierre deja de ser `processing` en mitad de un revelado con cola pendiente:** el revelado se completa, En Vivo se deshabilita, la cola se conserva y no hay autoplay. → Tarea 7 (L-14) y 12.
5. **`localStorage` bloqueado o lanza (ventana privada) y violaciones CSP al animar:** la página arranca con valores por defecto y la animación no emite `securitypolicyviolation`. → Tarea 1 (`prefs.test.mjs`), Tarea 2 (`shell.spec.mjs › localStorage bloqueado`) y Tarea 10 (`› sin violaciones CSP`).

## Decisiones de interpretación (confirmar al revisar)

La spec deja estos puntos abiertos; el plan fija lo siguiente y cada uno se corrige en una sola tarea si lo cambias.

1. **Rama:** el trabajo continúa en este worktree en una rama nueva `feat/interfaz-premium` creada desde `docs/interfaz-premium` (la spec viaja con el PR).
2. **Prefijo presentado (§7):** tras «Reiniciar» solo se muestran las tarjetas hasta el cursor; seleccionar manualmente un hito posterior amplía lo presentado hasta él (completo, sin revelado). «Reproducir» en el último hito queda deshabilitado con su motivo; «Reiniciar» es la vía para volver a empezar.
3. **Un solo reloj (§10):** `createPlayback` conserva el reloj y pausa/reanuda con el tiempo restante; el presentador solo deriva revelado y cola de ese reloj. `PASO_BASE_MS = 2350` sustituye a `INTERVALO_BASE_MS = 800`.
4. **Historial (§5):** `pushState` al cambiar de revisión o pestaña; `replaceState` al cambiar de hito. `popstate` restaura selección y vista sin reproducir.
5. **Detalle de Hallazgos/Validación/Documentos:** maestro-detalle dentro del panel de contenido; el inspector lateral solo existe en Trazabilidad.
6. **Forma de `evidence` de un hito (la spec no la fija):** cada elemento es `string` (ruta candidata) u objeto con `path` o `relative_path`; cualquier otra forma se muestra como texto inerte con JSON secundario.
7. **Diálogos:** elemento nativo `<dialog>` con `showModal()` (foco contenido, Escape y retorno al invocador).
8. **Enums de filtros (§4):** `VERDICTS`, `PROFILES` y `KINDS` se declaran en `filters.js`; una prueba compara esas constantes con `src/ccr_viewer/contracts/compatibility.json` para evitar deriva. `mode`, `repository` y `reference` solo ofrecen sugerencias de la página actual, etiquetadas como tales.

## Estructura de archivos

Rutas relativas a `src/ccr_viewer/web/` salvo indicación.

| Archivo | Acción | Responsabilidad |
| --- | --- | --- |
| `prefs.js` | Crear | Preferencias locales (tema/densidad/movimiento) y movimiento efectivo |
| `present.js` | Crear | Títulos de revisión, etiquetas, tiempos, identidad de actor (puro) |
| `route.js` | Crear | Parseo/serialización de `?run&tab&event` |
| `filters.js` | Crear | Filtros aplicados/borradores, validación, chips, enums del contrato |
| `trace-model.js` | Crear | Modelo derivado de traza: orden, actores, búsqueda, ventanas, relaciones, diff por ID |
| `presenter.js` | Crear | Controlador de presentación: selección, revelado, En Vivo, cola, avisos |
| `live-sync.js` | Crear | Lectura coherente vista/traza/vista y coalescedor de recargas |
| `shell.js`, `icons.js` | Crear | Regiones, tabs manuales, diálogos, anunciador; iconos SVG construidos por DOM |
| `header.js`, `history.js`, `archive.js` | Crear | Cabecera de revisión, Seguimiento, Archivo |
| `explorer.js`, `actors.js`, `timeline.js`, `cards.js`, `inspector.js`, `relations.js`, `live-controls.js` | Crear | Explorador D |
| `tokens.css`, `explorer.css` | Crear | Tokens y estilos del explorador |
| `index.html`, `styles.css`, `app.js`, `store.js`, `library.js`, `profile.js`, `findings.js`, `validation.js`, `documents.js`, `views.js`, `playback.js` | Modificar | Según tarea |
| `lifecycle.js` | Eliminar (Tarea 9) | Sustituido por el explorador |
| `../server.py` | Modificar | `STATIC_RESOURCES` |
| `tests/js/*.test.mjs`, `tests/js/generators.mjs` | Crear/Modificar | Unidades y generadores sintéticos |
| `tests/browser/*.spec.mjs`, `tests/browser/support.mjs`, `tests/browser/server.mjs` | Crear/Modificar | Navegador |
| `tests/test_static_resources.py`, `tests/test_packaging.py` | Crear/Modificar | Inventario de recursos y wheel |

## Comandos de verificación

Todos los comandos Python usan el código del árbol de trabajo (ver Tarea 0).

```bash
export PYTHONPATH=src                                   # en PowerShell: $env:PYTHONPATH = "src"
python -m unittest discover -s tests -p "test_*.py"     # backend + empaquetado
node --test "tests/js/*.test.mjs"                       # unidades JS
npx playwright test --project=chromium                  # navegador (añadir firefox al cerrar tareas)
```

---

### Task 0: Entorno de pruebas fiel al árbol de trabajo

**Hallazgo:** en esta máquina `import ccr_viewer` resuelve a `site-packages` (una copia instalada), no a `src/`. El servidor que arrancan las pruebas de navegador (`python -m ccr_viewer`, `cwd` = raíz) sirve esa copia: sin esta tarea ninguna prueba ejercitaría el código modificado.

**Files:**
- Modify: `tests/browser/server.mjs` (los dos `spawn`/`spawnSync`)

**Interfaces:**
- Produces: toda invocación de Python desde las pruebas de navegador recibe `PYTHONPATH=<raíz>/src`.

- [ ] **Step 1: Rama y entorno**

```bash
git switch -c feat/interfaz-premium
git config --local user.name omarfrancodev && git config --local user.email fofe2803@gmail.com
npm ci
npx playwright install chromium firefox
```

- [ ] **Step 2: Comprobar el problema**

Run: `python -c "import ccr_viewer; print(ccr_viewer.__file__)"` (sin `PYTHONPATH`)
Expected: ruta bajo `site-packages` (confirma el problema). Con `PYTHONPATH=src` debe imprimir la ruta del worktree.

- [ ] **Step 3: En `tests/browser/server.mjs` añadir `PYTHONPATH: join(RAIZ, "src")` al `env`** del `spawn` de `startFixtureServer` y pasar un `env` equivalente al `spawnSync` de `crearArchivoSintetico` y `fixtureOperation`.

- [ ] **Step 4: Línea base**

Run: `PYTHONPATH=src python -m unittest discover -s tests -p "test_*.py"`, `node --test "tests/js/*.test.mjs"` (45 pass) y `npx playwright test --project=chromium`
Expected: todo en verde. Anota los totales en la primera línea del informe de verificación (Tarea 14).

- [ ] **Step 5: Commit**

```bash
git add tests/browser/server.mjs
git commit -m "test(visor): ejecutar el servidor de pruebas contra el código del árbol de trabajo"
```

---

### Task 1: Preferencias, presentación y ruta local (módulos puros)

Cubre §3 (preferencias), §4 (títulos), §5 (URL), §10.

**Files:**
- Create: `src/ccr_viewer/web/prefs.js`, `present.js`, `route.js`
- Create: `tests/js/prefs.test.mjs`, `present.test.mjs`, `route.test.mjs`, `tests/test_static_resources.py`
- Modify: `src/ccr_viewer/server.py` (`STATIC_RESOURCES` +3), `tests/test_packaging.py` (lista de recursos)

**Interfaces — Produces:**

```js
// prefs.js
export const PREFS_KEY = "ccr-viewer:prefs";
export function loadPrefs(storage?): { theme: "system"|"light"|"dark", density: "comfortable"|"compact", motion: "system"|"reduce" };
export function savePrefs(prefs, storage?): void;               // nunca lanza
export function applyPrefs(root: {dataset: object}, prefs): void; // tema "system" elimina data-theme
export function prefersReducedMotion(prefs, matchMedia?): boolean;

// present.js
export function runTitle(summary): { label: string, kind: "mr"|"pr"|"scope"|"reference"|"key" };
export function labelRuns(items): Map<string /*summary.key*/, { label: string, hint: string|null }>;
export function actorKey(actor): string;     // "∅" si falta
export function actorLabel(actor): string;   // "Actor no declarado" si falta
export function formatInstant(value): { local: string|null, utc: string|null, original: string|null };
export function basisLabel(basis): string;   // texto en español; valor original si es desconocido
export function basisShape(basis): "circle"|"diamond"|"hollow";

// route.js
export const ROUTE_TABS: string[]; // ficha, hallazgos, validacion, seguimiento, documentos, trazabilidad, archivo
export function parseRoute(search: string): { run: string|null, tab: string|null, event: string|null };
export function buildRoute(route): string;   // "" o "?run=…&tab=…&event=…"
```

- [ ] **Step 1: Escribir las pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `prefs.test.mjs` | `loadPrefs` con `getItem` que lanza → `{theme:"system",density:"comfortable",motion:"system"}` · `loadPrefs` con `{"theme":"neon"}` → `theme:"system"` · `savePrefs` con `setItem` que lanza no lanza; con almacenamiento sano guarda solo las claves `theme,density,motion` bajo `ccr-viewer:prefs` · `prefersReducedMotion({motion:"reduce"}, ()=>({matches:false}))` → `true`; `{motion:"system"}` con `matches:true` → `true`; sin `matchMedia` → `false` · `applyPrefs` con tema `dark` fija `dataset.theme="dark"`; con `system` borra la clave |
| `present.test.mjs` | `runTitle({scope_label:"pr 42",scope_reference:"42"})` → `{label:"PR #42",kind:"pr"}` · `{scope_label:"mr !7",scope_reference:"!7"}` → `"MR !7"` · `{scope_reference:"https://git.ejemplo.invalid/acme/demo/pull/9"}` → `"PR #9"` · `{scope_label:"branch feature/x",scope_reference:"feature/x"}` → label `"branch feature/x"`, kind `scope` · sin alcance con `key:"aaaaaaaabbbb…"` → label `"Revisión aaaaaaaa"`, kind `key` · una URL no reconocible nunca produce un título humano inventado · `labelRuns` con dos filas «PR #42» y `source_review_id` distintos → `hint` = ese ID; sin ID → `hint` = `key.slice(0,8)`; etiqueta única → `hint:null`; la clave del mapa es `summary.key` · `actorKey` distingue mismo `name` con distinto `kind`; `actorKey(null)==="∅"`; `actorLabel(null)==="Actor no declarado"`; `actorLabel({kind:"agent",name:"a1",provider_id:"p"})==="agent · a1"` · `formatInstant("2026-09-01T12:00:05+00:00").utc==="2026-09-01T12:00:05.000Z"` y `.original` intacto; valor inválido → `local:null,utc:null,original:<valor>`; `null` → todo `null` · `basisLabel("observed_occurrence")==="ocurrencia observada"`; `"recording_fallback"`→`"respaldo de registro"`; `"sequence_fallback"`→`"respaldo de secuencia"`; desconocido → valor original · `basisShape`: observed→`circle`, recording→`diamond`, sequence→`hollow` |
| `route.test.mjs` | `parseRoute("?run=<32 hex>&tab=trazabilidad&event=E000003")` válido · `run` de 31 hex → `null` · `tab=inventada` → `null` · `event=E00001` → `null` · claves desconocidas ignoradas (`?token=x&run=…`) · `buildRoute` omite nulos, nunca emite `token`, descarta valores inválidos, y `parseRoute(buildRoute(r))` es idempotente |
| `test_static_resources.py` | el conjunto de archivos bajo `web/` (rutas relativas con `/`) es **igual** a `set(STATIC_RESOURCES)` |

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/prefs.test.mjs tests/js/present.test.mjs tests/js/route.test.mjs`
Expected: FAIL (módulos inexistentes). `PYTHONPATH=src python -m unittest discover -s tests -p "test_static_resources.py"` pasa ya (guarda de regresión: fallará en cuanto falte un registro).

- [ ] **Step 3: Implementar los tres módulos con las firmas de Interfaces**

`runTitle`: el modo es la primera palabra de `scope_label` cuando hay referencia; reconoce `^[#!]?\d+$`, `/pull/<n>`, `/merge_requests/<n>`; prefijo `PR #` si modo `pr` o `#`/`/pull/`, `MR !` si modo `mr` o `!`/`/merge_requests/`. `storage` por omisión es `globalThis.localStorage` obtenido dentro de `try/catch`. `ROUTE_TABS` son las claves existentes; `run` valida `/^[0-9a-f]{32}$/`, `event` `/^E[0-9]{6}$/`.

- [ ] **Step 4: Registrar recursos**

Añadir `prefs.js`, `present.js`, `route.js` a `STATIC_RESOURCES` y a la lista de `test_static_resources`/`test_packaging.test_incluye_los_recursos_estaticos`.

Run: las pruebas del Step 2 + `PYTHONPATH=src python -m unittest discover -s tests -p "test_static_resources.py" -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer/web/prefs.js src/ccr_viewer/web/present.js src/ccr_viewer/web/route.js src/ccr_viewer/server.py tests
git commit -m "feat(visor): añadir preferencias locales, etiquetas de revisión y ruta acotada"
```

---

### Task 2: Shell, tokens, tabs manuales y navegación

Cubre §3, §5 (tabs/historial), AX base.

**Files:**
- Create: `web/tokens.css`, `web/shell.js`, `web/icons.js`, `tests/js/contrast.test.mjs`, `tests/browser/shell.spec.mjs`
- Modify: `web/index.html`, `web/styles.css`, `web/app.js`, `web/store.js`, `tests/js/store.test.mjs`, `tests/browser/visual.spec.mjs`, `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Consumes: `prefs.js`, `route.js` (Tarea 1).
- Produces:

```js
// store.js — ESTADO_INICIAL: se elimina `theme`; se añaden
//   prefs: {theme,density,motion}, selectedEventId: string|null, connection: "connecting"|"connected"|"disconnected"
// acciones: setPrefs {prefs}, selectEvent {eventId}, setConnection {state}, selectRun {key, tab?, eventId?}
// shell.js
export function mountShell(doc): {
  regions: { library, header, tabs, content, inspector, status },
  announce(text: string): void,                         // región polite; una vez por cambio
  openDialog({ title, build(container, close) }): () => void,  // <dialog>, devuelve close
  setConnection(state): void,
};
export function createTabs(listEl, tabs: {id,label}[], { selected, onSelect(id) }): { setSelected(id): void };
```

- [ ] **Step 1: Pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `store.test.mjs` | `setPrefs` actualiza `prefs`; `selectRun` reinicia `selectedEventId` y `tab` a `"ficha"` salvo `tab` explícito; `selectEvent` guarda el ID; `setConnection` |
| `contrast.test.mjs` | lee `tokens.css`; calcula el ratio WCAG de cada par `texto/superficie`, `texto-suave/superficie`, `acento/superficie` y `foco/superficie` en `:root` claro y oscuro y en los overrides `[data-theme]`; texto ≥4.5, control/foco ≥3 |
| `shell.spec.mjs` | **tabs:** flechas ←/→ mueven el foco sin activar; Enter/Espacio activan; Home/End; cada `role=tab` enlaza `aria-controls`↔`role=tabpanel[aria-labelledby]` · **ruta:** abrir `/?run=<clave>&tab=hallazgos#token=…` selecciona la revisión y la pestaña, y el fragmento se elimina; `?run=zzz` → sin selección y aviso · **historial:** cambiar de pestaña y `page.goBack()` restaura la anterior sin reproducir · **layout:** a 1440, 1024, 768 y 375 px `document.documentElement.scrollWidth <= innerWidth`; a 375 px la biblioteca es un desplegable con retorno a la revisión · **preferencias:** tras cambiar tema/densidad/movimiento y recargar persisten y `Object.keys(localStorage)` es exactamente `["ccr-viewer:prefs"]` · **`localStorage bloqueado`:** con `addInitScript` que hace lanzar a `Storage.prototype.getItem/setItem`, la app arranca con valores por defecto · **contexto de raíz:** el botón abre un `<dialog>` con la ruta completa; Escape lo cierra y el foco vuelve al botón |

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/js/store.test.mjs tests/js/contrast.test.mjs` y `npx playwright test tests/browser/shell.spec.mjs --project=chromium`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- `tokens.css`: variables `--fondo,--superficie,--texto,--texto-suave,--borde,--acento,--foco,--ok,--aviso,--error`, escalas `--espacio-1…6` (4/8/12/16/24/32), `--radio-1…3` (6/10/14), tipografía del sistema y monoespaciada, `[data-density="compact"]` y `[data-theme]` (sustituye el bloque de tokens y los overrides del final de `styles.css`).
- `index.html`: regiones `header`, `#avisos` (solo estado de conexión compacto, no franja permanente), `#biblioteca`, `#barra-revision` (tabs), `#revision` (panel), `#inspector`, región `role=status aria-live=polite` del anunciador. Se conservan los IDs `biblioteca`, `revision`, `barra-revision`, `tema`, `raiz` para limitar la migración de pruebas. Selectores `#tema` con valores `system|light|dark`.
- `app.js`: usa `mountShell`; sincroniza `store` ↔ `history` según la decisión 4; `popstate` despacha `selectRun/setTab/selectEvent` sin reproducir.
- Layout CSS con los breakpoints de Global Constraints; todo hijo de grid con `min-width: 0`.

- [ ] **Step 4: Migrar** `visual.spec.mjs` (`#tema` ya usa `system/light/dark`; sustituir `scrollWidth` por la comprobación nueva) y registrar `tokens.css`, `shell.js`, `icons.js` en `STATIC_RESOURCES`/packaging.

Run: `node --test "tests/js/*.test.mjs"` y `npx playwright test --project=chromium`
Expected: PASS (las demás especificaciones siguen verdes: el shell envuelve las vistas existentes).

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): rediseñar el shell con tokens, tabs manuales y navegación local"
```

---

### Task 3: Biblioteca compacta y filtros tipados (UI-01)

Cubre §4.

**Files:**
- Create: `web/filters.js`, `tests/js/filters.test.mjs`, `tests/js/generators.mjs`, `tests/browser/library.spec.mjs`
- Modify: `web/library.js`, `web/store.js`, `web/app.js`, `web/styles.css`, `tests/browser/wiring.spec.mjs`, `tests/browser/support.mjs`, `tests/js/store.test.mjs`

**Interfaces:**
- Consumes: `labelRuns`, `runTitle` (Tarea 1).
- Produces:

```js
// filters.js
export const FILTER_KEYS: ["q","repository","verdict","profile","mode","reference","kind","open","date_from","date_to"];
export const VERDICTS: string[]; export const PROFILES: string[]; export const KINDS: string[];
export function normalizeFilters(raw: object): object;               // recorta, descarta vacíos, conserva valores desconocidos
export function validateFilters(f): { ok: boolean, errors: { date_from?: string, date_to?: string } };
export function filterChips(f): { key: string, label: string, value: string }[];
export function suggestFromPage(items: object[], field: "repository"|"mode"|"reference"): string[];
// store.js — nuevas acciones: libraryFailed {error} (conserva `library`, activa `libraryStale`), libraryLoaded limpia `libraryStale`
// library.js
export function mountLibrary(container, { getState, dispatch }): { update(state): void };  // la barra de filtros NO se recrea en cada update
// generators.mjs
export function bibliotecaSintetica(total: number, opts?: { sameTitle?: boolean, longUrl?: boolean }): { items: object[], total: number };
```

- [ ] **Step 1: Pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `filters.test.mjs` | `normalizeFilters({q:"  a ",verdict:""})` → `{q:"a"}` · `validateFilters({date_from:"2026-09-02",date_to:"2026-09-01"}).ok===false` con error en `date_from` · fechas con formato inválido → error · `VERDICTS` igual a `review.verdicts` de `contracts/compatibility.json`; `KINDS` igual a `review.presentation_kinds`; `PROFILES` igual a la unión de `review.profiles.*` · `filterChips({open:"true"})` → etiqueta «Abiertas» · `suggestFromPage` deduplica y excluye vacíos |
| `store.test.mjs` | `libraryFailed` conserva `library.items` y marca `libraryStale`; `setFilters` reinicia `offset` a 0 |
| `library.spec.mjs` | **UI-01:** con 1000 corridas sintéticas muestra 50 filas, «1000 revisiones · página 1 de 20» y el total filtrado tras filtrar · `› etiquetas coincidentes` (`sameTitle`): dos filas con «PR #42» muestran su ID de revisión distinto · `› URL larga sin espacios`: `#biblioteca.scrollWidth <= clientWidth` y el valor completo sigue accesible (atributo `title` y botón «Ver detalle») · agrupa por repositorio sin repetir el alcance en cada fila · `open` es selector Todas/Abiertas/Cerradas y la petición lleva `open=true` · fechas con desde > hasta: «Aplicar» deshabilitado y mensaje visible vinculado con `aria-describedby` · «Cancelar» descarta borradores · aplicar desde la página 2 pide `offset=0` · búsqueda: con `page.clock`, 249 ms no pide, 250 ms sí; Enter pide de inmediato · `fallo de recarga`: la lista permanece con el aviso «no está actualizada» y «Reintentar» · `cambiar de filtro no cambia la revisión abierta` · **foco/caret:** escribir en búsqueda, provocar una recarga (aviso SSE simulado) y comprobar que el input conserva foco, caret y valor · enums: `verdict` ofrece los 4 valores del contrato y «Otro valor…» que acepta texto libre · estados distintos: biblioteca vacía vs sin coincidencias vs carga vs error |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/filters.test.mjs tests/js/store.test.mjs` y `npx playwright test tests/browser/library.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar**

`library.js` monta una vez la barra (búsqueda, chips «Todas/Abiertas», botón de filtros con contador, chips aplicados, «Limpiar») y re-renderiza solo la región de lista/paginación en `update`. Borradores en estado local del componente hasta «Aplicar». Fila: título (`runTitle`/`labelRuns`), repositorio, estado (etiqueta legible + texto original disponible), fecha. La selección usa siempre `summary.key`. `getRuns` conserva `limit=50`. Un `libraryRequest` por generación descarta respuestas obsoletas (ya existe en `app.js`; moverlo junto a la carga).

- [ ] **Step 4: Migrar** `wiring.spec.mjs › filtrar y limpiar` a los controles nuevos; añadir a `support.mjs` la opción `openFixture(page, { library })` para inyectar la biblioteca sintética.

Run: `npx playwright test --project=chromium` y `--project=firefox tests/browser/library.spec.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): biblioteca compacta con filtros tipados y paginación"
```

---

### Task 4: Cabecera, Resumen, Seguimiento y Archivo (UI-02, parte 1)

Cubre §5 (cabecera, Resumen, Seguimiento, Archivo).

**Files:**
- Create: `web/header.js`, `web/history.js`, `web/archive.js`, `tests/browser/views.spec.mjs`
- Modify: `web/profile.js`, `web/views.js`, `web/app.js`, `web/styles.css`, `tests/js/views.test.mjs`, `tests/js/dom-stub.mjs`, `tests/browser/profile.spec.mjs`, `tests/browser/support.mjs`

**Interfaces:**
- Produces:

```js
export function renderRunHeader(container, view, { onCopy?: (text: string) => void }): void;     // header.js
export function renderProfile(container, view): void;                                              // Resumen (profile.js)
export function renderHistory(container, view, dispatch): void;                                    // history.js
export function renderArchive(container, view, { validate = validateRun }): void;                  // archive.js
// views.js reexporta todas las funciones anteriores y las de Tarea 5
```

- [ ] **Step 1: Pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `views.test.mjs` | cabecera muestra título, repo, ID completo, referencia, estado del cierre, veredicto y conteos con su alcance; **no** contiene «puntuación»/«%» · integridad, cierre, veredicto y checks aparecen en elementos separados · Resumen separa Responsable y Autores del cambio, conserva `profile` sin normalizar y muestra campos desconocidos en `<details>` sin reinterpretarlos · Seguimiento: una entrada con forma reconocida (`status`, `previous_finding_id`, `check_ids`…) se estructura; una entrada de forma desconocida conserva JSON secundario · Archivo: `residuals: []` se expresa «Sin residuos declarados» y no `[]`; los diagnósticos se agrupan por gravedad; el JSON original está en `<details>` |
| `dom-stub.mjs` | corregir el typo `funion`→`funcion` en `addEventListener` (hoy lanza `ReferenceError` si una vista registra un oyente) |
| `views.spec.mjs` | copiar ID copia el valor completo (Chromium con permisos de portapapeles) · «Verificar integridad» muestra su resultado en una región `role=status` y no cambia la etiqueta de veredicto · `Seguimiento`: «Abrir revisión anterior» solo existe para vínculos `resolved` · formas no admitidas conservan el aviso y el JSON original (migrar `profile.spec.mjs`) |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/views.test.mjs` y `npx playwright test tests/browser/views.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar** las firmas de Interfaces. `renderRunHeader` se monta encima del panel para todas las pestañas. `renderArchive` y `renderHistory` salen de `views.js` (que queda como reexportación). Se conserva el aviso `adapter.invalid_shape` y el `try/catch` de `app.js` que degrada a Archivo.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"` y `npx playwright test --project=chromium`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): cabecera de revisión y vistas Resumen, Seguimiento y Archivo"
```

---

### Task 5: Hallazgos, Validación y Documentos (UI-02, parte 2)

Cubre §5 (Hallazgos, Validación, Documentos).

**Files:**
- Modify: `web/findings.js`, `web/validation.js`, `web/documents.js`, `web/store.js` (acción `openTarget`), `web/app.js`, `web/styles.css`
- Modify: `tests/js/views.test.mjs`, `tests/browser/views.spec.mjs`, `tests/browser/document-content.spec.mjs`, `tests/browser/markdown.spec.mjs`

**Interfaces:**
- Produces:

```js
// findings.js
export function filterFindings(findings: object[], f: { status?: string, priority?: string, text?: string }): object[];
// store.js: acción openTarget {tab, id} → estado `target: {tab, id}|null`; las vistas lo consumen y lo limpian con clearTarget
```

- [ ] **Step 1: Pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `views.test.mjs` | `filterFindings` por estado, prioridad y texto; prioridad desconocida `"P9"` se conserva y filtra por su valor original · fila de hallazgo muestra ID, prioridad, estado y ubicación; el conteo respeta el filtro · Validación: el `command` se escribe como texto inerte (`<script>` literal) y un check sin salida muestra «Sin salida registrada» · Documentos: **informe ausente**, **inventario vacío** y **lectura fallida** producen tres mensajes distintos |
| `views.spec.mjs` | seleccionar un hallazgo abre su detalle (escenario, impacto, corrección, evidencia) sin salir de la pestaña · la referencia a `C001` navega a Validación y resalta el check; el check lista los hallazgos que lo citan · el preview muestra ruta, formato y aviso de truncamiento; seleccionar otro archivo conserva el inventario · un error de preview conserva lista/selección y ofrece «Reintentar» |
| `document-content.spec.mjs`, `markdown.spec.mjs` | migrar selectores; HTML hostil, `javascript:` y traversal siguen inertes (SC-01) |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/views.test.mjs` y `npx playwright test tests/browser/views.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar** maestro-detalle en el panel (decisión 5); lista densa por filas con filtros locales y conteo; `renderDocuments` mantiene `open-local-document` y su API inyectable. No se ofrece ejecutar comprobaciones.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"` y `npx playwright test --project=chromium --project=firefox`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): vistas Hallazgos, Validación y Documentos con maestro-detalle"
```

---

### Task 6: Modelo de traza (TR-02, parte pura)

Cubre §6.1, §6.2, §6.4, §9 (datos).

**Files:**
- Create: `web/trace-model.js`, `tests/js/trace-model.test.mjs`
- Modify: `tests/js/generators.mjs` (añadir `trazaSintetica`), `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Consumes: `actorKey`, `actorLabel` (Tarea 1).
- Produces:

```js
export const WINDOW_SIZE = 50;
export function buildTraceModel(trace /* respuesta de /trace */): TraceModel;
// TraceModel:
//   events: Event[]                    // ordenados por sequence; objetos originales sin mutar
//   byId: Map<string, Event>; index: Map<string, number>
//   lastId: string|null                // último por sequence
//   actors: { key, label, count, firstId }[]   // orden de primera aparición
//   chain: { status, verified: boolean, updating: boolean, validPrefixLength: number }
//   diagnostics: object[]; relations: object[]; temporalOrder: string[]   // tal como llegaron
//   search(query: string): string[]            // IDs en orden, sobre el modelo completo; actor, id, kind, status, summary
//   windowAround(eventId: string|null, size?: number): { start: number, end: number, total: number }
//   firstOfActor(key: string, within?: string[]): string|null
//   relationsOf(eventId): { outgoing: object[], incoming: object[] }
export function reconcileTrace(previous: TraceModel|null, next: TraceModel):
  { newIds: string[], changedIds: string[], prefixReplaced: boolean };
export function trazaSintetica(n: number, opts?: { actors?: number, basis?: "mixed"|"observed"|"none", chain?: string }): object; // generators.mjs
```

- [ ] **Step 1: Pruebas que fallan** (`trace-model.test.mjs`)

| Prueba | Aserción |
| --- | --- |
| ordena por `sequence` | entrada desordenada → `events.map(id)` ascendente; los objetos son los originales |
| 0 y 1 evento | `lastId===null` / `"E000001"`; `actors` vacío / de un elemento |
| actores | kind+name+provider_id idénticos se deduplican; mismo `name` con distinto `kind` son dos; actor `null` produce un único «Actor no declarado»; **no** se sustituye por `recorder` ni `executor`; orden de primera aparición |
| búsqueda | en 10 000 eventos `search("E009999")` → `["E009999"]`; insensible a mayúsculas; busca en actor/ID/kind/status/summary; recorre todo el modelo, no una página |
| ventanas | 50 eventos → `{start:0,end:50,total:50}`; 51 → ventanas `[0,50)` y `[50,51)`; en 10 000, `windowAround("E000051")` → `{start:50,end:100,total:10000}`; `windowAround(null)` → última ventana |
| cadena | `chain_status:"limited"` → `verified:false`; `"updating"` → `updating:true` y `verified:false`; diagnósticos conservados |
| tiempos | horas iguales, `temporal_basis:"sequence_fallback"` sin `temporal_at` y fuera de orden se conservan; `temporalOrder` es el del backend |
| relaciones | `relationsOf("E000002")` separa salientes y entrantes (por `target`) con su `status` original |
| `reconcileTrace` | solo añadidos → `newIds` ordenados, `prefixReplaced:false` · mismo ID con otro `sha256` → `changedIds`, no `newIds` · prefijo más corto o IDs previos ausentes → `prefixReplaced:true` · sin cambios → todo vacío |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/trace-model.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implementar** con índices construidos una sola vez por modelo (haystack en minúsculas por evento). Sin DOM, sin reloj.

- [ ] **Step 4: Run to verify they pass** — `node --test tests/js/trace-model.test.mjs` y `PYTHONPATH=src python -m unittest discover -s tests -p "test_static_resources.py"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): derivar el modelo de traza con actores, búsqueda y ventanas"
```

---

### Task 7: Reproducción y presentador (TR-03, LV-01, LV-02, LV-04 — lógica)

Cubre §7, §8, §8.2, §10 (controlador).

**Files:**
- Modify: `web/playback.js`, `tests/js/playback.test.mjs`
- Create: `web/presenter.js`, `tests/js/presenter.test.mjs`, `tests/js/fake-clock.mjs` (reloj manual `{ ahora, programar, cancelar, advance(ms) }`)
- Modify: `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Consumes: `TraceModel`, `reconcileTrace` (Tarea 6).
- Produces:

```js
// playback.js
export const PASO_BASE_MS = 2350; export const REVELADO_BASE_MS = 1800; export const VELOCIDADES = [0.5,1,2,4];
// state(): { mode: "paused"|"playing", selectedEventId, speed, newEvents, stepElapsedMs, stepMs }
//   modo inicial "paused" con el último seleccionado; pause() congela y play() reanuda con el tiempo restante;
//   play() en el último evento es no-op; se elimina INTERVALO_BASE_MS.
// presenter.js
export function revealStages(progress: number): { structure: number, header: number, content: number, actions: number };
//   cada valor = clamp((p - ini)/(fin - ini), 0, 1) con tramos [0,.22] [.18,.42] [.36,.72] [.68,1]
export function liveAvailability(ctx: { closureState: string|null|undefined, partial: boolean }):
  { enabled: boolean, reason: "processing"|"not_processing"|"unknown"|"updating" };
export function createPresenter(opts?: { clock?, reducedMotion?: boolean }): Presenter;
// Presenter:
//   state(): { mode: "replay"|"live", paused: boolean, following: boolean, selectedId: string|null, speed: number,
//              presentedCount: number, reveal: {eventId, progress, stages}|null, pendingIds: string[],
//              live: {enabled, reason}, lastActiveId: string|null, loader: "active"|"static"|"off", waitingFirst: boolean,
//              notice: {id: number, code: string, text: string}|null, canPlay: boolean }
//   load(model, ctx: {closureState, partial, connected}): void          // corrida nueva: reinicia
//   update(model, ctx, diff: {newIds, changedIds, prefixReplaced}): void // recarga coherente
//   setConnection(connected: boolean): void
//   setReducedMotion(flag: boolean): void
//   select(id, source?): void; restart(): void; togglePlay(): void; step(delta: -1|1): void; last(): void
//   setSpeed(v): void; showComplete(): void; setFollowing(flag): void
//   enterLive(): boolean; resumeLive(): void; showPending(): void
//   pause(reason: "user"|"tab"|"run"|"hidden"|"dialog"): void
//   subscribe(fn): () => void; destroy(): void
```

- [ ] **Step 1: Pruebas que fallan**

`playback.test.mjs` (reescribir las que asumían modo `live` inicial y `INTERVALO_BASE_MS`): inicia `paused` con el último seleccionado · a 1× avanza cada 2350 ms; a 2× cada 1175 · pausar a 900 ms y reanudar 5 s después retoma con el tiempo restante · `play()` en el último es no-op · `ingest` no mueve un cursor pausado · `destroy` cancela temporizadores.

`presenter.test.mjs` (reloj manual; 5 eventos E000001–E000005 salvo indicación):

| ID | Prueba → aserción |
| --- | --- |
| P-1 | inicia `replay`, `paused:true`, `selectedId:"E000005"`, `presentedCount:5`, `reveal:null`, sin autoplay |
| P-2 | `restart()` → selecciona E000001, `presentedCount:1`, `reveal.eventId:"E000001"`, `progress:0` |
| P-3 | tras `restart()+togglePlay()` y `advance(2350)` → `selectedId:"E000002"`, `presentedCount:2`, `reveal.eventId:"E000002"` |
| P-4 | a 2×: `reveal.progress===1` a 900 ms; siguiente a 1175 ms |
| P-5 | `revealStages(0.10).structure≈0.4545`; `revealStages(0.30)` → `header≈0.5`, `structure===1`; `revealStages(1)` → los cuatro en 1 |
| P-6 | a 900 ms `progress===0.5`; `pause()`; `advance(5000)` → sigue 0.5; `togglePlay()`; `advance(900)` → `progress===1` y a 1175 ms restantes avanza |
| P-7 | `showComplete()` → `reveal:null`, `paused` no cambia, no avanza la selección |
| P-8 | `setReducedMotion(true)`: `reveal` siempre `null`; a 4× el siguiente llega a 587.5 ms |
| P-9 | `select("E000004")` en pausa no inicia reveal; si estaba tras `restart()` con `presentedCount:1` → `presentedCount:4` |
| P-10 | `pause("tab")`, `pause("hidden")`, `pause("dialog")` pausan; volver no reanuda |
| L-1 | `liveAvailability`: `processing`→enabled; `prepared`,`retaining`,`closing`,`complete`,`""`,`null`,`undefined`,`"future_state"`→ disabled (`unknown` para nulos/desconocidos, `not_processing` para los conocidos) |
| L-2 | `{closureState:"processing", partial:true}` → disabled, `reason:"updating"` |
| L-3 | `enterLive()` sin disponibilidad devuelve `false` y no cambia `mode` |
| L-4 | `enterLive()` disponible: `mode:"live"`, selecciona el último, `following:true`, `paused:false`, `presentedCount` total |
| L-5 | `lastActiveId` = último por `sequence` aun con `select("E000002")`; `loader:"active"` |
| L-6 | `processing` sin eventos: `lastActiveId:null`, `waitingFirst:true`, `loader:"active"` |
| L-7 | `update` con 1 evento nuevo en live siguiendo: `selectedId` = nuevo, `reveal.eventId` = nuevo, `lastActiveId` = nuevo |
| L-8 | ráfaga de 3: `reveal.eventId` es el último; `presentedCount` total (anteriores completos) |
| L-9 | llegada durante un revelado: el anterior se completa y empieza el nuevo, sin acumular espera |
| L-10 | live en pausa: `update` con 2 IDs → `pendingIds` de 2 únicos, `selectedId` y `presentedCount` intactos; repetir el mismo ID no duplica |
| L-11 | `showPending()` incorpora sin cambiar selección ni reanudar; `resumeLive()` limpia cola, selecciona último, `following:true`, revela solo el último |
| L-12 | ID en `changedIds` no entra en `pendingIds` y genera `notice.code:"event_changed"` |
| L-13 | `prefixReplaced:true` → pausa, `notice.code:"prefix_replaced"`; si el seleccionado ya no existe → selecciona el último y `notice.code:"selection_removed"` |
| L-14 | en mitad de un revelado con 2 pendientes y pausa, `update` con `closureState:"complete"` → `live.enabled:false`, `mode:"replay"`, `loader:"off"`, `reveal:null`, `pendingIds` conserva 2, `selectedId` y `paused:true` intactos, sin reproducción automática |
| L-15 | `setConnection(false)` con `processing` → `loader:"static"`; `setConnection(true)` mantiene `static` hasta el siguiente `update` |
| L-16 | un `update` con IDs ya conocidos (resync/reconexión) no cuenta nuevos |
| L-17 | `destroy()` y `advance(10000)` → sin cambios de estado |
| L-18 | una ráfaga de 3 produce **un** `notice` de llegada; el cambio de cierre produce uno; `notice.id` crece de uno en uno |
| L-19 | `update` en `replay` (sin En Vivo): el modelo recibe los eventos, `selectedId` y `presentedCount` no cambian y los IDs nuevos quedan en `pendingIds` hasta `showPending()` |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/playback.test.mjs tests/js/presenter.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implementar** `playback.js` según Interfaces (cursor + reloj con tiempo restante; `state().stepElapsedMs` calculado con el reloj inyectado). `presenter.js` compone `createPlayback` y deriva `reveal.progress = min(1, stepElapsedMs / (REVELADO_BASE_MS / speed))` solo mientras `reveal` esté activo y no haya movimiento reducido; en reducido la espera es la misma `PASO_BASE_MS / speed` sin revelado. Sin DOM.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): coordinar reproducción, revelado y disponibilidad de En Vivo"
```

---

### Task 8: Lectura coherente y recargas coalescidas (LV-03, lógica)

Cubre §8.1.

**Files:**
- Create: `web/live-sync.js`, `tests/js/live-sync.test.mjs`
- Modify: `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Produces:

```js
export const RETRY_DELAYS_MS = [250, 500, 1000]; export const COALESCE_MS = 100;
export async function readCoherent(runKey: string, api: { getRun, getTrace }, opts?: { sleep?: (ms) => Promise<void> }):
  Promise<
    | { status: "ok", view: object, trace: object }
    | { status: "updating", view: object|null }                      // agotados los reintentos
    | { status: "trace_failed", view: object, error: Error }         // vistas coherentes, traza no cargó
  >;
export function createReloadScheduler(opts: { load: (generation: number) => Promise<void>, clock?, coalesceMs?: number }):
  { request(): void, cancel(): void, isCurrent(generation: number): boolean };
```

- [ ] **Step 1: Pruebas que fallan** (`live-sync.test.mjs`, API simulada y `sleep` que registra esperas)

| Prueba | Aserción |
| --- | --- |
| coherente a la primera | A→T→B con el mismo `closure` y sin `updating`: `{status:"ok"}`, 1 lectura de cada ruta |
| cierre distinto entre A y B | reintenta con esperas `[250,500,1000]` y devuelve `{status:"updating"}` tras tres reintentos |
| `view.updating:true` o diagnóstico `snapshot.transition_pending` / `snapshot.transition_detected` | no coherente |
| `trace.chain_status:"updating"` | **no** impide la coherencia |
| traza falla con vistas coherentes | `{status:"trace_failed", view: B}` |
| se estabiliza al segundo intento | `{status:"ok"}` con una sola espera de 250 ms |
| coalescedor | 5 `request()` en 100 ms → un `load`; un `request()` durante una carga activa produce exactamente una carga pendiente después; `cancel()` invalida la generación en vuelo (`isCurrent(gen)===false`) |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/live-sync.test.mjs`. Expected: FAIL.

- [ ] **Step 3: Implementar.** La comparación de cierre usa `JSON.stringify` de `view.closure` de A y B. No se promete atomicidad del backend; se documenta en el comentario del módulo.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): leer vista y traza de forma coherente con reintentos acotados"
```

---

### Task 9: Explorador — actores, timeline, controles y tarjetas (TR-01, TR-02)

Cubre §6.2, §6.3, §6.4, §11 (lista semántica). Sin revelado ni En Vivo todavía.

**Files:**
- Create: `web/explorer.js`, `web/actors.js`, `web/timeline.js`, `web/cards.js`, `web/explorer.css`, `tests/browser/explorer.spec.mjs`
- Modify: `web/app.js` (monta el explorador en lugar de `renderLifecycle`; usa `buildTraceModel` + `createPresenter`), `web/index.html` (`<link>` a `explorer.css`)
- Delete: `web/lifecycle.js`; migrar `tests/browser/lifecycle.spec.mjs` a `explorer.spec.mjs`; migrar `wiring.spec.mjs` y `visual.spec.mjs` a los selectores nuevos; migrar `live-transition.spec.mjs` conservando solo la aserción de que, con el cursor pausado, las tarjetas pasan de 1 a 2 y la selección no cambia (el contador «N nuevos sin presentar» se acredita en la Tarea 12)
- Modify: `server.py` (quitar `lifecycle.js`, añadir nuevos), `tests/test_packaging.py`

**Interfaces:**
- Consumes: `TraceModel` (T6), `Presenter` (T7).
- Produces el contrato DOM (las pruebas lo usan):

```js
export function mountExplorer(container, { model, presenter, runKey, onSelect(eventId, source) }):
  { update(model, diff): void, focusSelected(): void, destroy(): void };
// DOM:
//  [data-explorer]                          raíz
//  [data-part="actors"] button[data-actor-key]      franja; 8 accesos por ventana; «Ver todos» abre <dialog> paginado de 50
//  [data-part="timeline"] button[data-event-id][data-basis="observed_occurrence|recording_fallback|sequence_fallback"]
//  [data-part="cursor"], input[type=range][aria-label="Posición del recorrido"]
//  [data-part="search"] input[type=search][aria-label="Buscar hitos"]
//  [data-part="cards"] li[data-event-id][data-state="received|revealing|complete"][aria-current="true"?]
//  controles con nombre accesible: «Reiniciar», «Evento anterior», «Reproducir»/«Pausar», «Evento siguiente»,
//    «Ir al último», «Velocidad», «Mostrar tarjeta completa», «Seguir recorrido», «Mostrar hito seleccionado»
```

- [ ] **Step 1: Pruebas que fallan** (`explorer.spec.mjs`, trazas con `trazaSintetica`)

| Prueba | Aserción |
| --- | --- |
| tarjetas en secuencia, actores solo en franja | `[data-part=cards]` en orden ascendente; no hay encabezados por actor dentro de la lista; no existe `.orden-temporal` ni una segunda lista de IDs |
| TR-01 convergencia | pulsar un actor, un punto y una tarjeta dejan el mismo `data-event-id` con `aria-current` en timeline y tarjetas y el mismo ID en el inspector; pulsar un actor pausa y selecciona su primer hito entre los resultados; sin coincidencias explica en lugar de filtrar |
| selección no roba foco | tras pulsar un punto, `document.activeElement` sigue siendo ese punto |
| 0 / 1 eventos | mensaje propio («no conserva hitos registrados») / una tarjeta |
| 50 / 51 | 50: 50 marcadores sin controles de ventana; 51: «1–50 de 51» y «Siguiente ventana»; seleccionar E000051 cambia de ventana |
| TR-02 10 000 | ≤50 `[data-part=timeline] [data-event-id]` y ≤50 tarjetas montadas; el deslizador alcanza `E010000`; buscar `E009999` selecciona y muestra «1 coincidencia»; 60 actores: franja con 8 accesos y lista paginada de 50 |
| bases temporales | marcadores con `data-basis` distinto; el nombre accesible de un hito sin hora contiene «sin hora» |
| búsqueda oculta la selección | la selección persiste y aparece «Mostrar hito seleccionado», que limpia la búsqueda |
| cadena limitada/fallida | la etiqueta es «cadena con limitaciones»/«no verificada» y los diagnósticos son visibles; nunca «verificada» |
| actor ausente | etiqueta «Actor no declarado», no el registrador |
| teclado | anterior/siguiente/primero/último/velocidad/deslizador operables solo con teclado; todos los actores alcanzables |

- [ ] **Step 2: Run to verify they fail** — `npx playwright test tests/browser/explorer.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar.** `cards.js` pinta como máximo 50 tarjetas (página) con botón de selección, metadata breve, resumen y estado original; sin `role=feed`. `timeline.js` pinta una ventana de ≤50 marcadores con forma según `basisShape`; las distancias son pasos, no duraciones. `app.js` conserva `generation`/`revisionRequest`, destruye el explorador al cambiar de revisión y no recrea tabs/inspector por cada aviso. Pausar en cambio de pestaña/revisión mediante `presenter.pause("tab"|"run")`.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"`, `PYTHONPATH=src python -m unittest discover -s tests -p "test_packaging.py" -v` y `npx playwright test --project=chromium --project=firefox`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/ccr_viewer tests
git commit -m "feat(visor): explorador de trazabilidad con actores, timeline y tarjetas"
```

---

### Task 10: Revelado progresivo y movimiento (TR-03)

Cubre §7.

**Files:**
- Modify: `web/cards.js`, `web/timeline.js`, `web/explorer.js`, `web/explorer.css`
- Create: `tests/browser/explorer-playback.spec.mjs`

**Interfaces:**
- Consumes: `presenter.state().reveal` y `revealStages` (T7).
- Produces: sobre la tarjeta en revelado, `data-state="revealing"` y propiedades `--etapa-estructura`, `--etapa-cabecera`, `--etapa-contenido`, `--etapa-acciones` (0–1) escritas con `style.setProperty` por un único muestreador `requestAnimationFrame` activo solo mientras haya revelado.

- [ ] **Step 1: Pruebas que fallan** (`explorer-playback.spec.mjs`, con `page.clock`)

| Prueba | Aserción |
| --- | --- |
| sin autoplay | al abrir la traza `data-state` de todas las tarjetas es `complete` y el botón dice «Reproducir» |
| Reiniciar | solo hay una tarjeta presentada y está en `revealing` |
| Reproducir | tras 2350 ms (1×) aparece la siguiente; a 2× tras 1175 ms |
| etapas | a ~20 % `--etapa-estructura`≥0.9 y `--etapa-acciones`=0; a ~50 % `--etapa-contenido`∈(0,1) |
| pausa congela | el valor de `--etapa-contenido` no cambia al avanzar el reloj en pausa; al reanudar continúa |
| mostrar completa | «Mostrar tarjeta completa» deja `data-state="complete"` y no reanuda |
| foco | durante `structure` los botones de acción de la tarjeta no son enfocables (`inert`); el botón principal tiene `aria-describedby` con el resumen completo |
| copiar y buscar | copiar el resumen durante el revelado copia el texto completo; buscar parte del resumen aún oculto encuentra la tarjeta |
| movimiento reducido del sistema | `emulateMedia({reducedMotion:"reduce"})`: tarjetas `complete` al instante; `getComputedStyle(loader).animationName==="none"`; espera 2350/velocidad |
| «Sin animaciones» de la UI | mismo resultado con `html[data-motion="reduce"]` |
| pausa por contexto | cambiar de pestaña, ocultar la página (`visibilitychange`) o abrir un diálogo pausa; al volver no reanuda |
| duraciones | `transition-duration` del cursor ≤0.42 s, del inspector entre 0.16 s y 0.18 s; el pulso de llegada ≤0.56 s |
| seguir recorrido | desplazar el panel manualmente desactiva el seguimiento y `window.scrollY` no cambia con llegadas |
| **sin violaciones CSP** | durante todo el recorrido no se emite `securitypolicyviolation` ni mensaje de consola de CSP |

- [ ] **Step 2: Run to verify they fail** — `npx playwright test tests/browser/explorer-playback.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar.** CSS mapea las cuatro etapas a máscara/opacidad/transform del contenido de **una** tarjeta; reserva de altura estable (sin medir el listado por fotograma). `explorer.css` anula `animation`/`transition` bajo `@media (prefers-reduced-motion: reduce)` y `:root[data-motion="reduce"]`; el estado de carga pasa a icono + etiqueta estáticos. El muestreador se cancela al desmontar o pausar. Ningún `innerHTML` con datos de archivo.

- [ ] **Step 4: Run to verify they pass** — `npx playwright test --project=chromium --project=firefox`. Expected: PASS (los pasos de portapapeles solo en Chromium).

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): revelado progresivo del elemento con soporte de movimiento reducido"
```

---

### Task 11: Inspector, relaciones y evidencia (RF-01)

Cubre §6.3 (inspector), §9.

**Files:**
- Create: `web/inspector.js`, `web/relations.js`, `tests/js/relations.test.mjs`, `tests/browser/inspector.spec.mjs`
- Modify: `web/explorer.js`, `web/app.js` (retorno entre corridas), `web/explorer.css`, `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Produces:

```js
// relations.js
export function classifyRelation(relation, currentRunKey): {
  navigable: boolean, scope: "event"|"finding"|"check"|"run"|"none", reason: string /* explicación en español si no navega */ };
export function evidenceLink(item: string | object, inventory: { key, relative_path }[]):
  { kind: "file", fileKey: string, relativePath: string } | { kind: "inert", text: string, code: "absolute_path"|"path_traversal"|"url"|"not_in_inventory"|"unrecognized" };
// inspector.js
export function mountInspector(container, { getModel, presenter, inventory, onNavigate(target) }): { update(): void, destroy(): void };
```

- [ ] **Step 1: Pruebas que fallan**

| Archivo | Prueba → aserción |
| --- | --- |
| `relations.test.mjs` | `resolved` + destino `E…` con `run_key===actual` → navegable `event`; `F…`/`C…` resueltos → `finding`/`check`; `resolved` con otro `run_key` → `run`; `dangling`, `unresolved`, `ambiguous`, `unavailable`, `cyclic` → `navigable:false` con `reason` no vacío · `evidenceLink("evidence/notes.json", inv)` con coincidencia exacta → `file` con su clave · `"../secreto"` → `path_traversal`; `"/etc/passwd"` y `"C:\\x"` → `absolute_path`; `"https://x.invalid/a"` → `url`; `"notes.json"` sin coincidencia exacta → `not_in_inventory`; `{path:"evidence/notes.json"}` se trata como string; objeto desconocido → `unrecognized` |
| `inspector.spec.mjs` | muestra ID, secuencia, kind/status, resumen, actor/registrador/ejecutor **diferenciados**, procedencia, autoridad y base temporal con hora local, UTC y original · el JSON original está en `<details>` y los desconocidos se conservan · copiar usa el valor completo · relación local resuelta: botón «Abrir E000001» selecciona ese hito · relación entre corridas: «Abrir revisión CR-…» y luego «Volver a la revisión anterior» restaura corrida, pestaña y hito · `dangling`/`ambiguous`: texto explicativo y sin botón · ciclo: etiqueta de diagnóstico y no se recorre solo · sección expandible «Relaciones» lista origen y destinos · evidencia exacta abre Documentos y la petición es `/api/runs/<run>/files/<fileKey>` (nunca contiene la ruta cruda) · evidencia hostil queda inerte con su diagnóstico · sin relaciones/evidencia/actor/hora: mensaje propio para cada caso |

- [ ] **Step 2: Run to verify they fail** — `node --test tests/js/relations.test.mjs` y `npx playwright test tests/browser/inspector.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar.** La navegación entre corridas guarda `{run, tab, eventId}` previo en memoria (una entrada) y la expone como «Volver». Transición del inspector 160–180 ms. Todo texto vía `textContent`.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"` y `npx playwright test --project=chromium --project=firefox`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): inspector con relaciones navegables y evidencia por inventario"
```

---

### Task 12: En Vivo integrado (LV-01, LV-02, LV-04 en navegador)

Cubre §8, §8.1, §8.2, §11.

**Files:**
- Create: `web/live-controls.js`, `tests/browser/live-ui.spec.mjs`
- Modify: `web/app.js` (usa `readCoherent`, `createReloadScheduler`, `reconcileTrace`, presentador; separa el contador de IDs de traza del contador de avisos de biblioteca), `web/shell.js` (anunciador), `web/explorer.js`, `web/cards.js`, `web/timeline.js`, `web/explorer.css`, `tests/browser/support.mjs`, `server.py`, `tests/test_packaging.py`

**Interfaces:**
- Consumes: `Presenter` (T7), `readCoherent`/`createReloadScheduler` (T8), `subscribeNotices` (api.js, sin cambios).
- Produces: `mountLiveControls(container, { presenter }): { update(), destroy() }` con botón «En Vivo» (deshabilitado con texto visible del motivo), «Mostrar nuevos», «Reanudar En Vivo», contador «N nuevos sin presentar» y el estado de fuente; tarjetas/puntos con `data-active-source="true"` y etiqueta «Último hito activo · revisión en procesamiento».
- `support.mjs` añade `installFakeEventSource(page)` → `window.__ccr.emitNotice(notice)` y `window.__ccr.setConnection("open"|"error")` (solo pruebas, vía `addInitScript`).

- [ ] **Step 1: Pruebas que fallan** (`live-ui.spec.mjs`, vistas/trazas interceptadas)

| Prueba | Aserción |
| --- | --- |
| LV-01 matriz | con `closure.state` ∈ {`prepared`,`retaining`,`closing`,`complete`, ausente, `future_state`} el botón «En Vivo» está deshabilitado con su explicación visible; con `processing` está habilitado; conexión SSE «open» sola no lo habilita |
| `updating` | con `view.updating:true` o `snapshot.transition_pending` el botón queda deshabilitado con «Archivo en actualización» |
| LV-02 | `processing` con 3 hitos y E000002 seleccionado: E000003 lleva `data-active-source` y la etiqueta; al terminar el revelado persiste; al llegar E000004 (aviso + traza nueva) se mueve a E000004 · un hito `status:"completed"` con carga no se rotula «running» · cierre a `complete` retira la carga · sin hitos: «Esperando el primer registro» y ninguna tarjeta · último fuera de página/filtro: «Último activo: E…» con acceso explícito |
| activar | «En Vivo» selecciona el último y activa «Seguir recorrido»; nuevas tarjetas se revelan una a una; en ráfaga solo la última se anima |
| LV-04 pausa | pausar conserva ID, foco y scroll; llegadas acumulan «2 nuevos sin presentar»; buscar no borra el contador; «Mostrar nuevos» no reanuda ni mueve; «Reanudar En Vivo» selecciona el último |
| LV-04 cierre en pausa | el cierre coherente a `complete` deshabilita En Vivo, completa el revelado, conserva el contador y la selección, no reproduce solo |
| LV-04 desconexión | `setConnection("error")`: el indicador pasa a icono estático «Último estado conocido: processing · sin conexión» (sin `animationName`), banda «Datos no actualizados»; al reconectar no cuenta ni anima hasta recargar |
| **sesión caducada** | una recarga con `403 session_required` muestra «La sesión caducó; relanza el visor local», conserva la última vista y no entra en bucle (≤1 petición adicional por aviso) |
| prefijo reducido | traza nueva más corta: pausa y aviso «prefijo reemplazado»; la selección inválida pasa al último con aviso |
| mismo ID modificado | muestra diagnóstico de cambio y el contador de nuevos no aumenta |
| anuncios | la región polite recibe **un** mensaje por ráfaga y por cambio de cierre |

- [ ] **Step 2: Run to verify they fail** — `npx playwright test tests/browser/live-ui.spec.mjs --project=chromium`. Expected: FAIL.

- [ ] **Step 3: Implementar.**
  - Flujo de aviso: `scheduler.request()` → `readCoherent` → si `ok`, `buildTraceModel` + `reconcileTrace` + `presenter.update`; `updating` conserva el modelo con el aviso «Archivo en actualización» y espera otro aviso; `trace_failed` aplica solo el cierre (`presenter.update` con el modelo previo).
  - `chain_status:"updating"` sin `view.updating` no deshabilita nada.
  - Errores `403`/«session_required» → aviso fijo y detención del suscriptor.
  - Región polite y pausa por visibilidad/diálogo vía `presenter.pause(...)`.

- [ ] **Step 4: Run to verify they pass** — `node --test "tests/js/*.test.mjs"` y `npx playwright test --project=chromium --project=firefox`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ccr_viewer tests
git commit -m "feat(visor): integrar En Vivo con último hito activo, cola de lectura y estados sin conexión"
```

---

### Task 13: Aceptación con servidor real y garantías (LV-03, RO-01, SC-01, AX-01, VS-01)

Cubre §12 completo salvo PK-01.

**Files:**
- Create: `tests/browser/live-real.spec.mjs`, `tests/browser/readonly.spec.mjs`, `tests/browser/hostile.spec.mjs`, `tests/browser/a11y.spec.mjs`, `tests/browser/perf.spec.mjs`
- Modify: `tests/browser/visual.spec.mjs` (matriz VS-01), `tests/browser/server.mjs` (helper `inventory`), `tests/browser/acceptance.spec.mjs` (migración final)

**Interfaces:** consume el servidor real (`startFixtureServer`) y `fixtureOperation(run, op)` con operaciones existentes `prepare_to_discovery`, `add_check`, `transient_retention`, `retained_then_closed`, `inventory`.

- [ ] **Step 1: Escribir las pruebas**

| Archivo | Prueba → aserción |
| --- | --- |
| `live-real.spec.mjs` | **LV-03:** con `processing_archive_v5`, abrir Trazabilidad, activar En Vivo, ejecutar `add_check` desde el test: aparece una tarjeta nueva y la carga se mueve a ella; `retained_then_closed` deshabilita En Vivo y retira la carga · `transient_retention` (`retaining`) no habilita ni consuma nada · recarga tras reconexión (cerrar y reabrir el servidor SSE) no repite eventos |
| `readonly.spec.mjs` | **RO-01:** `inventory` (bytes, SHA256, tamaños, mtimes) antes y después de abrir, reproducir, seguir En Vivo y «Verificar integridad» es idéntico |
| `hostile.spec.mjs` | **SC-01:** traza interceptada con `summary:"<img src=x onerror=window.__pwned=1>"`, actor `<script>`, evidencia `javascript:alert(1)` y `../secreto`: durante el revelado y en el inspector `window.__pwned` es `undefined`, no hay nodos `img/script` creados desde datos y los enlaces permanecen inertes; metadata desconocida conservada |
| `a11y.spec.mjs` | **AX-01:** flujo completo solo con teclado (biblioteca → revisión → tabs → explorador → controles → inspector); diálogos devuelven el foco al invocador y, si ya no existe, al control estable más próximo; la región polite no repite mensajes; contraste ya cubierto en `contrast.test.mjs`; foco visible en ambos temas |
| `visual.spec.mjs` | **VS-01:** para anchos 320, 375, 768, 1024, 1440, 1920 × temas claro/oscuro × densidades cómoda/compacta (más 320 px como equivalente de zoom 400 %): sin overflow horizontal de página, controles principales visibles y objetivos ≥24×24 px; capturas en `test-results/` (no se commitean) de: último hito con carga, dos etapas del revelado, vacío, error y cerrado |
| `perf.spec.mjs` | laboratorio (solo Chromium): modelo de 10 000 eventos, 30 interacciones tras calentamiento (seleccionar punto/buscar/siguiente); mide `performance.now()` hasta la siguiente actualización visible; imprime p50/p95 y el entorno (`navigator.userAgent`, núcleos); aserción `p95 < 200` ms. Se documenta como ensayo de laboratorio, no INP |

- [ ] **Step 2: Run to verify** — `npx playwright test tests/browser/live-real.spec.mjs tests/browser/readonly.spec.mjs tests/browser/hostile.spec.mjs tests/browser/a11y.spec.mjs tests/browser/visual.spec.mjs --project=chromium`
Expected: PASS salvo defectos reales; cada fallo se corrige en el módulo responsable con una prueba de regresión en su tarea de origen, no relajando la aserción.

- [ ] **Step 3: Perfilar si `perf.spec.mjs` no cumple** — reducir render por interacción (re-render solo de la ventana/tarjeta afectada) sin perder acceso a eventos, controles ni datos originales; volver a ejecutar.

- [ ] **Step 4: Matriz completa** — `npx playwright test --project=chromium --project=firefox`
Expected: PASS en ambos navegadores (las pruebas de portapapeles y `perf` solo en Chromium).

- [ ] **Step 5: Commit**

```bash
git add tests
git commit -m "test(visor): acreditar En Vivo real, solo lectura, seguridad, accesibilidad y escala"
```

---

### Task 14: Empaquetado, documentación y verificación final (PK-01)

Cubre §12 PK-01, §13 y la regla de evidencia de AGENTS.md.

**Files:**
- Modify: `tests/test_packaging.py`, `docs/usage.md`, `README.md`, `CHANGELOG.md`, `docs/compatibility.md` (si menciona vistas)
- Create: `docs/superpowers/reviews/2026-10-10-interface-premium-verification.md`

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Pruebas que fallan** (`test_packaging.py`)

| Prueba | Aserción |
| --- | --- |
| `test_incluye_los_recursos_estaticos` | la lista cubre **todos** los archivos de `STATIC_RESOURCES` y no incluye `lifecycle.js` |
| `test_la_wheel_instalada_sirve_todos_los_recursos` (en `InstalledRunTests`) | cada clave de `STATIC_RESOURCES` responde 200 por `/assets/<clave>` con el `Content-Type` declarado y `Content-Security-Policy` igual a `CONTENT_SECURITY_POLICY`; el índice no contiene `unsafe-inline` ni `<style>`/`<script>` sin `src` |
| `test_el_paquete_no_declara_dependencias_de_ejecucion` | sigue pasando (sin `Requires-Dist`) |

- [ ] **Step 2: Run to verify** — `PYTHONPATH=src python -m unittest discover -s tests -p "test_packaging.py" -v`
Expected: la prueba nueva FALLA si algún recurso no está empaquetado/registrado; tras corregir, PASS.

- [ ] **Step 3: Documentación** — describir en `docs/usage.md` las vistas nuevas, preferencias, `?run&tab&event`, En Vivo (solo `processing`), movimiento reducido y límites (50/ventana, 10 000 eventos); entrada «Sin publicar» en `CHANGELOG.md`. No cambiar versión ni etiquetar: la publicación requiere autorización del usuario.

- [ ] **Step 4: Verificación completa y reporte**

```bash
PYTHONPATH=src python -m unittest discover -s tests -p "test_*.py" -v
node --test "tests/js/*.test.mjs"
node tools/vendor.mjs && git diff --exit-code src/ccr_viewer/web/vendor
npx playwright test --project=chromium --project=firefox
python -m pip wheel . --no-deps --wheel-dir "$(mktemp -d)"
```

Registrar en `2026-10-10-interface-premium-verification.md`: comando, fecha, totales reales por suite, entorno de laboratorio de `perf.spec.mjs`, mapa criterio→prueba (UI-01…RO-01) y los hallazgos de inspección visual (capturas revisadas manualmente: carga del último hito, dos etapas del revelado, vacío/error/cerrado). Un criterio sin evidencia se marca «no verificado».

- [ ] **Step 5: Commit y PR (sin fusionar)**

```bash
git add tests docs README.md CHANGELOG.md
git commit -m "docs(visor): documentar la interfaz premium y registrar su verificación"
git push -u origin feat/interfaz-premium   # solo con la autorización del usuario para publicar la rama
```

Abrir un PR contra `main` para revisión del usuario. La fusión y cualquier publicación requieren su autorización explícita; limpiar solo recursos temporales verificados como propios de esta tarea.

---

## Autorrevisión

**Cobertura de la spec:** §1–2 → alcance/Global Constraints; §3 → T1–T2; §4 → T3; §5 → T2, T4, T5; §6.1–6.4 → T6, T9; §7 → T7, T10; §8/8.1/8.2 → T7, T8, T12; §9 → T11; §10 → T1, T7, T9, T14; §11 → T2, T10, T12, T13; §12 → T13, T14 (UI-01 T3; UI-02 T4–T5; TR-01/02 T6/T9; TR-03 T7/T10; LV-01/02/04 T7/T12; LV-03 T8/T12/T13; RF-01 T11; AX-01 T2/T13; VS-01 T13; SC-01 T5/T13; PK-01 T14; RO-01 T13). Sin huecos conocidos.

**Consistencia de tipos:** `buildTraceModel`/`reconcileTrace` (T6) son lo que consumen `createPresenter.update` (T7), `readCoherent` (T8, devuelve vista/traza crudas) y el explorador (T9); `Presenter.state()` es la única fuente de `selectedId`, `reveal`, `pendingIds`, `loader` en T9–T12; `actorKey`/`actorLabel`/`basisShape` (T1) son los de T6 y T9.

**Proporción:** las tareas fijan interfaces, nombres de prueba y valores de la spec; los cuerpos de función los escribe quien implementa.
