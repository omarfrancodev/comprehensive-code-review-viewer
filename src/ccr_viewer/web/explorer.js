/**
 * Explorador de trazabilidad (§6): compone la franja de actores, el timeline,
 * los controles, la búsqueda, las tarjetas y un inspector mínimo sobre un
 * `TraceModel` (Tarea 6) y un `Presenter` (Tarea 7).
 *
 * Hay una sola selección, la del presentador: actores, puntos, tarjetas,
 * deslizador y búsqueda la cambian con sus acciones y todas las superficies
 * la reflejan. Seleccionar nunca mueve el foco al inspector. Una selección o
 * una recarga actualiza solo los nodos afectados (≤50 tarjetas y marcadores).
 *
 * Sin revelado animado (Tarea 10) ni En Vivo (Tarea 12). El inspector mínimo
 * lo sustituye el inspector completo de la Tarea 11; `runKey` queda para las
 * relaciones entre corridas de esa tarea.
 */

import { abrirListaActores, crearFranjaActores, etiquetasDeActores } from "./actors.js";
import { crearTarjetas } from "./cards.js";
import { botonAccion, campo, elemento, mostrarEnPanel, textoDe } from "./dom.js";
import { actorKey, actorLabel } from "./present.js";
import { crearControles, crearTimeline, nodoTiempo } from "./timeline.js";
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

/** Identidad declarada; ausente se nombra como tal, sin sustituirla por otra. */
function identidadDe(valor, ausente) {
  if (actorKey(valor) === "∅") return ausente;
  const etiqueta = actorLabel(valor);
  const proveedor = typeof valor?.provider_id === "string" ? valor.provider_id.trim() : "";
  return proveedor && proveedor !== etiqueta ? `${etiqueta} (${proveedor})` : etiqueta;
}

/**
 * Inspector mínimo en la región del shell: ID como encabezado, resumen,
 * actor/registrador/ejecutor diferenciados y relaciones declaradas como texto.
 */
function crearInspectorMinimo(region) {
  const raiz = elemento("div", { clase: "inspector-minimo", atributos: { "data-part": "inspector" } });
  region.replaceChildren(raiz);
  region.hidden = false;
  return {
    render(modelo, id, etiquetas) {
      const evento = typeof id === "string" ? modelo.byId.get(id) : undefined;
      raiz.setAttribute("data-event-id", evento ? id : "");
      const rotulo = elemento("p", { clase: "inspector-rotulo", texto: "Hito seleccionado" });
      if (!evento) {
        raiz.replaceChildren(rotulo, elemento("p", { clase: "estado", texto: "Sin hito seleccionado." }));
        return;
      }
      const vacio = { textoVacio: "No declarado" };
      const datos = elemento("dl", { clase: "campos inspector-campos" });
      datos.append(
        campo("Secuencia", textoDe(evento.sequence), vacio),
        campo("Tipo", textoDe(evento.kind), vacio),
        campo("Estado original", textoDe(evento.status), vacio),
        campo("Tiempo", nodoTiempo(evento)),
        campo("Actor", etiquetas.get(actorKey(evento.actor)) ?? actorLabel(evento.actor)),
        campo("Registrador", identidadDe(evento.recorder, "Registrador no declarado")),
        campo("Ejecutor", identidadDe(evento.executor, "Ejecutor no declarado")),
      );
      const { outgoing, incoming } = modelo.relationsOf(id);
      const relaciones = elemento("section", { clase: "inspector-relaciones" });
      relaciones.append(elemento("h3", { texto: "Relaciones declaradas" }));
      if (outgoing.length + incoming.length === 0) {
        relaciones.append(elemento("p", { clase: "estado", texto: "Este hito no declara relaciones." }));
      } else {
        const lista = elemento("ul", { clase: "lista-simple" });
        for (const relacion of [...outgoing, ...incoming]) {
          const estado = textoDe(relacion.status) ?? "sin estado declarado";
          lista.append(elemento("li", {
            clase: "inspector-relacion",
            texto: `${textoDe(relacion.event_id) ?? "?"} ${textoDe(relacion.relation) ?? "relación"} ${textoDe(relacion.target) ?? "?"} · ${estado}`,
            atributos: { "data-relation-status": typeof relacion.status === "string" ? relacion.status : "" },
          }));
        }
        relaciones.append(lista);
      }
      raiz.replaceChildren(
        rotulo,
        elemento("h2", { clase: "inspector-id", texto: id }),
        elemento("p", { clase: "inspector-resumen", texto: textoDe(evento.summary) ?? "Sin resumen declarado." }),
        datos,
        relaciones,
      );
    },
    destroy() {
      region.replaceChildren();
      region.hidden = true;
    },
  };
}

/**
 * Monta el explorador en `container`.
 *
 * Opciones: `model`, `presenter`, `runKey`, `onSelect(eventId, source)` (tras
 * cada selección explícita), `inspector` (región del shell) y `openDialog`
 * (diálogos del shell para la lista de actores).
 */
export function mountExplorer(container, { model, presenter, runKey, onSelect, inspector, openDialog } = {}) {
  void runKey;
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
  const tarjetas = crearTarjetas({ onSelect: (id) => seleccionar(id, "card"), onPagina: moverPagina, onDesplazar: alDesplazarTarjetas });
  raiz.append(cabecera, vacio, franja.elemento, timeline.elemento, controles.elemento, buscador.elemento, tarjetas.elemento);
  container.replaceChildren(raiz);
  const ficha = inspector ? crearInspectorMinimo(inspector) : null;

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
  function seguirSeleccion(id) {
    if (!modelo.byId.has(id)) return;
    inicioVentana = alinear(modelo.index.get(id));
    const posicion = posicionEnLista(id);
    if (posicion >= 0) inicioPagina = alinear(posicion);
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
    mostrar.hidden = !oculta;
  }

  /** Desplaza solo el panel de tarjetas hasta la del hito, si está montada. */
  function mostrarTarjeta(id) {
    const li = tarjetas.li(id);
    if (li) scrollEsperado = mostrarEnPanel(tarjetas.panel, li);
  }

  /** Refleja el estado del presentador; repinta listas solo si cambia la selección. */
  function sincronizar(actual = estado()) {
    if (destruido) return;
    const id = actual.selectedId;
    const conocida = typeof id === "string" && modelo.byId.has(id);
    if (id !== seleccionPintada && (conocida || id === null)) {
      seleccionPintada = id;
      franja.avisar("");
      if (conocida) seguirSeleccion(id);
      pintarListas();
      franja.render(modelo, etiquetas, claveActorDe(id), { seguir: true });
      ficha?.render(modelo, id, etiquetas);
      pintarBusqueda();
      if (conocida && (desplazarA === id || seguirActivo(actual))) mostrarTarjeta(id);
    } else {
      tarjetas.sincronizar(actual, modelo);
      timeline.seleccionar(id);
    }
    controles.sincronizar(actual, modelo, seguirActivo(actual));
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
    inicioVentana = acotar(inicioVentana + delta * WINDOW_SIZE, modelo.events.length);
    if (!resultados) inicioPagina = inicioVentana;
    pintarListas();
  }

  function moverPagina(delta) {
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
      pintarEstructura();
      pintarListas(cambiados);
      franja.render(modelo, etiquetas, claveActorDe(actual.selectedId));
      ficha?.render(modelo, actual.selectedId, etiquetas);
      pintarBusqueda();
      sincronizar(actual);
    },
    focusSelected,
    destroy() {
      if (destruido) return;
      destruido = true;
      desuscribir();
      cerrarDialogo?.();
      ficha?.destroy();
      raiz.remove();
    },
  };
}
