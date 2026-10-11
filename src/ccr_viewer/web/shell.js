/**
 * Shell del visor: regiones estables, tabs con activación manual, diálogos,
 * anunciador y biblioteca desplegable en pantallas estrechas.
 *
 * El shell no conoce datos de revisiones: recibe textos ya preparados y
 * devuelve el control a quien lo monta mediante callbacks.
 */

import { icono } from "./icons.js";

const CONEXION = {
  connecting: { texto: "Conectando…", detalle: "Conectando con el seguimiento local." },
  connected: { texto: "Conectado", detalle: "Seguimiento local conectado." },
  disconnected: { texto: "Sin conexión", detalle: "Seguimiento desconectado; intentando reconectar." },
};

let dialogos = 0;

/** Antepone un icono decorativo al contenido de `nodo`, si existe. */
function conIcono(nodo, nombre, doc) {
  if (nodo && !nodo.querySelector("svg.icono")) nodo.prepend(icono(nombre, doc));
}

/** Devuelve `true` si el elemento no se está pintando (oculto por el layout). */
function sinPintar(nodo) {
  return !nodo || !nodo.isConnected || nodo.getClientRects().length === 0;
}

/**
 * Monta el shell sobre el documento ya cargado.
 *
 * `regions` son los contenedores donde la aplicación pinta; `announce`,
 * `openDialog` y `setConnection` son las únicas vías para avisos, overlays y
 * estado de conexión. `setRunSelected` gobierna la biblioteca desplegable.
 */
export function mountShell(doc = document) {
  const porId = (id) => doc.getElementById(id);
  const regions = {
    library: porId("biblioteca"),
    header: porId("cabecera-revision"),
    tabs: porId("barra-revision"),
    content: porId("revision"),
    inspector: porId("inspector"),
    status: porId("anunciador"),
  };
  const raiz = doc.documentElement;
  const conmutador = porId("abrir-biblioteca");
  const retorno = porId("volver-revision");
  const conexion = porId("avisos");

  conIcono(porId("raiz"), "carpeta", doc);
  conIcono(porId("preferencias"), "ajustes", doc);
  conIcono(conmutador, "biblioteca", doc);
  conIcono(retorno, "volver", doc);
  conIcono(conexion, "punto", doc);

  /**
   * Región polite: un mensaje por cambio, nunca repetido por redibujos. Un
   * texto igual al vigente no se repite, salvo con `{ repeat: true }`: lo usa
   * quien ya deduplica por su propio cambio (p. ej. cada aviso de la traza,
   * con su ID). La repetición alterna un espacio final no separable para que
   * los lectores perciban un contenido nuevo.
   */
  function announce(text, { repeat = false } = {}) {
    const mensaje = String(text ?? "").trim();
    if (!mensaje || !regions.status) return;
    const vigente = regions.status.textContent;
    if (vigente.trim() === mensaje) {
      if (!repeat) return;
      regions.status.textContent = vigente === mensaje ? `${mensaje} ` : mensaje;
      return;
    }
    regions.status.textContent = mensaje;
  }

  /** Abre un `<dialog>` modal; Escape o «Cerrar» lo cierran y el foco vuelve al invocador. */
  function openDialog({ title, build }) {
    const invocador = doc.activeElement;
    const dialogo = doc.createElement("dialog");
    dialogo.className = "dialogo";
    const tituloId = `dialogo-titulo-${++dialogos}`;
    dialogo.setAttribute("aria-labelledby", tituloId);

    const marco = doc.createElement("div");
    marco.className = "dialogo-marco";
    const cabecera = doc.createElement("header");
    cabecera.className = "dialogo-cabecera";
    const titulo = doc.createElement("h2");
    titulo.id = tituloId;
    titulo.textContent = title;
    const cerrarBoton = doc.createElement("button");
    cerrarBoton.type = "button";
    cerrarBoton.className = "boton-icono";
    const cerrarTexto = doc.createElement("span");
    cerrarTexto.className = "solo-lectores";
    cerrarTexto.textContent = "Cerrar";
    cerrarBoton.append(icono("cerrar", doc), cerrarTexto);
    cabecera.append(titulo, cerrarBoton);
    const cuerpo = doc.createElement("div");
    cuerpo.className = "dialogo-cuerpo";
    marco.append(cabecera, cuerpo);
    dialogo.append(marco);

    const close = () => {
      if (dialogo.open) dialogo.close();
    };
    cerrarBoton.addEventListener("click", close);
    // Un clic fuera del marco (en el fondo) cierra, igual que Escape.
    dialogo.addEventListener("click", (evento) => {
      if (evento.target === dialogo) close();
    });
    dialogo.addEventListener("close", () => {
      dialogo.remove();
      const destino = invocador?.isConnected && !sinPintar(invocador) ? invocador : porId("contenido");
      destino?.focus?.();
    }, { once: true });

    build(cuerpo, close);
    doc.body.append(dialogo);
    dialogo.showModal();
    return close;
  }

  let conexionActual = null;
  /** Indicador compacto de conexión; solo los cambios relevantes se anuncian. */
  function setConnection(state) {
    const datos = CONEXION[state];
    if (!datos || !conexion || state === conexionActual) return;
    const anterior = conexionActual;
    conexionActual = state;
    conexion.dataset.estado = state;
    conexion.title = datos.detalle;
    let texto = conexion.querySelector(".conexion-texto");
    if (!texto) {
      texto = doc.createElement("span");
      texto.className = "conexion-texto";
      conexion.append(texto);
    }
    texto.textContent = datos.texto;
    if (state === "disconnected") announce(datos.detalle);
    else if (state === "connected" && anterior === "disconnected") announce("Seguimiento local reconectado.");
  }

  // --- Biblioteca desplegable (< 800 px) -------------------------------
  function setLibraryOpen(abierta) {
    raiz.dataset.biblioteca = abierta ? "abierta" : "cerrada";
    conmutador?.setAttribute("aria-expanded", String(abierta));
  }

  function enfocarRevision() {
    const activa = regions.tabs?.querySelector('[role="tab"][aria-selected="true"]');
    const destino = activa && !sinPintar(activa) ? activa : porId("contenido");
    destino?.focus?.();
  }

  conmutador?.addEventListener("click", () => {
    setLibraryOpen(raiz.dataset.biblioteca !== "abierta");
  });
  retorno?.addEventListener("click", () => {
    setLibraryOpen(false);
    enfocarRevision();
  });

  let revisionActual = null;
  /**
   * Informa al shell de la revisión seleccionada. Sin selección la biblioteca
   * queda abierta; al elegir una revisión se pliega y, si el foco se perdió o
   * quedó dentro de la biblioteca ya oculta, vuelve a la pestaña activa.
   * Con `enfocar: false` (ruta inicial, historial) nunca se mueve el foco.
   */
  function setRunSelected(key, { enfocar = true } = {}) {
    const anterior = revisionActual;
    revisionActual = key ?? null;
    raiz.dataset.revision = revisionActual ? "si" : "no";
    if (anterior === revisionActual) return;
    if (!revisionActual) {
      setLibraryOpen(true);
      return;
    }
    const panel = porId("panel-biblioteca");
    const activo = doc.activeElement;
    const focoPerdido = !activo || activo === doc.body || panel?.contains(activo);
    setLibraryOpen(false);
    if (enfocar && focoPerdido && sinPintar(panel)) enfocarRevision();
  }

  setLibraryOpen(true);
  return { regions, announce, openDialog, setConnection, setRunSelected };
}

