/**
 * Punto de entrada: shell, sesión, biblioteca, pestañas de la revisión,
 * navegación local (`?run&tab&event`), preferencias y avisos en vivo.
 */

import {
  bootstrapSession,
  getConfig,
  getRun,
  getRuns,
  getTrace,
  subscribeNotices,
} from "./api.js";
import { createStore } from "./store.js";
import { renderDocuments } from "./documents.js";
import { renderLifecycle } from "./lifecycle.js";
import { createPlayback } from "./playback.js";
import { mountLibrary, renderFindings, renderProfile, renderValidation, renderHistory, renderArchive } from "./views.js";
import { campo, elemento, listaDefinitiva } from "./dom.js";
import { applyPrefs, loadPrefs, savePrefs } from "./prefs.js";
import { buildRoute, parseRoute } from "./route.js";
import { createTabs, mountShell } from "./shell.js";

const PESTANAS = [
  { id: "ficha", etiqueta: "Resumen", render: renderProfile },
  { id: "hallazgos", etiqueta: "Hallazgos", render: renderFindings },
  { id: "validacion", etiqueta: "Validación", render: renderValidation },
  { id: "seguimiento", etiqueta: "Seguimiento", render: renderHistory },
  { id: "documentos", etiqueta: "Documentos", render: null },
  { id: "trazabilidad", etiqueta: "Trazabilidad", render: null },
  { id: "archivo", etiqueta: "Archivo", render: renderArchive },
];

const AVISO_RUTA = "La dirección no corresponde a una revisión disponible; no se seleccionó ninguna.";
const AVISO_HITO = "El hito indicado en la dirección no existe en esta traza; se conserva la selección disponible.";
const AVISO_RESYNC = "La biblioteca se recargará para mostrar una versión coherente.";

let repeticion = null;
let ultimaTraza = null;
// El desplazamiento se guarda aparte: despachar en cada evento de scroll
// redibujaría la pantalla entera y perdería el foco de los controles.
let desplazamiento = 0;
let generation = 0;
let revisionRequest = 0;
let libraryRequest = 0;
let disposeLifecycle = null;
let renderedState = null;

// Navegación local: aviso visible de la ruta, clave cuya carga viene de la
// URL o del historial, y bandera para no escribir historial al restaurarlo.
let avisoRuta = null;
let avisoHito = null;
let rutaPendiente = null;
let restaurando = false;
let historialListo = false;
// Último fallo al leer la revisión seleccionada: el panel lo muestra aunque
// una recarga posterior de la biblioteca limpie `error` del store.
let errorRevision = null;

const raizDocumento = document.documentElement;
const shell = mountShell(document);
const { library: bibliotecaNodo, content: revisionNodo, tabs: barraNodo } = shell.regions;
const raizBoton = document.getElementById("raiz");
const temaNodo = document.getElementById("tema");

const store = createStore({ prefs: loadPrefs() });
const biblioteca = mountLibrary(bibliotecaNodo, { getState: store.getState, dispatch: store.dispatch });
applyPrefs(raizDocumento, store.getState().prefs);
if (temaNodo) temaNodo.value = store.getState().prefs.theme;

const pestanas = createTabs(
  barraNodo,
  PESTANAS.map((pestana) => ({ id: pestana.id, label: pestana.etiqueta })),
  { selected: store.getState().tab, controls: revisionNodo.id, onSelect: (tab) => store.dispatch({ type: "setTab", tab }) },
);

/** Ruta local del estado: solo revisión, pestaña e hito validados. */
function rutaDe(estado) {
  if (!estado.selectedRun) return "";
  return buildRoute({ run: estado.selectedRun, tab: estado.tab, event: estado.selectedEventId });
}

/** Despacha sin escribir historial (ruta inicial, `popstate`, recuperación). */
function sinHistorial(accion) {
  const previo = restaurando;
  restaurando = true;
  try {
    accion();
  } finally {
    restaurando = previo;
  }
}

function reemplazarRuta() {
  history.replaceState(null, "", `${location.pathname}${rutaDe(store.getState())}`);
}

function avisarRuta() {
  avisoRuta = AVISO_RUTA;
  shell.announce(AVISO_RUTA);
  if (!store.getState().selectedRun) dibujarRevision();
}

/** Acción `selectRun` para una ruta: un hito sin pestaña se abre en Trazabilidad. */
function seleccionDeRuta(ruta) {
  return {
    type: "selectRun",
    key: ruta.run,
    tab: ruta.tab ?? (ruta.event ? "trazabilidad" : undefined),
    eventId: ruta.event ?? undefined,
  };
}

