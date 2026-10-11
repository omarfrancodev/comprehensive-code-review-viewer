/**
 * Punto de entrada: shell, sesión, biblioteca, pestañas de la revisión,
 * navegación local (`?run&tab&event`), preferencias y avisos en vivo.
 *
 * Navegación desde el inspector (§9): hallazgos y checks locales abren su
 * vista con destino; la evidencia abre Documentos con la clave opaca del
 * archivo; otra corrida se abre con una acción explícita que guarda en memoria
 * un único contexto previo `{run, tab, eventId}` para «Volver a la revisión
 * anterior». La dirección sigue limitada a `?run&tab&event`.
 */

import {
  bootstrapSession,
  getConfig,
  getFiles,
  getRun,
  getRuns,
  getTrace,
  subscribeNotices,
} from "./api.js";
import { createStore } from "./store.js";
import { mountExplorer } from "./explorer.js";
import { createPresenter } from "./presenter.js";
import { buildTraceModel, reconcileTrace } from "./trace-model.js";
import {
  mountLibrary,
  renderArchive,
  renderDocuments,
  renderFindings,
  renderHistory,
  renderProfile,
  renderRunHeader,
  renderValidation,
} from "./views.js";
import { campo, capturarInterfaz, elemento, listaDefinitiva, restaurarInterfaz } from "./dom.js";
import { applyPrefs, loadPrefs, prefersReducedMotion, savePrefs } from "./prefs.js";
import { buildRoute, parseRoute } from "./route.js";
import { createTabs, mountShell } from "./shell.js";

const PESTANAS = [
  { id: "ficha", etiqueta: "Resumen", render: renderProfile },
  { id: "hallazgos", etiqueta: "Hallazgos", render: renderFindings },
  { id: "validacion", etiqueta: "Validación", render: renderValidation },
  { id: "seguimiento", etiqueta: "Seguimiento", render: renderHistory },
  { id: "documentos", etiqueta: "Documentos", render: null },
  { id: "trazabilidad", etiqueta: "Trazabilidad", render: null },
  // `render` recibe `dispatch` y `{ target }` (destino de navegación): el Archivo no los usa.
  { id: "archivo", etiqueta: "Archivo", render: (contenedor, view) => renderArchive(contenedor, view) },
];

const AVISO_RUTA = "La dirección no corresponde a una revisión disponible; no se seleccionó ninguna.";
const AVISO_HITO = "El hito indicado en la dirección no existe en esta traza; se conserva la selección disponible.";
const AVISO_RESYNC = "La biblioteca se recargará para mostrar una versión coherente.";

// Presentador y modelo de la traza de la corrida seleccionada: uno por corrida,
// sobrevive a los cambios de pestaña y se destruye al cambiar de revisión.
let presentador = null;
let modeloTraza = null;
let ultimaTraza = null;
// Explorador montado en Trazabilidad y corrida a la que pertenece.
let explorador = null;
// Último aviso del presentador anunciado: `notice` persiste hasta el siguiente.
let ultimoAvisoTraza = null;
// El desplazamiento se guarda aparte: despachar en cada evento de scroll
// redibujaría la pantalla entera y perdería el foco de los controles.
let desplazamiento = 0;
let generation = 0;
let revisionRequest = 0;
let libraryRequest = 0;
let renderedState = null;
// Vista con la que se dibujó la cabecera: no se repinta si no cambia.
let cabeceraVista = null;
// Estado local de Hallazgos, Validación y Documentos (filtros y selección): se
// conserva entre recargas en vivo de la misma revisión y se descarta al cambiar.
let memoriaVistas = { clave: null };
// Última revisión, pestaña y vista dibujadas: una recarga es la misma revisión
// y pestaña con una vista nueva (y solo entonces se restaura la interfaz).
let ultimoDibujo = null;

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
// Fallo al leer `/api/config`: se muestra en la etiqueta y el diálogo de la raíz.
let errorConfiguracion = null;
// Contexto previo a abrir otra corrida desde una relación: una sola entrada,
// solo en memoria, válida mientras la revisión abierta sea la de destino.
let contextoAnterior = null;
let retornoPintado = null;

