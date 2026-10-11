/**
 * Recarga en vivo de la corrida seleccionada (§8.1, §8.2, §11).
 *
 * Orquesta, con dependencias inyectadas para poder probarlo sin DOM:
 *
 * - Avisos de `/api/events` → `createReloadScheduler` (agrupa 100 ms, una carga
 *   activa más una pendiente) → `readCoherent` (vista A, traza, vista B).
 * - `ok`: vista coherente nueva, `buildTraceModel` + `reconcileTrace` contra el
 *   modelo completo anterior → `presenter.update` → `onTrace` (explorador).
 * - `updating`: se conserva el modelo con «Archivo en actualización»; el cierre
 *   parcial nunca habilita En Vivo. Se espera otro aviso o «Reintentar».
 * - `trace_failed`: se aplica solo el cierre coherente (modelo anterior) y se
 *   conserva la última traza con «Datos no actualizados».
 * - `403 session_required`: aviso fijo «La sesión caducó; relanza el visor
 *   local», sin reintentos, y `onSessionExpired` detiene el suscriptor. Nunca
 *   se busca un token en el almacenamiento.
 * - Desconexión: «Datos no actualizados» y carga estática; al reconectar se
 *   recarga antes de restablecer la carga o contar nuevos.
 *
 * Cada carga comprueba que su generación sigue vigente después de cada espera
 * y antes de escribir: cambiar de corrida (`runChanged`) cancela lo agrupado y
 * deja sin efecto la carga en curso, aunque `readCoherent` no sea abortable.
 * Las esperas de red están acotadas para que una petición colgada no bloquee
 * el planificador.
 *
 * Este contador de recargas de la traza es independiente de las recargas de
 * la biblioteca (`catalog_changed`, `resync`, `run_changed`), que gestiona la
 * aplicación por separado.
 */

import { createReloadScheduler, readCoherent } from "./live-sync.js";
import { buildTraceModel, reconcileTrace } from "./trace-model.js";

export const TEXTO_SESION = "La sesión caducó; relanza el visor local";
export const TEXTO_NO_ACTUALIZADO = "Datos no actualizados";
export const TEXTO_ACTUALIZACION = "Archivo en actualización";

/** Espera máxima de cada petición de una recarga. */
export const ESPERA_MAXIMA_MS = 15_000;

const SIN_CAMBIOS = Object.freeze({ newIds: [], changedIds: [], prefixReplaced: false });

const relojReal = {
  ahora: () => Date.now(),
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => clearTimeout(id),
};

/** Solo un 403 `session_required` significa sesión caducada. */
export function isSessionExpired(error) {
  return error?.status === 403 && error?.code === "session_required";
}

function cancelada() {
  const error = new Error("Recarga sustituida.");
  error.code = "reload_cancelled";
  return error;
}

/**
 * Crea el orquestador.
 *
 * Dependencias:
 * - `api`: `{ getRun, getTrace }`.
 * - `runKey()`: clave de la corrida seleccionada (o `null`).
 * - `trace()`: `{ presenter, model }` de la traza montada de esa corrida, o `null`.
 * - `onTrace(model, diff)`: el presentador ya recibió el modelo; actualizar la UI.
 * - `onView(view)`: vista coherente nueva de la corrida.
 * - `onStatus(status)`: banda de la fuente (`{ code, text, retry }` o `null`).
 * - `announce(text, opts)`: región polite.
 * - `onSessionExpired()`: detener el suscriptor de avisos.
 * - Opcionales: `read` (`readCoherent`), `sleep`, `clock`, `coalesceMs`, `timeoutMs`.
 */