function sincronizarPestanas(estado) {
  const hay = Boolean(estado.selectedRun);
  barraNodo.hidden = !hay;
  if (hay) {
    revisionNodo.setAttribute("role", "tabpanel");
    pestanas.setSelected(estado.tab);
  } else {
    revisionNodo.removeAttribute("role");
    revisionNodo.removeAttribute("aria-labelledby");
  }
}

/** Enlaza la reproducción con el hito del store sin reproducir nada. */
function enlazarRepeticion(control) {
  const objetivo = store.getState().selectedEventId;
  if (objetivo) {
    if (control.event(objetivo)) {
      control.seek(objetivo);
    } else {
      avisoHito = AVISO_HITO;
      shell.announce(AVISO_HITO);
      sinHistorial(() => store.dispatch({ type: "selectEvent", eventId: null }));
      reemplazarRuta();
    }
  }
  control.subscribe((estado) => {
    const id = estado.mode === "live" ? null : estado.selectedEventId;
    if (id !== store.getState().selectedEventId) store.dispatch({ type: "selectEvent", eventId: id });
  });
}

function dibujarRevision() {
  const estado = store.getState();
  const currentGeneration = ++generation;
  disposeLifecycle?.();
  disposeLifecycle = null;
  if (estado.tab !== "trazabilidad" && repeticion?.state().mode === "playing") repeticion.pause();
  if (ultimaTraza !== estado.selectedRun) {
    repeticion?.destroy();
    repeticion = null;
    ultimaTraza = estado.selectedRun;
  }
  sincronizarPestanas(estado);
  revisionNodo.replaceChildren();
  if (!estado.selectedRun) {
    if (avisoRuta) revisionNodo.append(elemento("p", { clase: "estado estado--aviso", texto: avisoRuta }));
    revisionNodo.append(
      elemento("h2", { texto: "Selecciona una revisión" }),
      elemento("p", { clase: "estado", texto: "Las vistas de cada revisión aparecerán aquí." }),
    );
    return;
  }
  if (!estado.view) {
    if (errorRevision?.key === estado.selectedRun) {
      revisionNodo.append(elemento("p", { clase: "estado estado--error", texto: `No se pudo cargar la revisión: ${errorRevision.message}` }));
    } else {
      revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando la revisión…" }));
    }
    return;
  }
  const actual = PESTANAS.find((p) => p.id === estado.tab) ?? PESTANAS[0];
  if (actual.render && actual.id !== "archivo" && estado.view.diagnostics?.some(item => item.code === "adapter.invalid_shape")) {
    renderArchive(revisionNodo, estado.view);
    revisionNodo.prepend(elemento("p", { clase: "estado estado--aviso", texto: "La metadata contiene tipos no admitidos; consulta los diagnósticos y el JSON original." }));
  } else if (actual.render) {
    try {
      actual.render(revisionNodo, estado.view, store.dispatch);
    } catch {
      renderArchive(revisionNodo, estado.view);
      revisionNodo.prepend(elemento("p", { clase: "estado estado--aviso", texto: "No se pudo representar la metadata de esta vista; el JSON original sigue disponible." }));
    }
  } else if (actual.id === "documentos") {
    // Los documentos cargan su inventario bajo demanda.
    revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando documentos…" }));
    const panel = elemento("div");
    void renderDocuments(panel, estado.view).then(() => {
      if (generation === currentGeneration) revisionNodo.replaceChildren(panel);
    }).catch((error) => {
      if (generation !== currentGeneration) return;
      revisionNodo.replaceChildren(
        elemento("p", { clase: "estado estado--error", texto: `No se pudieron cargar los documentos: ${error.message}` }),
      );
    });
  } else {
    // La trazabilidad se interpreta antes de mostrarse.
    revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando trazabilidad…" }));
    void getTrace(estado.selectedRun)
      .then((traza) => {
        if (generation !== currentGeneration || store.getState().selectedRun !== estado.selectedRun) return;
        if (!repeticion || ultimaTraza !== estado.selectedRun) {
          ultimaTraza = estado.selectedRun;
          repeticion?.destroy();
          repeticion = createPlayback(traza.events ?? []);
          enlazarRepeticion(repeticion);
        } else {
          repeticion.ingest(traza);
        }
        disposeLifecycle = renderLifecycle(revisionNodo, traza, repeticion);
        if (avisoHito) revisionNodo.prepend(elemento("p", { clase: "estado estado--aviso", texto: avisoHito }));
        avisoHito = null;
      })
      .catch((error) => {
        if (generation !== currentGeneration) return;
        revisionNodo.replaceChildren(
          elemento("p", { clase: "estado estado--error", texto: `No se pudo leer la trazabilidad: ${error.message}` }),
        );
      });
  }
}