/**
 * Tablist con activación manual (patrón APG): flechas, Inicio y Fin mueven el
 * foco; Enter y Espacio activan. Tabulación itinerante: solo la pestaña activa
 * tiene `tabindex=0`. Con `controls`, cada pestaña apunta a ese tabpanel y el
 * panel queda etiquetado por la pestaña activa.
 */
export function createTabs(listEl, tabs, { selected, onSelect, controls } = {}) {
  const doc = listEl.ownerDocument;
  listEl.replaceChildren();
  listEl.setAttribute("role", "tablist");
  const botones = [];
  for (const { id, label } of tabs) {
    const boton = doc.createElement("button");
    boton.type = "button";
    boton.id = `pestana-${id}`;
    boton.className = "pestana";
    boton.dataset.tab = id;
    boton.setAttribute("role", "tab");
    if (controls) boton.setAttribute("aria-controls", controls);
    boton.textContent = label;
    boton.addEventListener("click", () => onSelect?.(id));
    botones.push(boton);
    listEl.append(boton);
  }

  listEl.addEventListener("keydown", (evento) => {
    const actual = botones.indexOf(evento.target);
    if (actual < 0) return;
    const destinos = {
      ArrowRight: (actual + 1) % botones.length,
      ArrowLeft: (actual - 1 + botones.length) % botones.length,
      Home: 0,
      End: botones.length - 1,
    };
    if (!(evento.key in destinos)) return;
    evento.preventDefault();
    botones[destinos[evento.key]].focus();
  });

  function setSelected(id) {
    let activa = null;
    for (const boton of botones) {
      const es = boton.dataset.tab === id;
      boton.setAttribute("aria-selected", String(es));
      boton.tabIndex = es ? 0 : -1;
      boton.classList.toggle("pestana--activa", es);
      if (es) activa = boton;
    }
    const panel = controls ? doc.getElementById(controls) : null;
    if (panel && activa) panel.setAttribute("aria-labelledby", activa.id);
  }

  setSelected(selected ?? tabs[0]?.id);
  return { setSelected };
}