const raizDocumento = document.documentElement;
const shell = mountShell(document);
const { library: bibliotecaNodo, content: revisionNodo, tabs: barraNodo, header: cabeceraNodo } = shell.regions;
const raizBoton = document.getElementById("raiz");
const temaNodo = document.getElementById("tema");
const retornoNodo = elemento("div", { clase: "retorno-contexto", atributos: { "data-part": "return-context", hidden: true } });
cabeceraNodo.after(retornoNodo);

const store = createStore({ prefs: loadPrefs() });
const biblioteca = mountLibrary(bibliotecaNodo, { getState: store.getState, dispatch: store.dispatch });
applyPrefs(raizDocumento, store.getState().prefs);
if (temaNodo) temaNodo.value = store.getState().prefs.theme;

/** Abrir un diálogo pausa la presentación; cerrarlo no la reanuda (§7). */
function abrirDialogo(opciones) {
  presentador?.pause("dialog");
  return shell.openDialog(opciones);
}

// Ocultar la página pausa la presentación; volver a mostrarla no la reanuda.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") presentador?.pause("hidden");
});

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

/**
 * Cabecera de la revisión sobre el panel, común a todas las pestañas. Un
 * fallo al dibujarla la deja vacía: nunca impide ver la vista seleccionada.
 */
function dibujarCabecera(vista) {
  if (vista === cabeceraVista) return;
  cabeceraVista = vista;
  const conFoco = cabeceraNodo.contains(document.activeElement)
    && document.activeElement?.classList.contains("copiar-id");
  try {
    renderRunHeader(cabeceraNodo, vista);
  } catch {
    cabeceraNodo.replaceChildren();
  }
  if (conFoco) cabeceraNodo.querySelector(".copiar-id")?.focus();
}

function destruirExplorador() {
  explorador?.api.destroy();
  explorador = null;
}

/** Contexto de cierre de la vista para el presentador (En Vivo llega en la Tarea 12). */
function contextoDeTraza(vista) {
  return { closureState: vista?.closure?.state };
}

/**
 * Crea el presentador de una corrida y lo enlaza con el hito del store sin
 * reproducir nada. Arranca en pausa con el último hito; esa selección inicial
 * no se escribe en la URL: solo los cambios posteriores (navegación, avance).
 */
function crearPresentador(modelo, vista) {
  const control = createPresenter({ reducedMotion: prefersReducedMotion(store.getState().prefs) });
  control.load(modelo, contextoDeTraza(vista));
  const objetivo = store.getState().selectedEventId;
  if (objetivo) {
    if (modelo.byId.has(objetivo)) {
      control.select(objetivo, "route");
    } else {
      avisoHito = AVISO_HITO;
      shell.announce(AVISO_HITO);
      sinHistorial(() => store.dispatch({ type: "selectEvent", eventId: null }));
      reemplazarRuta();
    }
  }
  let ultimaSeleccion = control.state().selectedId;
  control.subscribe((estado) => {
    // `notice` persiste hasta el siguiente: cada ID se anuncia una sola vez.
    if (estado.notice && estado.notice.id !== ultimoAvisoTraza) {
      ultimoAvisoTraza = estado.notice.id;
      shell.announce(estado.notice.text);
    }
    if (estado.selectedId === ultimaSeleccion) return;
    ultimaSeleccion = estado.selectedId;
    if (estado.selectedId !== store.getState().selectedEventId) store.dispatch({ type: "selectEvent", eventId: estado.selectedId });
  });
  return control;
}

/** Lleva el foco a la pestaña activa si la navegación lo dejó en el cuerpo. */
function recuperarFoco() {
  queueMicrotask(() => {
    const activo = document.activeElement;
    if (activo && activo !== document.body) return;
    document.getElementById(`pestana-${store.getState().tab}`)?.focus();
  });
}

/** Pestaña que presenta un destino local (`E…`, `F…`, `C…`). */
function pestanaDeDestino(id) {
  if (id.startsWith("F")) return "hallazgos";
  if (id.startsWith("C")) return "validacion";
  return "trazabilidad";
}

/**
 * Abre otra corrida resuelta por el backend. Guarda el contexto actual (una
 * entrada) para volver; nunca busca corridas por parecido: `runKey` es la
 * clave opaca que declaró la resolución.
 */
