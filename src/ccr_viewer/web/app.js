/** Punto de entrada: sesión, biblioteca, pestañas de la revisión y avisos en vivo. */

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
import { renderFindings, renderLibrary, renderProfile, renderValidation, renderHistory, renderArchive } from "./views.js";
import { elemento } from "./dom.js";

const PESTANAS = [
  { id: "ficha", etiqueta: "Ficha", render: renderProfile },
  { id: "hallazgos", etiqueta: "Hallazgos", render: renderFindings },
  { id: "validacion", etiqueta: "Validación", render: renderValidation },
  { id: "seguimiento", etiqueta: "Seguimiento", render: renderHistory },
  { id: "documentos", etiqueta: "Documentos", render: null },
  { id: "trazabilidad", etiqueta: "Trazabilidad", render: null },
  { id: "archivo", etiqueta: "Archivo", render: renderArchive },
];

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
let connectionState = "connecting";

const store = createStore();
const bibliotecaNodo = document.getElementById("biblioteca");
const revisionNodo = document.getElementById("revision");
const raizNodo = document.getElementById("raiz");
const barraNodo = document.getElementById("barra-revision");
const avisosNodo = document.getElementById("avisos");

function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema === "auto" ? "" : tema;
}

function barraPestanas() {
  barraNodo.replaceChildren();
  if (!store.getState().selectedRun) return;
  const lista = elemento("div", { clase: "pestanas", atributos: { role: "tablist" } });
  for (const pestana of PESTANAS) {
    const activa = store.getState().tab === pestana.id;
    const boton = elemento("button", {
      clase: activa ? "pestana pestana--activa" : "pestana",
      atributos: {
        type: "button",
        role: "tab",
        "aria-selected": activa ? "true" : "false",
        "data-tab": pestana.id,
      },
      texto: pestana.etiqueta,
    });
    boton.addEventListener("click", () => store.dispatch({ type: "setTab", tab: pestana.id }));
    lista.append(boton);
  }
  barraNodo.append(lista);
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
  barraPestanas();
  revisionNodo.replaceChildren();
  if (!estado.selectedRun) {
    revisionNodo.append(
      elemento("h2", { texto: "Selecciona una revisión" }),
      elemento("p", { clase: "estado", texto: "Las vistas de cada revisión aparecerán aquí." }),
    );
    return;
  }
  if (!estado.view) {
    revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando la revisión…" }));
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
        } else {
          repeticion.ingest(traza);
        }
        disposeLifecycle = renderLifecycle(revisionNodo, traza, repeticion);
      })
      .catch((error) => {
        if (generation !== currentGeneration) return;
        revisionNodo.replaceChildren(
          elemento("p", { clase: "estado estado--error", texto: `No se pudo leer la trazabilidad: ${error.message}` }),
        );
      });
  }
}

function dibujarAvisos(estado) {
  avisosNodo.replaceChildren();
  const label = { connecting: "Conectando seguimiento…", connected: "Seguimiento conectado", disconnected: "Seguimiento desconectado; intentando reconectar." }[connectionState];
  avisosNodo.append(elemento("p", { clase: "estado", texto: label }));
  if (!estado.resynced) return;
  avisosNodo.append(
    elemento("p", {
      clase: "estado estado--aviso",
      texto: "La biblioteca se recargará para mostrar una versión coherente.",
    }),
  );
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
    store.dispatch({ type: "setError", error: error.message });
  }
}

async function cargarRevision(clave) {
  if (!clave) return;
  const requestId = ++revisionRequest;
  try {
    const vista = await getRun(clave);
    if (requestId !== revisionRequest || store.getState().selectedRun !== clave) return;
    store.dispatch({ type: "viewLoaded", view: vista });
  } catch (error) {
    if (requestId !== revisionRequest || store.getState().selectedRun !== clave) return;
    store.dispatch({ type: "setError", error: error.message });
  }
}

function dibujar() {
  const estado = store.getState();
  if (!renderedState || renderedState.library !== estado.library || renderedState.filters !== estado.filters || renderedState.selectedRun !== estado.selectedRun || renderedState.error !== estado.error) renderLibrary(bibliotecaNodo, estado, store.dispatch);
  if (estado.config) {
    raizNodo.textContent = `Raíz del archivo (${estado.config.selected_by}): ${estado.config.root}`;
  }
  if (!renderedState || renderedState.view !== estado.view || renderedState.tab !== estado.tab || renderedState.selectedRun !== estado.selectedRun) dibujarRevision();
  aplicarTema(estado.theme);
  dibujarAvisos(estado);
  renderedState = estado;
  // La selección y el desplazamiento se restauran tras cada redibujo.
  if (desplazamiento) window.scrollTo(0, desplazamiento);
}

async function iniciar() {
  store.subscribe(dibujar);
  let previousFilters = store.getState().filters;
  let previousOffset = store.getState().offset;
  let previousKey = store.getState().selectedRun;
  store.subscribe((estado) => {
    if (estado.selectedRun !== previousKey) {
      previousKey = estado.selectedRun;
      desplazamiento = 0;
      void cargarRevision(previousKey);
    }
    if (estado.filters !== previousFilters || estado.offset !== previousOffset) {
      previousFilters = estado.filters;
      previousOffset = estado.offset;
      void cargarBiblioteca();
    }
  });
  try {
    await bootstrapSession(location.hash);
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
    return;
  }
  try {
    store.dispatch({ type: "configLoaded", config: await getConfig() });
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
  }
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
    state => { connectionState = state; dibujarAvisos(store.getState()); },
  );
  window.addEventListener("pagehide", () => { unsubscribe(); repeticion?.destroy(); disposeLifecycle?.(); }, { once: true });

  dibujar();
}

window.addEventListener("scroll", () => {
  desplazamiento = window.scrollY;
});

document.getElementById("tema")?.addEventListener("change", event => store.dispatch({ type: "setTheme", theme: event.target.value }));
document.getElementById("abrir-biblioteca")?.addEventListener("click", event => {
  const open = document.body.classList.toggle("biblioteca-abierta");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

iniciar();
