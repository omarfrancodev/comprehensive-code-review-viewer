/**
 * Estado transitorio de la aplicación.
 *
 * El contenido del archivo nunca pasa por aquí como instrucciones: sólo se
 * guardan la selección, la pestaña activa, el hito seleccionado, las
 * preferencias de presentación, el estado de conexión y los avisos pendientes.
 */

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
  filters: {},
  offset: 0,
  selectedRun: null,
  view: null,
  tab: "ficha",
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

/** Reductor puro: cada acción devuelve un estado nuevo. */
export function reduce(state, action) {
  switch (action?.type) {
    case "configLoaded":
      return { ...state, config: action.config, error: null };
    case "libraryLoaded":
      return {
        ...state,
        library: action.library,
        offset: action.offset ?? state.offset,
        loading: false,
        error: null,
      };
    case "selectRun": {
      const tab = ROUTE_TABS.includes(action.tab) ? action.tab : null;
      const eventId = typeof action.eventId === "string" ? action.eventId : null;
      if (action.key === state.selectedRun) {
        // Misma revisión: solo se aplican la pestaña y el hito explícitos.
        const siguiente = { ...state, tab: tab ?? state.tab, selectedEventId: action.eventId === undefined ? state.selectedEventId : eventId };
        return siguiente.tab === state.tab && siguiente.selectedEventId === state.selectedEventId ? state : siguiente;
      }
      return { ...state, selectedRun: action.key ?? null, tab: tab ?? "ficha", selectedEventId: eventId, view: null, scrollTop: 0 };
    }
    case "selectEvent": {
      const eventId = typeof action.eventId === "string" ? action.eventId : null;
      return state.selectedEventId === eventId ? state : { ...state, selectedEventId: eventId };
    }
    case "viewLoaded":
      return { ...state, view: action.view, loading: false, error: null };
    case "setTab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "setScroll":
      return { ...state, scrollTop: action.scrollTop };
    case "setFilters":
      return { ...state, filters: action.filters, offset: 0 };
    case "resetFilters":
      return { ...state, filters: {}, offset: 0 };
    case "setOffset":
      return { ...state, offset: action.offset };
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