function abrirOtraCorrida({ runKey, id, label }) {
  const estado = store.getState();
  if (typeof runKey !== "string" || !runKey || typeof id !== "string" || runKey === estado.selectedRun) return;
  contextoAnterior = {
    run: estado.selectedRun,
    tab: estado.tab,
    eventId: estado.selectedEventId,
    etiqueta: estado.view?.summary?.source_review_id ?? null,
    destino: runKey,
  };
  presentador?.pause("run");
  const tab = pestanaDeDestino(id);
  if (tab === "trazabilidad") {
    store.dispatch({ type: "selectRun", key: runKey, tab, eventId: id });
  } else {
    store.dispatch({ type: "selectRun", key: runKey, tab });
    store.dispatch({ type: "openTarget", tab, id });
  }
  shell.announce(`Se abrió la revisión ${label ?? runKey} en ${id}. «Volver a la revisión anterior» restaura el contexto previo.`);
  recuperarFoco();
}

/** Destinos del inspector que no son un hito de la traza actual. */
function navegarDesdeInspector(destino) {
  const estado = store.getState();
  if (!destino || !estado.selectedRun) return;
  if (destino.scope === "finding" || destino.scope === "check") {
    store.dispatch({ type: "openTarget", tab: destino.scope === "finding" ? "hallazgos" : "validacion", id: destino.id });
    recuperarFoco();
  } else if (destino.scope === "file" && typeof destino.fileKey === "string" && destino.fileKey) {
    // Documentos restaura el archivo recordado: se pide por su clave opaca.
    const memoria = memoriaDe(estado.selectedRun);
    memoria.documentos = { ...(memoria.documentos ?? {}), clave: destino.fileKey };
    store.dispatch({ type: "setTab", tab: "documentos" });
    recuperarFoco();
  } else if (destino.scope === "run") {
    abrirOtraCorrida(destino);
  }
}

function volverAlContextoAnterior() {
  const previo = contextoAnterior;
  if (!previo) return;
  contextoAnterior = null;
  presentador?.pause("run");
  store.dispatch({ type: "selectRun", key: previo.run, tab: previo.tab, eventId: previo.eventId ?? null });
  document.getElementById(`pestana-${store.getState().tab}`)?.focus();
}

/** Aviso con «Volver a la revisión anterior» mientras se esté en la corrida de destino. */
function pintarRetorno(estado) {
  if (contextoAnterior && estado.selectedRun !== contextoAnterior.destino) contextoAnterior = null;
  if (retornoPintado === contextoAnterior) return;
  retornoPintado = contextoAnterior;
  if (!contextoAnterior) {
    retornoNodo.hidden = true;
    retornoNodo.replaceChildren();
    return;
  }
  const { etiqueta, tab, eventId } = contextoAnterior;
  const pestana = PESTANAS.find((p) => p.id === tab)?.etiqueta ?? tab;
  const boton = elemento("button", { texto: "Volver a la revisión anterior", atributos: { type: "button" } });
  boton.addEventListener("click", volverAlContextoAnterior);
  retornoNodo.replaceChildren(
    elemento("p", {
      clase: "nota",
      texto: `Llegaste desde ${etiqueta ?? "otra revisión"} · ${pestana}${eventId ? ` · ${eventId}` : ""}.`,
    }),
    boton,
  );
  retornoNodo.hidden = false;
}

/** Selección explícita desde el explorador: el store (y la URL) la reflejan. */
function alSeleccionarHito(eventId) {
  if (eventId !== store.getState().selectedEventId) store.dispatch({ type: "selectEvent", eventId });
}

function memoriaDe(clave) {
  if (memoriaVistas.clave !== clave) memoriaVistas = { clave };
  return memoriaVistas;
}