async function cargarBiblioteca() {
  const requestId = ++libraryRequest;
  store.dispatch({ type: "reloadLibrary" });
  try {
    const estado = store.getState();
    const pagina = await getRuns(estado.filters, estado.offset);
    if (requestId !== libraryRequest) return;
    store.dispatch({ type: "libraryLoaded", library: pagina, offset: estado.offset });
  } catch (error) {
    if (requestId !== libraryRequest) return;
    // Un fallo de recarga conserva la última lista y la marca como no actualizada.
    store.dispatch({ type: "libraryFailed", error: error.message });
  }
}

async function cargarRevision(clave) {
  if (!clave) return;
  const requestId = ++revisionRequest;
  try {
    const vista = await getRun(clave);
    if (requestId !== revisionRequest || store.getState().selectedRun !== clave) return;
    if (rutaPendiente === clave) rutaPendiente = null;
    if (errorRevision?.key === clave) errorRevision = null;
    store.dispatch({ type: "viewLoaded", view: vista });
  } catch (error) {
    if (requestId !== revisionRequest || store.getState().selectedRun !== clave) return;
    if (rutaPendiente === clave && esRevisionAusente(error)) {
      // Una clave de la URL que no existe: aviso y selección segura, sin
      // buscar otra revisión parecida. Cualquier otro fallo conserva la
      // selección, la URL y su mensaje real.
      rutaPendiente = null;
      avisarRuta();
      sinHistorial(() => store.dispatch({ type: "selectRun", key: null }));
      reemplazarRuta();
      return;
    }
    if (rutaPendiente === clave) rutaPendiente = null;
    errorRevision = { key: clave, message: error.message };
    store.dispatch({ type: "setError", error: error.message });
    if (!store.getState().view) dibujarRevision();
  }
}

/** Solo un 404 `unknown_id` significa que la corrida no existe. */
function esRevisionAusente(error) {
  return error?.status === 404 && error?.code === "unknown_id";
}

/** Último segmento de la raíz para la etiqueta compacta; el detalle muestra la ruta completa. */
function nombreBase(ruta) {
  const partes = String(ruta ?? "").split(/[\\/]+/).filter(Boolean);
  return partes.at(-1) ?? String(ruta ?? "");
}

function dibujar() {
  const estado = store.getState();
  biblioteca.update(estado);
  if (estado.config && renderedState?.config !== estado.config) {
    raizBoton.querySelector(".raiz-etiqueta").textContent = nombreBase(estado.config.root);
  }
  if (!renderedState || renderedState.view !== estado.view || renderedState.tab !== estado.tab || renderedState.selectedRun !== estado.selectedRun) dibujarRevision();
  shell.setRunSelected(estado.selectedRun, { enfocar: !restaurando });
  shell.setConnection(estado.connection);
  if (estado.resynced && !renderedState?.resynced) shell.announce(AVISO_RESYNC);
  renderedState = estado;
  // La selección y el desplazamiento se restauran tras cada redibujo.
  if (desplazamiento) window.scrollTo(0, desplazamiento);
}

/** Store → historial: `pushState` al cambiar revisión o pestaña, `replaceState` al cambiar de hito. */
function suscribirHistorial() {
  let previo = store.getState();
  store.subscribe((estado) => {
    const anterior = previo;
    previo = estado;
    if (!historialListo || restaurando) return;
    const destino = rutaDe(estado);
    if (destino === location.search) return;
    const url = `${location.pathname}${destino}`;
    if (anterior.selectedRun !== estado.selectedRun || anterior.tab !== estado.tab) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  });
}

/** Store → reproducción: un hito restaurado se selecciona sin reproducir. */
function suscribirHito() {
  store.subscribe((estado) => {
    const id = estado.selectedEventId;
    if (!id || !repeticion || ultimaTraza !== estado.selectedRun) return;
    if (repeticion.state().selectedEventId !== id && repeticion.event(id)) repeticion.seek(id);
  });
}

function suscribirPreferencias() {
  let previas = store.getState().prefs;
  store.subscribe((estado) => {
    if (estado.prefs === previas) return;
    previas = estado.prefs;
    applyPrefs(raizDocumento, estado.prefs);
    savePrefs(estado.prefs);
    if (temaNodo && temaNodo.value !== estado.prefs.theme) temaNodo.value = estado.prefs.theme;
  });
}

function aplicarRutaInicial() {
  const ruta = parseRoute(location.search);
  if (new URLSearchParams(location.search).has("run") && !ruta.run) avisarRuta();
  if (ruta.run) {
    rutaPendiente = ruta.run;
    sinHistorial(() => store.dispatch(seleccionDeRuta(ruta)));
  }
  reemplazarRuta();
  historialListo = true;
}