export function createLiveReload(deps) {
  const {
    api,
    runKey,
    trace = () => null,
    onTrace = () => {},
    onView = () => {},
    onStatus = () => {},
    announce = () => {},
    onSessionExpired = () => {},
    read = readCoherent,
    sleep,
    clock = relojReal,
    coalesceMs,
    timeoutMs = ESPERA_MAXIMA_MS,
  } = deps;

  let conexion = "connecting";
  let estado = null;
  let caducada = false;
  let destruido = false;
  // Un aviso o «Reintentar» entrega la vista aunque no haya cambiado (la vista
  // activa se redibuja conservando su interfaz); una recarga por reconexión
  // solo la entrega si cambió.
  let forzarVista = false;
  let ultimaVista = null;

  const scheduler = createReloadScheduler({ load: cargar, clock, ...(coalesceMs === undefined ? {} : { coalesceMs }) });

  /** Banda de la fuente; cada cambio se publica una vez y se anuncia si procede. */
  function fijarEstado(nuevo, { anunciar = true } = {}) {
    if (destruido || (caducada && nuevo?.code !== "session")) return;
    if (estado?.code === nuevo?.code && estado?.text === nuevo?.text) return;
    estado = nuevo ? { ...nuevo } : null;
    onStatus(estado ? { ...estado } : null);
    if (estado && anunciar) announce(estado.text);
  }

  /** Estado de la banda tras una lectura correcta: solo persiste la desconexión. */
  function estadoEstable() {
    return conexion === "disconnected" ? { code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true } : null;
  }

  function caducar() {
    if (caducada || destruido) return;
    fijarEstado({ code: "session", text: TEXTO_SESION, retry: false });
    caducada = true;
    scheduler.cancel();
    trace()?.presenter?.setConnection(false);
    onSessionExpired();
  }

  /** Petición acotada en el tiempo que no se emite si la carga dejó de estar vigente. */
  function acotada(vigente, pedir) {
    if (!vigente()) return Promise.reject(cancelada());
    return new Promise((resolve, reject) => {
      const temporizador = clock.programar(() => {
        const error = new Error("La fuente no respondió a tiempo.");
        error.code = "reload_timeout";
        reject(error);
      }, timeoutMs);
      Promise.resolve()
        .then(pedir)
        .then(resolve, reject)
        .finally(() => clock.cancelar(temporizador));
    });
  }

  function entregarVista(vista, forzada) {
    let firma = null;
    try {
      firma = JSON.stringify(vista);
    } catch {
      firma = null;
    }
    if (!forzada && firma !== null && firma === ultimaVista) return;
    ultimaVista = firma;
    onView(vista);
  }

  async function cargar(generacion) {
    const clave = runKey();
    const forzada = forzarVista;
    forzarVista = false;
    if (!clave || caducada || destruido) return;
    const vigente = () => !destruido && !caducada && scheduler.isCurrent(generacion) && runKey() === clave;
    const lector = {
      getRun: (k) => acotada(vigente, () => api.getRun(k)),
      getTrace: (k) => acotada(vigente, () => api.getTrace(k)),
    };
    let resultado;
    try {
      resultado = await read(clave, lector, sleep ? { sleep } : {});
    } catch (error) {
      // La sesión caducada rige aunque la carga ya no sea vigente.
      if (isSessionExpired(error)) {
        caducar();
        return;
      }
      if (!vigente()) return;
      fijarEstado({ code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true });
      return;
    }
    if (resultado?.status === "trace_failed" && isSessionExpired(resultado.error)) {
      caducar();
      return;
    }
    if (!vigente() || !resultado) return;
    const pista = trace();
    const presentador = pista?.presenter ?? null;
    const cierre = resultado.view?.closure?.state;

    if (resultado.status === "updating") {
      // Se conserva el modelo anterior; un cierre parcial no habilita En Vivo
      // ni expulsa de él a quien ya lo sigue.
      if (presentador && pista.model) presentador.update(pista.model, { closureState: cierre, partial: true }, SIN_CAMBIOS);
      fijarEstado({ code: "updating", text: TEXTO_ACTUALIZACION, retry: true });
      return;
    }

    entregarVista(resultado.view, forzada);
    if (!vigente()) return;
    const contexto = { closureState: cierre, partial: false };
    if (resultado.status === "trace_failed") {
      // Solo el cierre nuevo; la traza anterior se conserva con su aviso.
      if (presentador && pista.model) presentador.update(pista.model, contexto, SIN_CAMBIOS);
      fijarEstado({ code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true });
      return;
    }
    if (presentador) {
      const modelo = buildTraceModel(resultado.trace);
      const diff = reconcileTrace(pista.model ?? null, modelo);
      presentador.update(modelo, contexto, diff);
      onTrace(modelo, diff);
    }
    fijarEstado(estadoEstable());
  }

  return {
    /** Aviso completo de `/api/events`: solicita una recarga de la corrida abierta. */
    notice(aviso) {
      if (destruido || caducada) return;
      const clave = runKey();
      if (!clave) return;
      if (aviso?.run_key && aviso.run_key !== clave) return;
      forzarVista = true;
      scheduler.request();
    },

    /** Estado de la conexión del canal de avisos (`connecting`/`connected`/`disconnected`). */
    connection(nuevo) {
      if (destruido || caducada || nuevo === conexion) return;
      const anterior = conexion;
      conexion = nuevo;
      const presentador = trace()?.presenter;
      if (nuevo === "disconnected") {
        presentador?.setConnection(false);
        // El shell ya anuncia la desconexión: la banda no repite el anuncio.
        if (runKey()) fijarEstado({ code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true }, { anunciar: false });
      } else if (nuevo === "connected") {
        // El presentador espera una recarga antes de restablecer la carga.
        presentador?.setConnection(true);
        if (anterior === "disconnected" && runKey()) scheduler.request();
      }
    },

    /** `false` mientras el canal esté caído o la sesión haya caducado. */
    connected() {
      return !caducada && conexion !== "disconnected";
    },

    /** «Reintentar» explícito de la banda. */
    retry() {
      if (destruido || caducada || !runKey()) return;
      forzarVista = true;
      scheduler.request();
    },

    /** Cambio de corrida: lo agrupado y la carga en curso dejan de valer. */
    runChanged() {
      if (destruido) return;
      scheduler.cancel();
      forzarVista = false;
      ultimaVista = null;
      if (!caducada) fijarEstado(runKey() ? estadoEstable() : null, { anunciar: false });
    },

    /**
     * Anuncia cada aviso del presentador una sola vez (`notice` persiste en su
     * estado hasta el siguiente). Devuelve la función para dejar de vigilarlo.
     */
    watch(presenter) {
      let ultimo = presenter.state().notice?.id ?? null;
      return presenter.subscribe((actual) => {
        if (!actual.notice || actual.notice.id === ultimo) return;
        ultimo = actual.notice.id;
        announce(actual.notice.text, { repeat: true });
      });
    },

    status() {
      return estado ? { ...estado } : null;
    },

    destroy() {
      if (destruido) return;
      scheduler.cancel();
      destruido = true;
    },
  };
}