function dibujarRevision() {
  const estado = store.getState();
  const currentGeneration = ++generation;
  // Cambiar de revisión descarta explorador y presentador; cambiar de pestaña
  // desmonta el explorador y pausa, conservando la selección de la corrida.
  if (ultimaTraza !== estado.selectedRun) {
    destruirExplorador();
    presentador?.pause("run");
    presentador?.destroy();
    presentador = null;
    modeloTraza = null;
    ultimoAvisoTraza = null;
    ultimaTraza = estado.selectedRun;
  }
  if (estado.tab !== "trazabilidad") {
    destruirExplorador();
    presentador?.pause("tab");
  }
  sincronizarPestanas(estado);
  dibujarCabecera(estado.selectedRun ? estado.view : null);
  // Recarga en vivo: foco, caret, scroll y `<details>` abiertos se capturan
  // antes de reemplazar el panel y se restauran sobre el DOM nuevo. Un cambio
  // de revisión o de pestaña nunca restaura nada.
  const previo = ultimoDibujo;
  ultimoDibujo = { run: estado.selectedRun, tab: estado.tab, view: estado.view };
  const recarga = Boolean(
    previo && estado.selectedRun && estado.view && previo.view
    && previo.run === estado.selectedRun && previo.tab === estado.tab && previo.view !== estado.view,
  );
  const instantanea = recarga ? capturarInterfaz(revisionNodo) : null;
  const restaurar = () => restaurarInterfaz(revisionNodo, instantanea);
  // Documentos conserva el DOM anterior hasta que el nuevo está listo; la
  // Trazabilidad conserva su explorador y solo recibe el modelo nuevo.
  const conservarExplorador = recarga && estado.tab === "trazabilidad" && explorador?.run === estado.selectedRun;
  const conservar = (recarga && estado.tab === "documentos") || conservarExplorador;
  if (!conservarExplorador) destruirExplorador();
  if (!conservar) revisionNodo.replaceChildren();
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
    restaurar();
  } else if (actual.render) {
    try {
      actual.render(revisionNodo, estado.view, store.dispatch, { target: estado.target, memoria: memoriaDe(estado.selectedRun) });
    } catch {
      renderArchive(revisionNodo, estado.view);
      revisionNodo.prepend(elemento("p", { clase: "estado estado--aviso", texto: "No se pudo representar la metadata de esta vista; el JSON original sigue disponible." }));
    }
    restaurar();
  } else if (actual.id === "documentos") {
    // Los documentos cargan su inventario bajo demanda.
    if (!conservar) revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando documentos…" }));
    const panel = elemento("div");
    void renderDocuments(panel, estado.view, undefined, { memoria: memoriaDe(estado.selectedRun) }).then(() => {
      if (generation !== currentGeneration) return;
      revisionNodo.replaceChildren(panel);
      restaurar();
    }).catch((error) => {
      if (generation !== currentGeneration) return;
      revisionNodo.replaceChildren(
        elemento("p", { clase: "estado estado--error", texto: `No se pudieron cargar los documentos: ${error.message}` }),
      );
    });
  } else {
    // La trazabilidad se interpreta antes de mostrarse; una recarga de la
    // misma corrida actualiza el explorador montado sin reconstruirlo.
    const clave = estado.selectedRun;
    if (!conservarExplorador) revisionNodo.append(elemento("p", { clase: "estado", texto: "Cargando trazabilidad…" }));
    void getTrace(clave)
      .then((traza) => {
        if (generation !== currentGeneration || store.getState().selectedRun !== clave) return;
        const modelo = buildTraceModel(traza);
        let diff = null;
        if (!presentador) {
          // Corrida nueva: sin modelo anterior no hay «nuevos» que comparar.
          presentador = crearPresentador(modelo, estado.view);
        } else {
          diff = reconcileTrace(modeloTraza, modelo);
          presentador.update(modelo, contextoDeTraza(estado.view), diff);
        }
        modeloTraza = modelo;
        if (explorador?.run === clave) {
          explorador.api.update(modelo, diff);
          return;
        }
        revisionNodo.replaceChildren();
        explorador = {
          run: clave,
          api: mountExplorer(revisionNodo, {
            model: modelo,
            presenter: presentador,
            runKey: clave,
            onSelect: alSeleccionarHito,
            inspector: shell.regions.inspector,
            openDialog: abrirDialogo,
            // El inventario solo se pide si un hito declara evidencia.
            inventory: () => getFiles(clave),
            onNavigate: navegarDesdeInspector,
          }),
        };
        if (avisoHito) revisionNodo.prepend(elemento("p", { clase: "estado estado--aviso", texto: avisoHito }));
        avisoHito = null;
      })
      .catch((error) => {
        if (generation !== currentGeneration) return;
        const mensaje = `No se pudo leer la trazabilidad: ${error.message}`;
        // Una recarga fallida conserva el último modelo presentado.
        if (explorador?.run === clave) {
          shell.announce(mensaje);
          return;
        }
        destruirExplorador();
        revisionNodo.replaceChildren(elemento("p", { clase: "estado estado--error", texto: mensaje }));
      });
  }
  // Un destino que ninguna vista consumió (degradación a Archivo, otra
  // pestaña) no sobrevive al dibujo: no debe reaplicarse más tarde.
  store.dispatch({ type: "clearTarget" });
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
  const previo = renderedState;
  // Se fija antes de dibujar: una vista que consume su destino despacha
  // `clearTarget` y ese redibujo anidado no debe repetir el de la vista.
  renderedState = estado;
  biblioteca.update(estado);
  pintarRetorno(estado);
  if (estado.config && previo?.config !== estado.config) {
    raizBoton.querySelector(".raiz-etiqueta").textContent = nombreBase(estado.config.root);
  }
  if (!previo || previo.view !== estado.view || previo.tab !== estado.tab || previo.selectedRun !== estado.selectedRun) dibujarRevision();
  shell.setRunSelected(estado.selectedRun, { enfocar: !restaurando });
  shell.setConnection(estado.connection);
  if (estado.resynced && !previo?.resynced) shell.announce(AVISO_RESYNC);
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

