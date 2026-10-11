/**
 * Explorador de trazabilidad (§6): compone la franja de actores, el timeline,
 * los controles, la búsqueda, las tarjetas y el inspector (`inspector.js`)
 * sobre un `TraceModel` (Tarea 6) y un `Presenter` (Tarea 7).
 *
 * Hay una sola selección, la del presentador: actores, puntos, tarjetas,
 * deslizador y búsqueda la cambian con sus acciones y todas las superficies
 * la reflejan. Seleccionar nunca mueve el foco al inspector. Una selección o
 * una recarga actualiza solo los nodos afectados (≤50 tarjetas y marcadores).
 *
 * Revelado (§7): un único muestreador `requestAnimationFrame`, activo solo
 * mientras una tarjeta se revela con la reproducción en marcha, lee
 * `presenter.state().reveal` y escribe las etapas en esa tarjeta. Se cancela
 * al pausar, al terminar el revelado, con movimiento reducido y al desmontar.
 *
 * Sin En Vivo (Tarea 12). Las relaciones hacia otro hito de esta traza se
 * resuelven aquí como selección explícita; el resto (hallazgos, checks, otra
 * corrida, evidencia) sale por `onNavigate`.
 */

import { abrirListaActores, crearFranjaActores, etiquetasDeActores } from "./actors.js";
import { crearTarjetas } from "./cards.js";
import { botonAccion, elemento, mostrarEnPanel, textoDe } from "./dom.js";
import { mountInspector } from "./inspector.js";
import { actorKey } from "./present.js";
import { crearControles, crearTimeline } from "./timeline.js";
import { buildTraceModel, WINDOW_SIZE } from "./trace-model.js";

const ESTADO_CADENA = {
  verified: "cadena verificada",
  limited: "cadena con limitaciones",
  failed: "cadena no verificada",
  updating: "cadena en actualización",
};

const SIN_CAMBIOS = new Set();
let montajes = 0;

/** Etiqueta de la cadena: solo `verified` se rotula verificada. */
function etiquetaCadena(estado) {
  if (Object.hasOwn(ESTADO_CADENA, estado)) return ESTADO_CADENA[estado];
  return estado ? `cadena no verificada (estado «${estado}»)` : "cadena no verificada (estado no declarado)";
}

const alinear = (posicion) => Math.floor(posicion / WINDOW_SIZE) * WINDOW_SIZE;

/** Inicio de ventana dentro de `[0, total)`, alineado a 50. */
function acotar(inicio, total) {
  if (total <= 0) return 0;
  return Math.min(Math.max(0, inicio), alinear(total - 1));
}

/**
 * Monta el explorador en `container`.
 *
 * Opciones: `model`, `presenter`, `runKey`, `onSelect(eventId, source)` (tras
 * cada selección explícita), `inspector` (región del shell), `openDialog`
 * (diálogos del shell para la lista de actores), `inventory` (inventario de
 * archivos para la evidencia; ver `mountInspector`) y `onNavigate(destino)`
 * para los destinos que no son un hito de esta traza.
 */
