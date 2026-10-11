/**
 * Biblioteca: búsqueda, filtros tipados, lista compacta agrupada por
 * repositorio y paginación.
 *
 * `mountLibrary` construye la barra una sola vez y `update` solo repinta la
 * región de la lista, la paginación y los chips: el input de búsqueda conserva
 * foco, caret y valor aunque la fuente se recargue. Los filtros del almacén son
 * los APLICADOS; los cambios avanzados son borradores del formulario hasta
 * «Aplicar». Todo texto de archivo entra por `textContent`.
 */

import { campo, elemento } from "./dom.js";
import {
  KINDS,
  PROFILES,
  VERDICTS,
  filterChips,
  normalizeFilters,
  suggestFromPage,
  validateFilters,
} from "./filters.js";
import { formatInstant, labelRuns } from "./present.js";

const ESTADOS = {
  closed: "cerrada",
  open_activity_unknown: "abierta, actividad desconocida",
  open_recent_activity: "abierta, actividad reciente",
  result_available_closure_pending: "resultado disponible, cierre pendiente",
  interruption_recorded: "interrupción registrada",
};

const ESPERA_BUSQUEDA_MS = 250;
const OTRO = "__otro__";
const POR_PAGINA = 50;

// Controles del formulario avanzado, en el orden en que se presentan.
const CONTROLES = [
  { clave: "repository", etiqueta: "Repositorio", tipo: "texto" },
  { clave: "verdict", etiqueta: "Veredicto", tipo: "enum", valores: VERDICTS },
  { clave: "profile", etiqueta: "Perfil", tipo: "enum", valores: PROFILES },
  { clave: "mode", etiqueta: "Modo", tipo: "texto" },
  { clave: "reference", etiqueta: "Referencia", tipo: "texto" },
  { clave: "kind", etiqueta: "Tipo", tipo: "enum", valores: KINDS },
  { clave: "open", etiqueta: "Abiertas o cerradas", tipo: "apertura" },
  { clave: "date_from", etiqueta: "Desde", tipo: "fecha" },
  { clave: "date_to", etiqueta: "Hasta", tipo: "fecha" },
];
const SUGERIBLES = ["repository", "mode", "reference"];

/** Último segmento del repositorio declarado, para la fila compacta. */
function repositorioCorto(identidad) {
  const partes = String(identidad ?? "").split(/[\\/]+/).filter(Boolean);
  return partes.at(-1) ?? String(identidad ?? "");
}