/** Store → presentador: un hito restaurado (historial) se selecciona sin reproducir. */
function suscribirHito() {
  store.subscribe((estado) => {
    const id = estado.selectedEventId;
    if (!id || !presentador || !modeloTraza || ultimaTraza !== estado.selectedRun) return;
    if (presentador.state().selectedId !== id && modeloTraza.byId.has(id)) presentador.select(id, "route");
  });
}

function suscribirPreferencias() {
  let previas = store.getState().prefs;
  store.subscribe((estado) => {
    if (estado.prefs === previas) return;
    previas = estado.prefs;
    applyPrefs(raizDocumento, estado.prefs);
    savePrefs(estado.prefs);
    presentador?.setReducedMotion(prefersReducedMotion(estado.prefs));
    if (temaNodo && temaNodo.value !== estado.prefs.theme) temaNodo.value = estado.prefs.theme;
  });
  // El movimiento reducido del sistema también puede cambiar con la página abierta.
  try {
    globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.addEventListener?.("change", () => {
      presentador?.setReducedMotion(prefersReducedMotion(store.getState().prefs));
    });
  } catch {
    // Sin `matchMedia` rige solo la preferencia local.
  }
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
  presentador?.pause("history");
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
  abrirDialogo({
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
  abrirDialogo({
    title: "Contexto de raíz",
    build(cuerpo) {
      const config = store.getState().config;
      if (!config) {
        cuerpo.append(
          errorConfiguracion
            ? elemento("p", { clase: "estado estado--error", texto: `No se pudo leer la configuración de la raíz: ${errorConfiguracion}` })
            : elemento("p", { clase: "estado", texto: "La configuración de la raíz todavía no está disponible." }),
        );
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
    // Sin configuración no hay raíz que mostrar: el fallo queda visible en la
    // etiqueta de la raíz y se anuncia; la biblioteca sigue cargando.
    errorConfiguracion = error.message;
    store.dispatch({ type: "setError", error: error.message });
    raizBoton.querySelector(".raiz-etiqueta").textContent = `Raíz no disponible: ${error.message}`;
    raizBoton.title = `No se pudo leer la configuración: ${error.message}`;
    shell.announce(`No se pudo leer la configuración de la raíz: ${error.message}`);
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
  window.addEventListener("pagehide", () => { unsubscribe(); destruirExplorador(); presentador?.destroy(); }, { once: true });

  dibujar();
}

window.addEventListener("scroll", () => {
  desplazamiento = window.scrollY;
});

iniciar();