export function mountExplorer(container, { model, presenter, runKey, onSelect, inspector, openDialog, inventory, onNavigate } = {}) {
  let modelo = model ?? buildTraceModel(null);
  let etiquetas = etiquetasDeActores(modelo.actors);
  let consulta = "";
  let resultados = null;
  let posiciones = null;
  let inicioVentana = 0;
  let inicioPagina = 0;
  let seleccionPintada;
  let seguir = true;
  let desplazarA = null;
  let scrollEsperado = 0;
  let cerrarDialogo = null;
  let cuadro = null;
  // Regiones que no siguieron un cambio no explícito por tener el foco.
  const fijadas = new Set();
  let destruido = false;
  const estado = () => presenter.state();

  const tituloId = `explorador-titulo-${++montajes}`;
  const raiz = elemento("section", { clase: "explorador", atributos: { "data-explorer": "", "aria-labelledby": tituloId } });
  const cadena = elemento("p", { clase: "explorador-cadena", atributos: { "data-part": "chain" } });
  const diagnosticos = elemento("div", { clase: "explorador-diagnosticos", atributos: { "data-part": "diagnostics" } });
  const cabecera = elemento("header", { clase: "explorador-cabecera" });
  cabecera.append(elemento("h2", { texto: "Trazabilidad", atributos: { id: tituloId } }), cadena, diagnosticos);
  const vacio = elemento("p", { clase: "estado", atributos: { "data-part": "empty", hidden: true } });

  const franja = crearFranjaActores({ onActor: alElegirActor, onVerTodos: verTodos });
  const timeline = crearTimeline({ onSelect: (id) => seleccionar(id, "timeline"), onVentana: moverVentana });
  const controles = crearControles({
    onReiniciar: () => explicita(modelo.events[0]?.event_id ?? null, () => presenter.restart(), "restart"),
    onPaso: (delta) => {
      const actual = modelo.index.get(estado().selectedId) ?? 0;
      const destino = modelo.events[Math.min(Math.max(actual + delta, 0), modelo.events.length - 1)];
      explicita(destino?.event_id ?? null, () => presenter.step(delta), "step");
    },
    onUltimo: () => explicita(modelo.lastId, () => presenter.last(), "last"),
    onAlternar: () => presenter.togglePlay(),
    onVelocidad: (valor) => presenter.setSpeed(valor),
    onCompleta: () => presenter.showComplete(),
    onSeguir: alternarSeguimiento,
    onPosicion: (posicion) => {
      const evento = modelo.events[posicion];
      if (evento) seleccionar(evento.event_id, "slider");
    },
  });
  const buscador = crearBuscador();
  const tarjetas = crearTarjetas({
    onSelect: (id) => seleccionar(id, "card"),
    onPagina: moverPagina,
    onDesplazar: alDesplazarTarjetas,
    onAccion: alAccionDeTarjeta,
  });
  raiz.append(cabecera, vacio, franja.elemento, timeline.elemento, controles.elemento, buscador.elemento, tarjetas.elemento);
  container.replaceChildren(raiz);
  const ficha = inspector
    ? mountInspector(inspector, { getModel: () => modelo, presenter, runKey, inventory, onNavigate: navegarDesdeInspector })
    : null;

  /** Un hito de esta traza se selecciona aquí; el resto lo resuelve la aplicación. */
  function navegarDesdeInspector(destino) {
    if (destruido || !destino) return;
    if (destino.scope === "event") {
      seleccionar(destino.id, "relation");
      return;
    }
    onNavigate?.(destino);
  }

  /** «Relaciones (n)»/«Evidencia (n)» de una tarjeta: selección explícita y sección desplegada, sin mover el foco. */
  function alAccionDeTarjeta(id, seccion) {
    if (destruido || !modelo.byId.has(id)) return;
    seleccionar(id, "card");
    ficha?.expand(seccion);
  }

  function crearBuscador() {
    const estadoId = `busqueda-estado-${montajes}`;
    const bloque = elemento("div", { clase: "explorador-busqueda", atributos: { "data-part": "search" } });
    const campoBusqueda = elemento("input", {
      atributos: {
        type: "search",
        "aria-label": "Buscar hitos",
        "aria-describedby": estadoId,
        placeholder: "Actor, ID, tipo, estado o resumen",
        autocomplete: "off",
      },
    });
    const resumen = elemento("p", { clase: "busqueda-estado", atributos: { id: estadoId, hidden: true } });
    const mostrar = botonAccion("Mostrar hito seleccionado", mostrarSeleccionado, { atributos: { hidden: true } });
    campoBusqueda.addEventListener("input", () => buscar(campoBusqueda.value));
    // Enter selecciona la siguiente coincidencia en secuencia (con vuelta al principio).
    campoBusqueda.addEventListener("keydown", (evento) => {
      if (evento.key !== "Enter") return;
      evento.preventDefault();
      irASiguienteCoincidencia();
    });
    bloque.append(campoBusqueda, mostrar, resumen);
    return { elemento: bloque, campo: campoBusqueda, resumen, mostrar };
  }

  const claveActorDe = (id) => (typeof id === "string" && modelo.byId.has(id) ? actorKey(modelo.byId.get(id).actor) : null);
  const totalLista = () => (resultados ? resultados.length : modelo.events.length);
  const seguirActivo = (actual) => (actual.mode === "live" ? actual.following : seguir);

  function posicionEnLista(id) {
    if (resultados) return posiciones.get(id) ?? -1;
    return modelo.index.has(id) ? modelo.index.get(id) : -1;
  }

  /** La ventana del timeline y la página de tarjetas pasan a la del hito. */
  function seguirSeleccion(id, { ventana = true, pagina = true } = {}) {
    if (!modelo.byId.has(id)) return;
    if (ventana) inicioVentana = alinear(modelo.index.get(id));
    const posicion = posicionEnLista(id);
    if (pagina && posicion >= 0) inicioPagina = alinear(posicion);
  }

  function pintarEstructura() {
    const { status, validPrefixLength } = modelo.chain;
    cadena.dataset.chainStatus = status || "unknown";
    cadena.replaceChildren(
      elemento("strong", { texto: etiquetaCadena(status) }),
      ` · Prefijo aceptado: ${validPrefixLength} ${validPrefixLength === 1 ? "hito" : "hitos"}`,
    );
    if (modelo.diagnostics.length > 0) {
      const lista = elemento("ul", { clase: "lista-simple" });
      for (const diagnostico of modelo.diagnostics) {
        const codigo = textoDe(diagnostico?.code);
        const mensaje = textoDe(diagnostico?.message) ?? textoDe(diagnostico);
        lista.append(elemento("li", { texto: codigo ? `${codigo}: ${mensaje}` : mensaje }));
      }
      diagnosticos.replaceChildren(elemento("p", { clase: "explorador-diagnosticos-titulo", texto: "Limitaciones declaradas" }), lista);
    } else if (!modelo.chain.verified) {
      diagnosticos.replaceChildren(elemento("p", { clase: "nota", texto: "La fuente no declaró diagnósticos para este estado de la cadena." }));
    } else {
      diagnosticos.replaceChildren();
    }
    diagnosticos.hidden = diagnosticos.childElementCount === 0;
    const sinHitos = modelo.events.length === 0;
    vacio.hidden = !sinHitos;
    vacio.textContent = !sinHitos ? "" : modelo.diagnostics.length > 0
      ? "La traza no pudo interpretarse; revisa los diagnósticos."
      : "Esta corrida no conserva hitos registrados.";
    for (const parte of [franja.elemento, timeline.elemento, controles.elemento, buscador.elemento, tarjetas.elemento]) {
      parte.hidden = sinHitos;
    }
  }

  function pintarListas(cambiados = SIN_CAMBIOS) {
    const actual = estado();
    const total = modelo.events.length;
    inicioVentana = acotar(inicioVentana, total);
    const finVentana = Math.min(inicioVentana + WINDOW_SIZE, total);
    timeline.render(modelo, { start: inicioVentana, end: finVentana, total }, actual.selectedId, cambiados);
    const totalPagina = totalLista();
    inicioPagina = acotar(inicioPagina, totalPagina);
    const finPagina = Math.min(inicioPagina + WINDOW_SIZE, totalPagina);
    const ids = [];
    for (let i = inicioPagina; i < finPagina; i += 1) ids.push(resultados ? resultados[i] : modelo.events[i].event_id);
    const mensaje = resultados ? `Ningún hito coincide con «${consulta.trim()}». La selección se conserva.` : "";
    tarjetas.render(modelo, ids, { start: inicioPagina, end: finPagina, total: totalPagina, busqueda: Boolean(resultados) }, etiquetas, cambiados, mensaje);
    tarjetas.sincronizar(actual, modelo);
    scrollEsperado = tarjetas.panel.scrollTop;
  }

  function pintarBusqueda() {
    const { resumen, mostrar } = buscador;
    if (!resultados) {
      resumen.hidden = true;
      resumen.textContent = "";
      if (document.activeElement === mostrar) buscador.campo.focus({ preventScroll: true });
      mostrar.hidden = true;
      return;
    }
    const n = resultados.length;
    const id = estado().selectedId;
    const oculta = typeof id === "string" && !posiciones.has(id);
    const cuantas = n === 0 ? `Sin coincidencias en ${modelo.events.length} hitos.`
      : n === 1 ? "1 coincidencia en todo el recorrido." : `${n} coincidencias en todo el recorrido.`;
    resumen.textContent = oculta ? `${cuantas} El hito seleccionado (${id}) no está entre los resultados.` : cuantas;
    resumen.hidden = false;
    // Un botón oculto no conserva el foco: pasa al campo de búsqueda.
    if (!oculta && document.activeElement === mostrar) buscador.campo.focus({ preventScroll: true });
    mostrar.hidden = !oculta;
  }

  /** Desplaza solo el panel de tarjetas hasta la del hito, si está montada. */
  function mostrarTarjeta(id) {
    const li = tarjetas.li(id);
    if (li) scrollEsperado = mostrarEnPanel(tarjetas.panel, li);
  }

  /** Región (timeline, tarjetas o franja) que contiene el foco del teclado, o `null`. */
  function regionConFoco() {
    const activo = document.activeElement;
    if (!activo || activo === document.body) return null;
    if (timeline.elemento.contains(activo)) return "timeline";
    if (tarjetas.elemento.contains(activo)) return "cards";
    if (franja.elemento.contains(activo)) return "actors";
    return null;
  }

  /**
   * Red de seguridad: si un repintado retiró el nodo enfocado de una región,
   * el foco pasa (sin desplazar) a su equivalente estable en esa región.
   */
  function conservarFoco(region, id) {
    if (!region || (document.activeElement && document.activeElement !== document.body)) return;
    const destino = region === "timeline" ? timeline.respaldoDeFoco(id)
      : region === "cards" ? tarjetas.respaldoDeFoco(id)
        : franja.respaldoDeFoco(claveActorDe(id));
    destino?.focus({ preventScroll: true });
  }

  /**
   * Refleja el estado del presentador; repinta listas solo si cambia la selección.
   *
   * Regla de foco: una selección explícita del usuario lleva timeline, página y
   * franja a la del hito. Un cambio que no es explícito (avance del recorrido,
   * llegada o recarga) no mueve la ventana de la región que tiene el foco del
   * teclado: el nodo enfocado sigue montado y la persona no vuelve a `<body>`.
   */
  function sincronizar(actual = estado()) {
    if (destruido) return;
    const id = actual.selectedId;
    const conocida = typeof id === "string" && modelo.byId.has(id);
    if (id !== seleccionPintada && (conocida || id === null)) {
      seleccionPintada = id;
      const explicitaActual = desplazarA === id;
      const region = regionConFoco();
      const fija = (nombre) => !explicitaActual && region === nombre;
      if (explicitaActual) fijadas.clear();
      else if (conocida && region) fijadas.add(region);
      franja.avisar("");
      if (conocida) seguirSeleccion(id, { ventana: !fija("timeline"), pagina: !fija("cards") });
      pintarListas();
      franja.render(modelo, etiquetas, claveActorDe(id), { seguir: !fija("actors") });
      ficha?.update();
      pintarBusqueda();
      if (conocida && (explicitaActual || seguirActivo(actual))) mostrarTarjeta(id);
      conservarFoco(region, id);
    } else {
      tarjetas.sincronizar(actual, modelo);
      timeline.seleccionar(id);
    }
    controles.sincronizar(actual, modelo, seguirActivo(actual));
    raiz.dataset.playback = actual.paused ? "paused" : "playing";
    programarMuestreo(actual);
  }

  /** Hay un revelado que avanza: la tarjeta en `revealing` con la reproducción en marcha. */
  const revelaEnCurso = (actual) => Boolean(actual.reveal && actual.reveal.progress < 1 && !actual.paused);

  function detenerMuestreo() {
    if (cuadro === null) return;
    cancelAnimationFrame(cuadro);
    cuadro = null;
  }

  function programarMuestreo(actual) {
    if (destruido || !revelaEnCurso(actual)) detenerMuestreo();
    else if (cuadro === null) cuadro = requestAnimationFrame(muestrear);
  }

  /** Un fotograma: solo la tarjeta que se revela; nunca el listado completo. */
  function muestrear() {
    cuadro = null;
    if (destruido) return;
    const actual = estado();
    if (tarjetas.revelar(actual) && revelaEnCurso(actual)) {
      cuadro = requestAnimationFrame(muestrear);
      return;
    }
    // El revelado terminó entre dos avisos del presentador (p. ej. en la
    // separación entre hitos): se refleja el estado discreto una vez.
    tarjetas.sincronizar(actual, modelo);
    controles.sincronizar(actual, modelo, seguirActivo(actual));
  }

  /**
   * Una región fijada por el foco durante el recorrido vuelve a seguir la
   * selección cuando el foco sale de ella (no al cambiar de ventana del sistema).
   */
  function alSalirFoco(nombre, region, evento) {
    if (destruido || !fijadas.has(nombre) || region.contains(evento.relatedTarget) || !document.hasFocus()) return;
    queueMicrotask(() => {
      if (destruido || !fijadas.has(nombre) || regionConFoco() === nombre) return;
      fijadas.delete(nombre);
      const id = estado().selectedId;
      if (!modelo.byId.has(id)) return;
      if (nombre === "actors") {
        franja.render(modelo, etiquetas, claveActorDe(id), { seguir: true });
        return;
      }
      const antes = nombre === "timeline" ? inicioVentana : inicioPagina;
      seguirSeleccion(id, { ventana: nombre === "timeline", pagina: nombre === "cards" });
      if ((nombre === "timeline" ? inicioVentana : inicioPagina) !== antes) pintarListas();
    });
  }

  /**
   * Acción explícita del usuario que selecciona `id`: su ventana, su página y
   * su tarjeta se muestran aunque ya fuera la selección (p. ej. tras navegar
   * por otras ventanas).
   */
  function explicita(id, accion, origen) {
    if (destruido) return;
    const previa = estado().selectedId;
    desplazarA = id;
    accion();
    desplazarA = null;
    const actual = estado().selectedId;
    if (actual === null || actual !== id) return;
    if (previa === id && !destruido) {
      seguirSeleccion(id);
      pintarListas();
      mostrarTarjeta(id);
    }
    onSelect?.(actual, origen);
  }

  function seleccionar(id, origen) {
    if (destruido || !modelo.byId.has(id)) return;
    explicita(id, () => presenter.select(id, origen), origen);
  }

  function alElegirActor(clave) {
    if (destruido) return;
    presenter.pause("actor");
    const id = modelo.firstOfActor(clave, resultados ?? undefined);
    if (!id) {
      const etiqueta = etiquetas.get(clave) ?? clave;
      franja.avisar(`Ningún hito de ${etiqueta} coincide con la búsqueda actual; la selección se conserva y la lista no se filtra.`);
      return;
    }
    franja.avisar("");
    seleccionar(id, "actor");
  }

  function verTodos() {
    if (!openDialog || destruido) return;
    presenter.pause("dialog");
    cerrarDialogo = abrirListaActores(openDialog, {
      actores: modelo.actors,
      etiquetas,
      actual: claveActorDe(estado().selectedId),
      onActor: alElegirActor,
    });
  }

  function moverVentana(delta) {
    fijadas.clear();
    inicioVentana = acotar(inicioVentana + delta * WINDOW_SIZE, modelo.events.length);
    if (!resultados) inicioPagina = inicioVentana;
    pintarListas();
  }

  function moverPagina(delta) {
    fijadas.clear();
    inicioPagina = acotar(inicioPagina + delta * WINDOW_SIZE, totalLista());
    if (!resultados) inicioVentana = inicioPagina;
    pintarListas();
  }

  function calcularResultados() {
    const limpia = consulta.trim();
    // `search("")` devuelve []: una consulta vacía no filtra.
    resultados = limpia ? modelo.search(limpia) : null;
    posiciones = resultados ? new Map(resultados.map((id, i) => [id, i])) : null;
  }

  function buscar(texto) {
    consulta = texto;
    calcularResultados();
    const id = estado().selectedId;
    if (resultados) inicioPagina = posiciones.has(id) ? alinear(posiciones.get(id)) : 0;
    else inicioPagina = inicioVentana;
    franja.avisar("");
    pintarListas();
    pintarBusqueda();
  }

  function irASiguienteCoincidencia() {
    if (!resultados || resultados.length === 0) return;
    const desde = modelo.index.get(estado().selectedId) ?? -1;
    const siguiente = resultados.find((id) => modelo.index.get(id) > desde) ?? resultados[0];
    seleccionar(siguiente, "search");
  }

  function mostrarSeleccionado() {
    buscador.campo.value = "";
    buscar("");
    focusSelected();
  }

  function alternarSeguimiento() {
    const actual = estado();
    if (actual.mode === "live") {
      presenter.setFollowing(!actual.following);
      return;
    }
    seguir = !seguir;
    if (seguir && actual.selectedId) mostrarTarjeta(actual.selectedId);
    controles.sincronizar(actual, modelo, seguir);
  }

  /** Un desplazamiento manual del panel suspende el seguimiento. */
  function alDesplazarTarjetas() {
    const arriba = tarjetas.panel.scrollTop;
    if (Math.abs(arriba - scrollEsperado) <= 1) return;
    scrollEsperado = arriba;
    const actual = estado();
    if (!seguirActivo(actual)) return;
    if (actual.mode === "live") {
      presenter.setFollowing(false);
    } else {
      seguir = false;
      controles.sincronizar(actual, modelo, false);
    }
  }

  function focusSelected() {
    const id = estado().selectedId;
    if (destruido || !modelo.byId.has(id)) return;
    seguirSeleccion(id);
    pintarListas();
    mostrarTarjeta(id);
    tarjetas.boton(id)?.focus({ preventScroll: true });
  }

  for (const [nombre, region] of [["timeline", timeline.elemento], ["cards", tarjetas.elemento], ["actors", franja.elemento]]) {
    region.addEventListener("focusout", (evento) => alSalirFoco(nombre, region, evento));
    // Navegar a mano dentro de la región (ventanas, páginas) la deja donde la persona la llevó.
    region.addEventListener("click", () => fijadas.delete(nombre));
  }

  pintarEstructura();
  sincronizar();
  const desuscribir = presenter.subscribe((actual) => sincronizar(actual));

  return {
    /** Recarga de la misma corrida: modelo nuevo sin reconstruir el explorador. */
    update(nuevo, diff) {
      if (destruido || !nuevo) return;
      modelo = nuevo;
      etiquetas = etiquetasDeActores(modelo.actors);
      if (resultados) calcularResultados();
      const cambiados = new Set(Array.isArray(diff?.changedIds) ? diff.changedIds : []);
      const actual = estado();
      const region = regionConFoco();
      pintarEstructura();
      pintarListas(cambiados);
      franja.render(modelo, etiquetas, claveActorDe(actual.selectedId));
      ficha?.update();
      pintarBusqueda();
      conservarFoco(region, actual.selectedId);
      sincronizar(actual);
    },
    focusSelected,
    destroy() {
      if (destruido) return;
      destruido = true;
      detenerMuestreo();
      desuscribir();
      cerrarDialogo?.();
      ficha?.destroy();
      raiz.remove();
    },
  };
}