function textoNoVacio(valor) {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

/**
 * Repositorio tal como se declaró (`repository_label`). La identidad
 * normalizada (sin esquema ni `.git`) es solo para comparar: se muestra
 * únicamente si falta la declarada.
 */
function repositorioDe(item) {
  return textoNoVacio(item.repository_label) ?? textoNoVacio(item.repository_identity);
}

/** Clave de agrupación: la identidad normalizada; sin ella, la etiqueta declarada. */
function grupoDe(item) {
  const identidad = textoNoVacio(item.repository_identity);
  if (identidad !== null) return `identidad:${identidad}`;
  const etiqueta = textoNoVacio(item.repository_label);
  return etiqueta === null ? null : `etiqueta:${etiqueta}`;
}

function estadoLegible(item) {
  return ESTADOS[item.display_state] ?? item.display_state ?? "estado desconocido";
}

/** Fecha compacta tal como la compara el filtro (día del valor original). */
function fechaCompacta(valor) {
  const instante = formatInstant(valor);
  if (instante.original === null) return null;
  const dia = /^\d{4}-\d{2}-\d{2}/.exec(instante.original)?.[0] ?? null;
  const titulo = instante.local
    ? `Hora local: ${instante.local} · UTC: ${instante.utc} · Origen: ${instante.original}`
    : `Valor sin interpretar: ${instante.original}`;
  return { texto: dia ?? instante.original, original: instante.original, titulo };
}

function filaDetalle(item, etiqueta) {
  const lista = elemento("dl", { clase: "campos revision-campos" });
  const repositorio = repositorioDe(item);
  const fechas = (valor) => fechaCompacta(valor)?.original ?? null;
  for (const [nombre, valor] of [
    ["Título", etiqueta.label],
    ["ID de revisión", textoNoVacio(item.source_review_id)],
    ["Repositorio", repositorio],
    ["Alcance", textoNoVacio(item.scope_label)],
    ["Referencia", item.scope_reference === null || item.scope_reference === undefined ? null : String(item.scope_reference)],
    ["Estado", item.display_state ? `${estadoLegible(item)} (${item.display_state})` : null],
    ["Estado del archivo", textoNoVacio(item.archive_state)],
    ["Veredicto", textoNoVacio(item.verdict)],
    ["Perfil", textoNoVacio(item.profile)],
    ["Tipo", textoNoVacio(item.presentation_kind)],
    ["Creada", fechas(item.created_at)],
    ["Último registro", fechas(item.last_recorded_at)],
    ["Último cambio detectado por el visor", fechas(item.last_observed_change_at)],
    ["Fase registrada", textoNoVacio(item.phase)],
    ["Clave", textoNoVacio(item.key)],
  ]) {
    if (valor !== null) lista.append(campo(nombre, valor));
  }
  return lista;
}

/**
 * Monta la biblioteca en `container` y devuelve `{ update(state) }`.
 *
 * `getState` y `dispatch` son los del almacén. Las acciones que emite son
 * `setFilters`, `resetFilters`, `setOffset`, `selectRun` y `retryLibrary`.
 */
export function mountLibrary(container, { getState, dispatch }) {
  const doc = container.ownerDocument;
  container.replaceChildren();

  // --- Barra: búsqueda, chips Todas/Abiertas y botón de filtros -----------
  const busqueda = elemento("input", {
    atributos: {
      id: "biblioteca-busqueda",
      type: "search",
      name: "q",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "Repositorio, alcance o ID",
    },
  });
  const bloqueBusqueda = elemento("div", { clase: "biblioteca-busqueda", atributos: { role: "search" } });
  bloqueBusqueda.append(
    elemento("label", { clase: "solo-lectores", texto: "Buscar revisiones", atributos: { for: "biblioteca-busqueda" } }),
    busqueda,
  );

  const botonTodas = elemento("button", { clase: "chip-rapido", texto: "Todas", atributos: { type: "button", "aria-pressed": "true" } });
  const botonAbiertas = elemento("button", { clase: "chip-rapido", texto: "Abiertas", atributos: { type: "button", "aria-pressed": "false" } });
  const botonFiltros = elemento("button", {
    clase: "filtros-boton",
    texto: "Filtros",
    atributos: { type: "button", "aria-expanded": "false", "aria-controls": "filtros-avanzados" },
  });
  const rapidos = elemento("div", { clase: "biblioteca-rapidos" });
  const grupoRapidos = elemento("div", {
    clase: "chips-rapidos",
    atributos: { role: "group", "aria-label": "Estado de las revisiones" },
  });
  grupoRapidos.append(botonTodas, botonAbiertas);
  rapidos.append(grupoRapidos, botonFiltros);

  // --- Formulario avanzado (borradores hasta «Aplicar») -------------------
  const formulario = elemento("form", {
    clase: "filtros-avanzados",
    atributos: { id: "filtros-avanzados", "aria-label": "Filtros avanzados", novalidate: true, hidden: true },
  });
  const controles = {}; // clave → { leer, escribir, nodo }
  const errores = {}; // clave → <p> del mensaje
  const listas = {}; // clave → { datalist, nota }

  function entradaFiltro(clave, etiqueta) {
    return elemento("label", { texto: etiqueta, atributos: { for: `filtro-${clave}` } });
  }

  for (const definicion of CONTROLES) {
    const { clave, etiqueta, tipo } = definicion;
    const bloque = elemento("div", { clase: "filtro-campo" });
    bloque.append(entradaFiltro(clave, etiqueta));
    if (tipo === "texto") {
      const lista = elemento("datalist", { atributos: { id: `sugerencias-${clave}` } });
      const nota = elemento("p", { clase: "nota filtro-sugerencias", atributos: { id: `nota-${clave}` } });
      const entrada = elemento("input", {
        atributos: { id: `filtro-${clave}`, name: clave, type: "text", list: lista.id, autocomplete: "off", "aria-describedby": nota.id },
      });
      bloque.append(entrada, lista, nota);
      controles[clave] = { nodo: entrada, leer: () => entrada.value, escribir: (valor) => { entrada.value = valor; } };
      listas[clave] = { datalist: lista, nota };
    } else if (tipo === "enum") {
      const selector = elemento("select", { atributos: { id: `filtro-${clave}`, name: clave } });
      selector.append(elemento("option", { texto: "Cualquiera", atributos: { value: "" } }));
      for (const valor of definicion.valores) selector.append(elemento("option", { texto: valor, atributos: { value: valor } }));
      selector.append(elemento("option", { texto: "Otro valor…", atributos: { value: OTRO } }));
      const libre = elemento("input", {
        clase: "filtro-otro",
        atributos: {
          id: `filtro-${clave}-otro`,
          type: "text",
          autocomplete: "off",
          placeholder: "Valor original",
          "aria-label": `Valor original de ${etiqueta}`,
          hidden: true,
        },
      });
      const alternar = () => { libre.hidden = selector.value !== OTRO; };
      selector.addEventListener("change", () => {
        alternar();
        if (selector.value === OTRO) libre.focus();
      });
      bloque.append(selector, libre);
      controles[clave] = {
        nodo: selector,
        leer: () => (selector.value === OTRO ? libre.value : selector.value),
        escribir(valor) {
          if (valor === "" || definicion.valores.includes(valor)) {
            selector.value = valor;
            libre.value = "";
          } else {
            selector.value = OTRO;
            libre.value = valor;
          }
          alternar();
        },
      };
    } else if (tipo === "apertura") {
      const selector = elemento("select", { atributos: { id: `filtro-${clave}`, name: clave } });
      for (const [valor, texto] of [["", "Todas"], ["true", "Abiertas"], ["false", "Cerradas"]]) {
        selector.append(elemento("option", { texto, atributos: { value: valor } }));
      }
      bloque.append(selector);
      controles[clave] = { nodo: selector, leer: () => selector.value, escribir: (valor) => { selector.value = valor; } };
    } else {
      const entrada = elemento("input", { atributos: { id: `filtro-${clave}`, name: clave, type: "date" } });
      const error = elemento("p", { clase: "filtro-error", atributos: { id: `error-${clave}`, hidden: true } });
      bloque.append(entrada, error);
      controles[clave] = { nodo: entrada, leer: () => entrada.value, escribir: (valor) => { entrada.value = valor; } };
      errores[clave] = error;
    }
    formulario.append(bloque);
  }

  const aplicar = elemento("button", { clase: "boton-primario", texto: "Aplicar", atributos: { type: "submit" } });
  const cancelar = elemento("button", { texto: "Cancelar", atributos: { type: "button" } });
  const botonesFormulario = elemento("div", { clase: "filtro-botones" });
  botonesFormulario.append(aplicar, cancelar);
  formulario.append(botonesFormulario);

  // --- Filtros aplicados --------------------------------------------------
  const chips = elemento("ul", { clase: "filtros-aplicados", atributos: { "aria-label": "Filtros aplicados", hidden: true } });
  const limpiar = elemento("button", { clase: "filtros-limpiar", texto: "Limpiar", atributos: { type: "button", hidden: true } });

  // --- Lista, estados y paginación ---------------------------------------
  const regionLista = elemento("div", { clase: "biblioteca-lista", atributos: { tabindex: "-1", "aria-busy": "false" } });
  const resumen = elemento("p", { clase: "biblioteca-resumen" });
  const limitaciones = elemento("p", { clase: "nota biblioteca-limitaciones", atributos: { hidden: true } });
  const anterior = elemento("button", { texto: "Página anterior", atributos: { type: "button" } });
  const siguiente = elemento("button", { texto: "Página siguiente", atributos: { type: "button" } });
  const botonesPagina = elemento("div", { clase: "paginacion-botones" });
  botonesPagina.append(anterior, siguiente);
  const paginacion = elemento("nav", { clase: "paginacion", atributos: { "aria-label": "Páginas de la biblioteca", hidden: true } });
  paginacion.append(resumen, limitaciones, botonesPagina);

  const barra = elemento("div", { clase: "biblioteca-barra" });
  barra.append(bloqueBusqueda, rapidos, formulario, chips, limpiar);
  container.append(elemento("h2", { texto: "Revisiones" }), barra, regionLista, paginacion);

  // --- Estado local del componente ---------------------------------------
  let temporizador = null;
  const detallesAbiertos = new Set();
  let previo = {};
  // Filtros aplicados que vio el formulario por última vez (normalizados).
  let aplicadosVistos = {};

  const filtrosAplicados = () => getState().filters ?? {};
  const aplicarFiltros = (nuevos) => dispatch({ type: "setFilters", filters: normalizeFilters(nuevos) });

  // --- Búsqueda: Enter inmediato, o 250 ms sin escribir -------------------
  function aplicarBusqueda() {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = null;
    const q = busqueda.value.trim();
    const actuales = filtrosAplicados();
    if ((actuales.q ?? "") === q) return;
    aplicarFiltros({ ...actuales, q });
  }

  busqueda.addEventListener("input", () => {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(aplicarBusqueda, ESPERA_BUSQUEDA_MS);
  });
  busqueda.addEventListener("keydown", (evento) => {
    if (evento.key !== "Enter" || evento.isComposing) return;
    evento.preventDefault();
    aplicarBusqueda();
  });

  botonTodas.addEventListener("click", () => aplicarFiltros({ ...filtrosAplicados(), open: "" }));
  botonAbiertas.addEventListener("click", () => aplicarFiltros({ ...filtrosAplicados(), open: "true" }));

  limpiar.addEventListener("click", () => {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = null;
    busqueda.value = "";
    dispatch({ type: "resetFilters" });
    busqueda.focus();
  });

  // --- Formulario avanzado ------------------------------------------------
  function leerBorrador() {
    const borrador = {};
    for (const { clave } of CONTROLES) borrador[clave] = controles[clave].leer();
    return normalizeFilters(borrador);
  }

  function rellenarDesdeAplicados() {
    const aplicados = filtrosAplicados();
    for (const { clave } of CONTROLES) controles[clave].escribir(aplicados[clave] ?? "");
  }

  function refrescarBorrador() {
    const { errors } = validateFilters(leerBorrador());
    const visibles = [];
    for (const clave of ["date_from", "date_to"]) {
      const entrada = controles[clave].nodo;
      let mensaje = errors[clave] ?? null;
      // Un valor a medio escribir no llega como texto: el control lo señala.
      if (mensaje === null && entrada.validity?.badInput) {
        const nombre = CONTROLES.find((c) => c.clave === clave).etiqueta;
        mensaje = `La fecha «${nombre}» está incompleta o no es válida.`;
      }
      const error = errores[clave];
      error.hidden = mensaje === null;
      error.textContent = mensaje ?? "";
      if (mensaje === null) {
        entrada.removeAttribute("aria-invalid");
        entrada.removeAttribute("aria-describedby");
      } else {
        entrada.setAttribute("aria-invalid", "true");
        entrada.setAttribute("aria-describedby", error.id);
        visibles.push(error.id);
      }
    }
    aplicar.disabled = visibles.length > 0;
    if (visibles.length > 0) aplicar.setAttribute("aria-describedby", visibles.join(" "));
    else aplicar.removeAttribute("aria-describedby");
  }

  /**
   * Con el panel abierto, un cambio aplicado desde otro control (chips, «Limpiar»,
   * quitar chip) sustituye al borrador de esa clave; los demás borradores se
   * conservan. Así «Aplicar» nunca revierte en silencio un filtro ya aplicado.
   */
  function sincronizarBorradorCambiado(anteriores, nuevos) {
    let cambio = false;
    for (const { clave } of CONTROLES) {
      if (anteriores[clave] === nuevos[clave]) continue;
      controles[clave].escribir(nuevos[clave] ?? "");
      cambio = true;
    }
    if (cambio) refrescarBorrador();
  }

  function abrirPanel() {
    rellenarDesdeAplicados();
    formulario.hidden = false;
    botonFiltros.setAttribute("aria-expanded", "true");
    refrescarBorrador();
  }

  function cerrarPanel({ enfocar }) {
    formulario.hidden = true;
    botonFiltros.setAttribute("aria-expanded", "false");
    if (enfocar) botonFiltros.focus();
  }

  function cancelarPanel() {
    rellenarDesdeAplicados();
    refrescarBorrador();
    cerrarPanel({ enfocar: true });
  }

  botonFiltros.addEventListener("click", () => {
    if (formulario.hidden) abrirPanel();
    else cancelarPanel();
  });
  cancelar.addEventListener("click", cancelarPanel);
  formulario.addEventListener("input", refrescarBorrador);
  formulario.addEventListener("change", refrescarBorrador);
  formulario.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      cancelarPanel();
    }
  });
  formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const borrador = leerBorrador();
    if (!validateFilters(borrador).ok) return;
    cerrarPanel({ enfocar: true });
    // La búsqueda no forma parte del formulario: se conserva la aplicada.
    aplicarFiltros({ ...borrador, q: filtrosAplicados().q });
  });

  // --- Paginación ---------------------------------------------------------
  function irAPagina(offset) {
    dispatch({ type: "setOffset", offset });
  }
  anterior.addEventListener("click", () => {
    const estado = getState();
    irAPagina(Math.max(0, estado.offset - (estado.library?.limit ?? POR_PAGINA)));
  });
  siguiente.addEventListener("click", () => {
    const estado = getState();
    irAPagina(estado.offset + (estado.library?.limit ?? POR_PAGINA));
  });

  // --- Pintado ------------------------------------------------------------
  function pintarChips(filtros) {
    // `q` ya está en el campo de búsqueda y `open=true` en el chip «Abiertas».
    const visibles = filterChips(filtros).filter((chip) => chip.key !== "q" && !(chip.key === "open" && chip.value === "true"));
    chips.replaceChildren();
    for (const chip of visibles) {
      const texto = chip.key === "open" ? chip.label : `${chip.label}: ${chip.value}`;
      const item = elemento("li", { clase: "chip" });
      const quitar = elemento("button", {
        clase: "chip-quitar",
        texto: "×",
        atributos: { type: "button", "aria-label": `Quitar filtro ${texto}`, title: `Quitar filtro ${texto}` },
      });
      quitar.addEventListener("click", () => {
        const { [chip.key]: _quitado, ...resto } = filtrosAplicados();
        aplicarFiltros(resto);
        botonFiltros.focus();
      });
      item.append(elemento("span", { clase: "chip-texto", texto, atributos: { title: texto } }), quitar);
      chips.append(item);
    }
    chips.hidden = visibles.length === 0;
  }

  function actualizarControlesDeFiltros(filtros) {
    const aplicados = normalizeFilters(filtros);
    const avanzados = Object.keys(aplicados).filter((clave) => clave !== "q").length;
    botonFiltros.textContent = avanzados > 0 ? `Filtros (${avanzados})` : "Filtros";
    botonAbiertas.setAttribute("aria-pressed", String(aplicados.open === "true"));
    botonTodas.setAttribute("aria-pressed", String(aplicados.open === undefined));
    limpiar.hidden = Object.keys(aplicados).length === 0;
    // El campo refleja un cambio externo, nunca el que el usuario está escribiendo.
    if (doc.activeElement !== busqueda && temporizador === null && busqueda.value.trim() !== (aplicados.q ?? "")) {
      busqueda.value = aplicados.q ?? "";
    }
    pintarChips(aplicados);
  }

  /** Repositorios declarados en la página, por identidad normalizada. */
  function declaradosPorIdentidad(items) {
    const mapa = new Map();
    for (const item of items) {
      const identidad = textoNoVacio(item?.repository_identity);
      const declarado = textoNoVacio(item?.repository_label);
      if (identidad === null || declarado === null) continue;
      if (!mapa.has(identidad)) mapa.set(identidad, new Set());
      mapa.get(identidad).add(declarado);
    }
    return mapa;
  }

  function actualizarSugerencias(items) {
    const declarados = declaradosPorIdentidad(items);
    for (const clave of SUGERIBLES) {
      const valores = suggestFromPage(items, clave);
      const { datalist, nota } = listas[clave];
      datalist.replaceChildren(...valores.map((valor) => {
        // El servidor filtra el repositorio por su identidad normalizada: ese es
        // el valor sugerido, rotulado con el repositorio tal como se declaró.
        const formas = clave === "repository" ? [...(declarados.get(valor) ?? [])].filter((forma) => forma !== valor) : [];
        const atributos = formas.length > 0 ? { value: valor, label: `Declarado: ${formas.join(" · ")}` } : { value: valor };
        return elemento("option", { atributos });
      }));
      const total = `Sugerencias de esta página: ${valores.length === 0 ? "ninguna" : valores.length}; no es un inventario completo.`;
      nota.textContent = clave === "repository"
        ? `${total} El filtro compara la identidad normalizada (sin esquema ni «.git»), no el valor declarado.`
        : total;
    }
  }

  /** Bloque de estado con `data-estado`: cargando, vacia, sin-coincidencias, error o desactualizada. */
  function bloqueEstado(estado, ...hijos) {
    const bloque = elemento("div", { clase: `estado-bloque estado-bloque--${estado}`, atributos: { "data-estado": estado } });
    bloque.append(...hijos.filter(Boolean));
    return bloque;
  }

  function botonReintentar() {
    const boton = elemento("button", { texto: "Reintentar", atributos: { type: "button" } });
    boton.addEventListener("click", () => dispatch({ type: "retryLibrary" }));
    return boton;
  }

  function filaRevision(item, etiqueta) {
    const entrada = elemento("li", { clase: "revision-fila" });
    const boton = elemento("button", {
      clase: "revision",
      atributos: { type: "button", "aria-pressed": "false", "data-key": item.key },
    });
    boton.append(elemento("span", { clase: "revision-titulo", texto: etiqueta.label, atributos: { title: etiqueta.label } }));
    if (etiqueta.hint) {
      boton.append(elemento("span", { clase: "revision-pista", texto: etiqueta.hint, atributos: { title: etiqueta.hint } }));
    }
    const meta = elemento("span", { clase: "revision-meta" });
    const repositorio = repositorioDe(item);
    if (repositorio) {
      meta.append(elemento("span", { clase: "revision-repo", texto: repositorioCorto(repositorio), atributos: { title: repositorio } }));
    }
    const original = [item.display_state, item.archive_state].filter(Boolean).join(" · ");
    meta.append(
      elemento("span", {
        clase: "revision-estado",
        texto: estadoLegible(item),
        atributos: { title: original ? `Estado original: ${original}` : "Estado no declarado" },
      }),
    );
    const fecha = fechaCompacta(item.created_at);
    if (fecha) {
      meta.append(elemento("time", { clase: "revision-fecha", texto: fecha.texto, atributos: { datetime: fecha.original, title: fecha.titulo } }));
    } else {
      meta.append(elemento("span", { clase: "revision-fecha valor--desconocido", texto: "Sin fecha" }));
    }
    boton.append(meta);
    if (item.recently_observed_change) boton.append(elemento("span", { clase: "marca marca--actividad", texto: "cambio detectado" }));
    if (item.archive_state === "processing") boton.append(elemento("span", { clase: "marca", texto: "trabajo iniciado" }));
    boton.addEventListener("click", () => dispatch({ type: "selectRun", key: item.key }));

    const detalle = elemento("details", { clase: "revision-detalle" });
    detalle.open = detallesAbiertos.has(item.key);
    detalle.addEventListener("toggle", () => {
      if (detalle.open) detallesAbiertos.add(item.key);
      else detallesAbiertos.delete(item.key);
    });
    detalle.append(elemento("summary", { texto: "Ver detalle", atributos: { "data-detalle": item.key } }), filaDetalle(item, etiqueta));
    entrada.append(boton, detalle);
    return entrada;
  }

  function lista(items) {
    const etiquetas = labelRuns(items);
    const raiz = elemento("ul", { clase: "lista-revisiones" });
    // Se agrupa toda la página por repositorio, no solo las filas contiguas: el
    // servidor ordena por fecha entre repositorios. Los grupos siguen el orden
    // de primera aparición y cada uno conserva el orden del servidor.
    // Se agrupa por identidad normalizada y el encabezado muestra el repositorio
    // declarado del primer miembro; cada fila conserva en su detalle el suyo.
    const grupos = new Map();
    for (const item of items) {
      const clave = grupoDe(item);
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(item);
    }
    for (const miembros of grupos.values()) {
      const repositorio = repositorioDe(miembros[0]);
      const nodo = elemento("li", { clase: "grupo-revisiones" });
      nodo.append(
        elemento("h3", { texto: repositorio ?? "Repositorio no identificado", atributos: repositorio ? { title: repositorio } : {} }),
      );
      const filas = elemento("ul", { clase: "grupo-filas" });
      for (const item of miembros) {
        filas.append(filaRevision(item, etiquetas.get(item.key) ?? { label: item.key ?? "Revisión sin identificar", hint: null }));
      }
      nodo.append(filas);
      raiz.append(nodo);
    }
    return raiz;
  }

  function pintarLista(estado) {
    const biblioteca = estado.library ?? { items: [], total: 0 };
    const items = Array.isArray(biblioteca.items) ? biblioteca.items : [];
    const total = Number.isFinite(Number(biblioteca.total)) ? Number(biblioteca.total) : items.length;
    const activo = doc.activeElement;
    const enLista = Boolean(activo) && regionLista.contains(activo);
    const claveFoco = enLista ? activo.dataset?.key ?? null : null;
    const claveDetalle = enLista ? activo.dataset?.detalle ?? null : null;

    const nodos = [];
    let hayLista = false;
    if (!estado.libraryReady) {
      if (estado.libraryError !== null) {
        nodos.push(
          bloqueEstado(
            "error",
            elemento("p", { clase: "estado estado--error", texto: `No se pudieron cargar las revisiones: ${estado.libraryError}` }),
            botonReintentar(),
          ),
        );
      } else {
        nodos.push(bloqueEstado("cargando", elemento("p", { clase: "estado", texto: "Cargando revisiones…" })));
      }
    } else {
      if (estado.libraryStale) {
        nodos.push(
          bloqueEstado(
            "desactualizada",
            elemento("p", {
              clase: "estado estado--aviso",
              texto: "La lista no está actualizada: no se pudo recargar la biblioteca. Se muestra la última carga correcta.",
            }),
            estado.libraryError ? elemento("p", { clase: "nota", texto: estado.libraryError }) : null,
            botonReintentar(),
          ),
        );
      }
      if (total === 0) {
        const conFiltros = Object.keys(estado.filters ?? {}).length > 0;
        nodos.push(
          conFiltros
            ? bloqueEstado("sin-coincidencias", elemento("p", { clase: "estado", texto: "Ninguna revisión coincide con los filtros aplicados. Usa «Limpiar» para volver a ver todas." }))
            : bloqueEstado("vacia", elemento("p", { clase: "estado", texto: "No hay revisiones archivadas en esta raíz." })),
        );
      } else {
        nodos.push(lista(items));
        hayLista = true;
      }
    }
    regionLista.replaceChildren(...nodos.filter(Boolean));
    paginacion.hidden = !hayLista;

    if (claveFoco !== null || claveDetalle !== null) {
      const destino = claveFoco !== null
        ? [...regionLista.querySelectorAll("button.revision")].find((nodo) => nodo.dataset.key === claveFoco)
        : [...regionLista.querySelectorAll("summary")].find((nodo) => nodo.dataset.detalle === claveDetalle);
      (destino ?? regionLista).focus({ preventScroll: true });
    } else if (enLista) {
      regionLista.focus({ preventScroll: true });
    }
  }

  function marcarSeleccion(clave) {
    for (const boton of regionLista.querySelectorAll("button.revision")) {
      const activa = clave !== null && boton.dataset.key === clave;
      boton.setAttribute("aria-pressed", String(activa));
      boton.classList.toggle("revision--activa", activa);
    }
  }

  function pintarPaginacion(estado) {
    const biblioteca = estado.library ?? {};
    const total = Number.isFinite(Number(biblioteca.total)) ? Number(biblioteca.total) : 0;
    const limite = Number(biblioteca.limit) > 0 ? Number(biblioteca.limit) : POR_PAGINA;
    const paginas = Math.max(1, Math.ceil(total / limite));
    const pagina = Math.min(paginas, Math.floor(estado.offset / limite) + 1);
    resumen.textContent = `${total} ${total === 1 ? "revisión" : "revisiones"} · página ${pagina} de ${paginas}`;
    const limitada = Array.isArray(biblioteca.diagnostics) && biblioteca.diagnostics.length > 0;
    limitaciones.hidden = !limitada;
    limitaciones.textContent = limitada ? "Biblioteca con limitaciones de exploración." : "";
    for (const [boton, otro, bloqueado] of [
      [anterior, siguiente, estado.offset <= 0],
      [siguiente, anterior, estado.offset + limite >= total],
    ]) {
      const habiaFoco = doc.activeElement === boton;
      boton.disabled = bloqueado;
      // Un botón que se deshabilita con el foco lo deja en el cuerpo del documento.
      if (habiaFoco && bloqueado && !otro.disabled) otro.focus();
    }
  }

  function update(estado) {
    const filtros = estado.filters ?? {};
    const cambioLista =
      previo.library !== estado.library ||
      previo.libraryReady !== estado.libraryReady ||
      previo.libraryStale !== estado.libraryStale ||
      previo.libraryError !== estado.libraryError ||
      previo.filters !== filtros;
    if (previo.filters !== filtros) {
      const nuevos = normalizeFilters(filtros);
      if (!formulario.hidden) sincronizarBorradorCambiado(aplicadosVistos, nuevos);
      aplicadosVistos = nuevos;
      actualizarControlesDeFiltros(filtros);
    }
    if (previo.library !== estado.library) actualizarSugerencias(estado.library?.items);
    if (cambioLista) pintarLista(estado);
    if (cambioLista || previo.selectedRun !== estado.selectedRun) marcarSeleccion(estado.selectedRun ?? null);
    if (cambioLista || previo.offset !== estado.offset) pintarPaginacion(estado);
    if (previo.offset !== undefined && previo.offset !== estado.offset) {
      container.closest(".region-biblioteca")?.scrollTo?.(0, 0);
    }
    regionLista.setAttribute("aria-busy", String(Boolean(estado.loading)));
    previo = {
      library: estado.library,
      libraryReady: estado.libraryReady,
      libraryStale: estado.libraryStale,
      libraryError: estado.libraryError,
      filters: filtros,
      selectedRun: estado.selectedRun,
      offset: estado.offset,
    };
  }

  update(getState());
  return { update };
}
