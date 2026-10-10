/**
 * Estado transitorio de la aplicación.
 *
 * El contenido del archivo nunca pasa por aquí como instrucciones: sólo se
 * guardan la selección, la pestaña activa y los avisos pendientes de recarga.
 */

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
  theme: "auto",
};

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
    case "selectRun":
      if (action.key === state.selectedRun) return state;
      return { ...state, selectedRun: action.key, tab: "ficha", view: null, scrollTop: 0 };
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
    case "setTheme":
      return { ...state, theme: action.theme };
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