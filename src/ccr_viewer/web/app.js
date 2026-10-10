/** Punto de entrada: sesión, biblioteca, pestañas de la revisión y avisos en vivo. */

import {
  bootstrapSession,
  getConfig,
  getRun,
  getRuns,
  subscribeNotices,
} from "./api.js";
import { createStore } from "./store.js";
import { renderFindings, renderLibrary, renderProfile, renderValidation } from "./views.js";
import { elemento } from "./dom.js";

const PESTANAS = [
  { id: "ficha", etiqueta: "Ficha", render: renderProfile },
  { id: "hallazgos", etiqueta: "Hallazgos", render: renderFindings },
  { id: "validacion", etiqueta: "Validación", render: renderValidation },
];

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
  actual.render(revisionNodo, estado.view);
  if (estado.newEventCount > 0) {
    revisionNodo.append(
      elemento("p", {
        clase: "estado estado--aviso",
        texto: `${estado.newEventCount} evento(s) nuevo(s) disponibles.`,
      }),
    );
  }
}

function dibujarAvisos(estado) {
  avisosNodo.replaceChildren();
  if (!estado.resynced) return;
  avisosNodo.append(
    elemento("p", {
      clase: "estado estado--aviso",
      texto: "La biblioteca se recargará para mostrar una versión coherente.",
    }),
  );
}

async function cargarBiblioteca() {
  store.dispatch({ type: "reloadLibrary" });
  try {
    const estado = store.getState();
    const pagina = await getRuns(estado.filters, estado.offset);
    store.dispatch({ type: "libraryLoaded", library: pagina, offset: estado.offset });
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
  }
}

async function cargarRevision(clave) {
  if (!clave) return;
  try {
    const vista = await getRun(clave);
    store.dispatch({ type: "viewLoaded", view: vista });
  } catch (error) {
    store.dispatch({ type: "setError", error: error.message });
  }
}

function dibujar() {
  const estado = store.getState();
  renderLibrary(bibliotecaNodo, estado, store.dispatch);
  if (estado.config) {
    raizNodo.textContent = `Raíz del archivo (${estado.config.selected_by}): ${estado.config.root}`;
  }
  dibujarRevision();
  dibujarAvisos(estado);
  // La selección y el desplazamiento se restauran tras cada redibujo.
  if (estado.scrollTop) window.scrollTo(0, estado.scrollTop);
}

async function iniciar() {
  store.subscribe(dibujar);
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

  store.subscribe((estado) => {
    if (estado.selectedRun !== cargarBiblioteca.claveAnterior) {
      cargarBiblioteca.claveAnterior = estado.selectedRun;
      void cargarRevision(estado.selectedRun);
    }
  });

  subscribeNotices(
    (notice) => {
      store.dispatch({ type: "notice", notice });
      if (notice.kind === "catalog_changed" || notice.kind === "resync") void cargarBiblioteca();
    },
    () => {},
  );

  dibujar();
}

window.addEventListener("scroll", () => {
  store.dispatch({ type: "setScroll", scrollTop: window.scrollY });
});

iniciar();