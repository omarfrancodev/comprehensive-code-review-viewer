/**
 * Estado transitorio de la aplicación.
 *
 * El contenido del archivo nunca pasa por aquí como instrucciones: sólo se
 * guardan la selección, la pestaña activa, el hito seleccionado, las
 * preferencias de presentación, el estado de conexión y los avisos pendientes.
 */

import { normalizeFilters, sameFilters } from "./filters.js";
import { ROUTE_TABS } from "./route.js";

const PRIORIDADES = ["P0", "P1", "P2", "P3"];

/** Cuenta hallazgos separando confirmados, no resueltos y descartados. */
export function selectFindingCounts(review) {
  const counts = {
    confirmed: Object.fromEntries(PRIORIDADES.map((p) => [p, 0])),
    totalConfirmed: 0,
    unknownPriority: 0,
    unresolved: 0,
    rejected: 0,
    candidate: 0,
  };
  const findings = Array.isArray(review?.findings) ? review.findings : [];
  for (const hallazgo of findings) {
    if (!hallazgo || typeof hallazgo !== "object") continue;
    if (hallazgo.status === "confirmed") {
      counts.totalConfirmed += 1;
      if (Object.hasOwn(counts.confirmed, hallazgo.priority)) {
        counts.confirmed[hallazgo.priority] += 1;
      } else {
        counts.unknownPriority += 1;
      }
    } else if (hallazgo.status === "unresolved") {
      counts.unresolved += 1;
    } else if (hallazgo.status === "rejected") {
      counts.rejected += 1;
    } else if (hallazgo.status === "candidate") {
      counts.candidate += 1;
    }
  }
  return counts;
}

export const ESTADO_INICIAL = {
  config: null,
  library: { items: [], total: 0, truncated: false },
  // `filters` son los filtros APLICADOS; los borradores viven en la biblioteca.
  // `libraryReady`: hubo al menos una carga correcta; `libraryStale`: la última
  // recarga falló y `library` es la última lista conocida; `libraryRetry` cuenta
  // los reintentos explícitos del usuario.
  libraryReady: false,
  libraryStale: false,
  libraryError: null,
  libraryRetry: 0,
  filters: {},
  offset: 0,
  selectedRun: null,
  view: null,
  tab: "ficha",
  // Destino de una navegación entre vistas ({tab, id}): la vista de esa pestaña
  // lo consume (selecciona y resalta) y lo limpia con `clearTarget`.
  target: null,
  scrollTop: 0,
  loading: false,
  error: null,
  newEventCount: 0,
  resynced: false,
  prefs: { theme: "system", density: "comfortable", motion: "system" },
  selectedEventId: null,
  connection: "connecting",
};

const CONEXIONES = ["connecting", "connected", "disconnected"];
const PAGINA_POR_OMISION = 50;

/** Desplazamiento de la última página que existe para `total` elementos. */
function ultimaPagina(total, limite) {
  const paso = Number.isFinite(limite) && limite > 0 ? limite : PAGINA_POR_OMISION;
  return Math.floor((total - 1) / paso) * paso;
}

/** Reductor puro: cada acción devuelve un estado nuevo. */
export function reduce(state, action) {
  switch (action?.type) {
    case "configLoaded":
      return { ...state, config: action.config, error: null };
    case "libraryLoaded": {
      let offset = action.offset ?? state.offset;
      const total = Number(action.library?.total);
      // Si la lista se acortó y la página ya no existe, se vuelve a la última.
      if (total > 0 && offset >= total) offset = ultimaPagina(total, Number(action.library?.limit));
      return {
        ...state,
        library: action.library,
        libraryReady: true,
        libraryStale: false,
        libraryError: null,
        offset,
        loading: false,
        error: null,
      };
    }
    case "libraryFailed":
      // Se conserva la última lista: un fallo de recarga no borra revisiones.
      return { ...state, libraryStale: true, libraryError: String(action.error ?? ""), loading: false };
    case "retryLibrary":
      return { ...state, libraryRetry: state.libraryRetry + 1 };
    case "selectRun": {
      const tab = ROUTE_TABS.includes(action.tab) ? action.tab : null;
      const eventId = typeof action.eventId === "string" ? action.eventId : null;
      if (action.key === state.selectedRun) {
        // Misma revisión: solo se aplican la pestaña y el hito explícitos.
        const siguiente = {
          ...state,
          tab: tab ?? state.tab,
          selectedEventId: action.eventId === undefined ? state.selectedEventId : eventId,
          target: tab && tab !== state.tab ? null : state.target,
        };
        return siguiente.tab === state.tab && siguiente.selectedEventId === state.selectedEventId ? state : siguiente;
      }
      return { ...state, selectedRun: action.key ?? null, tab: tab ?? "ficha", selectedEventId: eventId, view: null, scrollTop: 0, target: null };
    }
    case "selectEvent": {
      const eventId = typeof action.eventId === "string" ? action.eventId : null;
      return state.selectedEventId === eventId ? state : { ...state, selectedEventId: eventId };
    }
    case "viewLoaded":
      return { ...state, view: action.view, loading: false, error: null };
    case "setTab": {
      if (state.tab === action.tab) return state;
      // Un destino solo vale para su pestaña: otra pestaña lo descarta.
      return { ...state, tab: action.tab, target: state.target?.tab === action.tab ? state.target : null };
    }
    case "openTarget": {
      // Solo pestañas del vocabulario y un ID de texto no vacío.
      if (!ROUTE_TABS.includes(action.tab) || typeof action.id !== "string" || action.id === "") return state;
      return { ...state, tab: action.tab, target: { tab: action.tab, id: action.id } };
    }
    case "clearTarget":
      return state.target === null ? state : { ...state, target: null };
    case "setScroll":
      return { ...state, scrollTop: action.scrollTop };
    case "setFilters": {
      // Un filtro idéntico no es un cambio aplicado: no reinicia ni recarga.
      if (sameFilters(action.filters, state.filters)) return state;
      return { ...state, filters: normalizeFilters(action.filters), offset: 0 };
    }
    case "resetFilters":
      return Object.keys(state.filters).length === 0 && state.offset === 0 ? state : { ...state, filters: {}, offset: 0 };
    case "setOffset": {
      const offset = Number.isFinite(action.offset) ? Math.max(0, Math.trunc(action.offset)) : 0;
      return offset === state.offset ? state : { ...state, offset };
    }
    case "setLoading":
      return { ...state, loading: action.loading };
    case "setError":
      return { ...state, error: action.error, loading: false };
    case "notice":
      if (action.notice?.kind === "resync") {
        return { ...state, newEventCount: 0, resynced: true };
      }
      if (action.notice?.kind === "run_changed") {
        return { ...state, newEventCount: state.newEventCount + 1 };
      }
      return state;
    case "reloadLibrary":
      return { ...state, loading: true };
    case "clearNewEvents":
      return { ...state, newEventCount: 0 };
    case "setPrefs":
      return { ...state, prefs: { ...state.prefs, ...action.prefs } };
    case "setConnection":
      return CONEXIONES.includes(action.state) && action.state !== state.connection
        ? { ...state, connection: action.state }
        : state;
    default:
      return state;
  }
}

/** Crea un almacén mínimo con estado inmutable y suscriptores. */
export function createStore(initial = {}) {
  let state = { ...ESTADO_INICIAL, ...initial };
  const listeners = new Set();

  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return state;
      state = next;
      for (const listener of [...listeners]) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}