window.addEventListener("popstate", () => {
  if (!historialListo) return;
  if (repeticion?.state().mode === "playing") repeticion.pause();
  const ruta = parseRoute(location.search);
  const estado = store.getState();
  sinHistorial(() => {
    if (ruta.run !== estado.selectedRun) {
      rutaPendiente = ruta.run;
      store.dispatch(seleccionDeRuta(ruta));
    } else if (ruta.run) {
      store.dispatch({ type: "setTab", tab: ruta.tab ?? "ficha" });
      store.dispatch({ type: "selectEvent", eventId: ruta.event });
    }
  });
});

/** Selector de una preferencia dentro del diálogo; cada cambio se aplica y guarda. */
function selectorPreferencia(id, etiqueta, clave, opciones) {
  const bloque = elemento("div", { clase: "preferencia" });
  const selector = elemento("select", { atributos: { id } });
  for (const [valor, texto] of opciones) selector.append(elemento("option", { atributos: { value: valor }, texto }));
  selector.value = store.getState().prefs[clave];
  selector.addEventListener("change", () => store.dispatch({ type: "setPrefs", prefs: { [clave]: selector.value } }));
  bloque.append(elemento("label", { texto: etiqueta, atributos: { for: id } }), selector);
  return bloque;
}

document.getElementById("preferencias")?.addEventListener("click", () => {
  shell.openDialog({
    title: "Preferencias",
    build(cuerpo) {
      cuerpo.append(
        selectorPreferencia("preferencia-densidad", "Densidad", "density", [["comfortable", "Cómoda"], ["compact", "Compacta"]]),
        selectorPreferencia("preferencia-movimiento", "Movimiento", "motion", [["system", "Según el sistema"], ["reduce", "Reducido"]]),
        elemento("p", { clase: "nota", texto: "Tema, densidad y movimiento se guardan solo en este navegador." }),
      );
    },
  });
});

raizBoton?.addEventListener("click", () => {
  shell.openDialog({
    title: "Contexto de raíz",
    build(cuerpo) {
      const config = store.getState().config;
      if (!config) {
        cuerpo.append(elemento("p", { clase: "estado", texto: "La configuración de la raíz todavía no está disponible." }));
        return;
      }
      cuerpo.append(
        listaDefinitiva([
          campo("Ruta completa", elemento("code", { clase: "ruta-completa", texto: config.root })),
          campo("Seleccionada por", config.selected_by),
          campo("Versión del visor", config.package_version),
        ]),
        elemento("p", { clase: "nota", texto: "El visor solo lee esta raíz; no modifica sus archivos." }),
      );
    },
  });
});

temaNodo?.addEventListener("change", () => store.dispatch({ type: "setPrefs", prefs: { theme: temaNodo.value } }));

async function iniciar() {
  store.subscribe(dibujar);
  suscribirHistorial();
  suscribirHito();
  suscribirPreferencias();
  let previousFilters = store.getState().filters;
  let previousOffset = store.getState().offset;
  let previousRetry = store.getState().libraryRetry;
  let previousKey = store.getState().selectedRun;
  store.subscribe((estado) => {
    if (estado.selectedRun !== previousKey) {
      previousKey = estado.selectedRun;
      desplazamiento = 0;
      // La clave de la URL deja de estar pendiente si la selección se mueve.
      if (rutaPendiente && rutaPendiente !== previousKey) rutaPendiente = null;
      errorRevision = null;
      if (previousKey) avisoRuta = null;
      void cargarRevision(previousKey);
    }
    if (estado.filters !== previousFilters || estado.offset !== previousOffset || estado.libraryRetry !== previousRetry) {
      previousFilters = estado.filters;
      previousOffset = estado.offset;
      previousRetry = estado.libraryRetry;
      void cargarBiblioteca();
    }
  });
  try {
    await bootstrapSession(location.hash);
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
    store.dispatch({ type: "libraryFailed", error: error.message });
    return;
  }
  try {
    store.dispatch({ type: "configLoaded", config: await getConfig() });
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
  }
  aplicarRutaInicial();
  await cargarBiblioteca();

  const unsubscribe = subscribeNotices(
    (notice) => {
      const key = store.getState().selectedRun;
      if (!notice.run_key || notice.run_key === key) store.dispatch({ type: "notice", notice });
      if (["catalog_changed", "resync", "run_changed"].includes(notice.kind)) {
        void cargarBiblioteca();
      }
      if (key && (!notice.run_key || notice.run_key === key)) void cargarRevision(key);
    },
    (state) => store.dispatch({ type: "setConnection", state }),
  );
  window.addEventListener("pagehide", () => { unsubscribe(); repeticion?.destroy(); disposeLifecycle?.(); }, { once: true });

  dibujar();
}

window.addEventListener("scroll", () => {
  desplazamiento = window.scrollY;
});

iniciar();
