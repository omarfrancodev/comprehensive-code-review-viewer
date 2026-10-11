/**
 * Lectura coherente y recargas coalescidas de la corrida abierta (parte pura:
 * sin DOM).
 *
 * La vista (`/api/runs/{key}`) y la traza (`/api/runs/{key}/trace`) son rutas
 * distintas. `readCoherent` lee vista A, traza y vista B; acepta el resultado
 * sólo si ambas vistas declaran el mismo cierre original y ninguna está en
 * transición. Esto DETECTA cambios observados entre rutas; NO promete una
 * transacción atómica nueva del backend: una escritura que ocurra entre dos
 * lecturas y deje el mismo cierre no es detectable desde aquí.
 *
 * `trace.chain_status === "updating"` por sí solo (corrida normal abierta) no
 * afecta la coherencia: es distinto de `view.updating` y de los diagnósticos
 * `snapshot.transition_pending` / `snapshot.transition_detected`.
 *
 * `createReloadScheduler` agrupa los avisos del servidor, mantiene como máximo
 * una recarga activa y UNA pendiente, y numera las generaciones para que quien
 * carga descarte respuestas obsoletas con `isCurrent`.
 */

/** Esperas entre reintentos cuando las vistas no son coherentes. */
export const RETRY_DELAYS_MS = [250, 500, 1000];

/** Ventana en la que varios avisos se agrupan en una sola recarga. */
export const COALESCE_MS = 100;

/** Diagnósticos que declaran una transición en curso del productor. */
const TRANSICION = new Set(["snapshot.transition_pending", "snapshot.transition_detected"]);

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const relojReal = {
  ahora: () => Date.now(),
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => clearTimeout(id),
};

/** Una vista está en transición si declara `updating` o un diagnóstico de transición. */
function enTransicion(view) {
  if (view?.updating === true) return true;
  const diagnosticos = Array.isArray(view?.diagnostics) ? view.diagnostics : [];
  return diagnosticos.some((d) => typeof d?.code === "string" && TRANSICION.has(d.code));
}

/** Mismo cierre original en A y B y ninguna de las dos en transición. */
function sonCoherentes(a, b) {
  if (enTransicion(a) || enTransicion(b)) return false;
  return JSON.stringify(a?.closure) === JSON.stringify(b?.closure);
}

/**
 * Lee vista, traza y vista de nuevo hasta obtener un conjunto coherente.
 *
 * Hace un intento inicial y hasta tres reintentos (esperas de
 * `RETRY_DELAYS_MS`). Un error al leer una vista se propaga (p. ej. la sesión
 * expirada, 403). Un error de traza con vistas coherentes devuelve
 * `trace_failed`; con vistas no coherentes se reintenta, porque la traza que
 * falló pudo pertenecer a un cierre en transición.
 */
export async function readCoherent(runKey, api, opts = {}) {
  const sleep = opts.sleep ?? dormir;
  let ultima = null;
  for (let intento = 0; intento <= RETRY_DELAYS_MS.length; intento += 1) {
    if (intento > 0) await sleep(RETRY_DELAYS_MS[intento - 1]);
    const a = await api.getRun(runKey);
    let trace = null;
    let errorTraza = null;
    try {
      trace = await api.getTrace(runKey);
    } catch (error) {
      errorTraza = error;
    }
    const b = await api.getRun(runKey);
    ultima = b ?? a ?? null;
    if (!sonCoherentes(a, b)) continue;
    if (errorTraza) return { status: "trace_failed", view: b, error: errorTraza };
    return { status: "ok", view: b, trace };
  }
  return { status: "updating", view: ultima };
}

/**
 * Planificador de recargas.
 *
 * - `request()` agrupa avisos durante `coalesceMs` y luego llama `load(generation)`.
 * - Con una carga activa, `request()` sólo marca UNA recarga pendiente; al
 *   asentarse la activa se vuelve a agrupar `coalesceMs` (para absorber avisos
 *   en ráfaga) y se ejecuta esa única recarga.
 * - Cada carga recibe una generación nueva; `cancel()` la invalida, descarta
 *   lo agrupado y lo pendiente. Quien carga verifica `isCurrent(generation)`
 *   antes de aplicar una respuesta.
 * - Un `load` que lanza (síncrono o asíncrono) se absorbe: la carga deja de
 *   estar activa y el planificador sigue operativo. Quien carga gestiona sus
 *   propios errores.
 */
export function createReloadScheduler({ load, clock = relojReal, coalesceMs = COALESCE_MS } = {}) {
  let generation = 0;
  let timer = null;
  let active = false;
  let pending = false;

  async function start() {
    active = true;
    generation += 1;
    const propia = generation;
    try {
      await load(propia);
    } catch {
      // El error lo gestiona la propia carga; aquí sólo se libera el estado.
    } finally {
      active = false;
    }
    if (pending) {
      pending = false;
      arm();
    }
  }

  function fire() {
    timer = null;
    if (active) {
      pending = true;
      return;
    }
    start();
  }

  function arm() {
    if (timer !== null) return;
    timer = clock.programar(fire, coalesceMs);
  }

  return {
    request() {
      if (active) {
        pending = true;
        return;
      }
      arm();
    },
    cancel() {
      generation += 1;
      pending = false;
      if (timer !== null) {
        clock.cancelar(timer);
        timer = null;
      }
    },
    isCurrent(candidate) {
      return candidate === generation;
    },
  };
}
