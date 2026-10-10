/**
 * Hallazgos: lista densa con filtros locales y detalle (maestro-detalle).
 *
 * Estado y prioridad conservan su valor original: una etiqueta legible nunca
 * lo sustituye y un valor desconocido se muestra y se filtra tal cual. Todo
 * texto de la fuente se escribe como texto; la única navegación es una acción
 * explícita hacia una comprobación declarada.
 */

import {
  campo,
  consumirDestino,
  detallesJson,
  elemento,
  listaDefinitiva,
  seccion,
  textoDe,
  traerAVista,
} from "./dom.js";
import { ESTADOS_COBERTURA, ESTADOS_HALLAZGO, valorLegible } from "./estados.js";
import { selectFindingCounts } from "./store.js";

const PRIORIDADES = ["P0", "P1", "P2", "P3"];

/** Campos con presentación propia; el resto se conserva en «campos originales». */
const CAMPOS_CONOCIDOS = [
  "id", "status", "priority", "blocking", "blocking_reason", "origin", "title",
  "location", "scenario", "impact", "correction", "evidence",
];

const SIN_PRIORIDAD = "Sin prioridad declarada";

/**
 * Grupos de la lista, en orden. `siempre`: el grupo se muestra aunque no tenga
 * elementos (una ausencia no es una omisión). Un estado que no es de la lista
 * va a «Otros estados» con su valor original en cada fila.
 */
const GRUPOS = [
  { estado: "confirmed", titulo: "Confirmados", siempre: true },
  { estado: "unresolved", titulo: "No resueltos", siempre: true },
  { estado: "candidate", titulo: "Candidatos", siempre: false },
  { estado: "rejected", titulo: "Descartados", siempre: true },
];
const OTROS = { estado: null, titulo: "Otros estados", siempre: false };

function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

/** Texto de un valor escalar de la fuente; `null` para ausente o de otro tipo. */
function escalar(valor) {
  return typeof valor === "string" || typeof valor === "number" ? String(valor) : null;
}

/**
 * Filtra por estado y prioridad (valor original exacto) y por texto (sin
 * distinguir mayúsculas, en ID, título, ubicación y descripción). No muta.
 */
export function filterFindings(findings, filtros = {}) {
  const lista = Array.isArray(findings) ? findings.filter(esObjeto) : [];
  const f = esObjeto(filtros) ? filtros : {};
  const estado = String(f.status ?? "");
  const prioridad = String(f.priority ?? "");
  const aguja = String(f.text ?? "").trim().toLocaleLowerCase();
  return lista.filter((hallazgo) => {
    if (estado !== "" && escalar(hallazgo.status) !== estado) return false;
    if (prioridad !== "" && escalar(hallazgo.priority) !== prioridad) return false;
    if (aguja === "") return true;
    const lugar = esObjeto(hallazgo.location) ? hallazgo.location : {};
    const pajar = [
      hallazgo.id, hallazgo.title, lugar.path, lugar.section, lugar.url,
      hallazgo.scenario, hallazgo.impact, hallazgo.correction, hallazgo.origin,
    ].map((valor) => escalar(valor) ?? "").join("\n");
    return pajar.toLocaleLowerCase().includes(aguja);
  });
}

function resumen(counts) {
  const caja = elemento("div", { clase: "resumen" });
  caja.append(elemento("p", { texto: `Confirmados: ${counts.totalConfirmed}` }));
  const tabla = elemento("ul", { clase: "prioridades" });
  for (const prioridad of PRIORIDADES) {
    // Las prioridades sin hallazgos se muestran como 0, nunca como ausencia.
    tabla.append(elemento("li", { texto: `${prioridad}: ${counts.confirmed[prioridad]}` }));
  }
  if (counts.unknownPriority > 0) {
    tabla.append(elemento("li", { texto: `Prioridad desconocida: ${counts.unknownPriority}` }));
  }
  caja.append(tabla);
  caja.append(elemento("p", { clase: "nota", texto: `No resueltos: ${counts.unresolved} · Descartados: ${counts.rejected}` }));
  return caja;
}

/** Ubicación declarada como una línea de texto, o `null` si no hay ninguna. */
function ubicacion(hallazgo) {
  const lugar = hallazgo.location;
  if (lugar === null || lugar === undefined || lugar === "") return null;
  if (!esObjeto(lugar)) return textoDe(lugar);
  const partes = [];
  if (escalar(lugar.path)) partes.push(escalar(lugar.path));
  if (typeof lugar.line === "number") partes.push(`línea ${lugar.line}`);
  if (escalar(lugar.section)) partes.push(`sección ${escalar(lugar.section)}`);
  if (escalar(lugar.url)) partes.push(escalar(lugar.url));
  return partes.length > 0 ? partes.join(" · ") : null;
}

const idDe = (hallazgo) => textoDe(hallazgo.id) ?? "Sin ID";

function fila(hallazgo, activa) {
  const boton = elemento("button", {
    clase: "fila-hallazgo",
    atributos: { type: "button", "aria-pressed": String(activa), "data-clave": idDe(hallazgo) },
  });
  const meta = elemento("span", { clase: "fila-meta" });
  meta.append(
    elemento("span", { clase: "fila-prioridad", texto: textoDe(hallazgo.priority) ?? SIN_PRIORIDAD }),
    valorLegible(hallazgo.status, ESTADOS_HALLAZGO, { vacio: "Sin estado declarado" }),
  );
  const lugar = ubicacion(hallazgo);
  boton.append(
    elemento("span", { clase: "fila-id", texto: idDe(hallazgo) }),
    elemento("span", { clase: "fila-titulo", texto: textoDe(hallazgo.title) ?? "Sin título" }),
    meta,
  );
  if (lugar) boton.append(elemento("span", { clase: "fila-ubicacion", texto: lugar }));
  return boton;
}

/** Elementos citados desde el resto de la revisión: aliases y áreas de cobertura. */
function referencias(hallazgo, review) {
  const id = escalar(hallazgo.id);
  const items = [];
  if (id !== null) {
    const aliases = esObjeto(review?.aliases) ? review.aliases : {};
    for (const [alias, destino] of Object.entries(aliases)) {
      if (destino === id) items.push(elemento("li", { texto: `Alias declarado: ${alias} → ${destino}` }));
    }
    if (Object.hasOwn(aliases, id)) {
      items.push(elemento("li", { texto: `Este ID es un alias de ${textoDe(aliases[id])}` }));
    }
    const areas = Array.isArray(review?.coverage?.areas) ? review.coverage.areas : [];
    for (const area of areas) {
      if (!esObjeto(area) || !Array.isArray(area.finding_ids) || !area.finding_ids.includes(id)) continue;
      const item = elemento("li");
      item.append(elemento("span", { texto: `Área ${textoDe(area.area) ?? "sin nombre"} de cobertura · ` }));
      item.append(valorLegible(area.status, ESTADOS_COBERTURA, { vacio: "sin estado declarado" }));
      items.push(item);
    }
  }
  return items;
}

function evidencia(hallazgo, checksDeclarados, dispatch) {
  const entradas = Array.isArray(hallazgo.evidence) ? hallazgo.evidence : [];
  if (entradas.length === 0) return null;
  const lista = elemento("ul", { clase: "evidencia" });
  for (const entrada of entradas) {
    const item = elemento("li");
    if (!esObjeto(entrada)) {
      item.append(elemento("span", { texto: `Evidencia con forma no reconocida: ${textoDe(entrada) ?? "vacía"}` }));
      lista.append(item);
      continue;
    }
    const tipo = entrada.kind === "executed" ? "ejecutada" : entrada.kind === "static" ? "estática" : textoDe(entrada.kind) ?? "sin tipo";
    item.append(elemento("span", { texto: `${tipo}: ${textoDe(entrada.details) ?? ""}` }));
    const idCheck = textoDe(entrada.check_id);
    if (idCheck !== null) {
      if (checksDeclarados.has(idCheck)) {
        const ir = elemento("button", {
          clase: "enlace-interno",
          texto: `Ver comprobación ${idCheck}`,
          atributos: { type: "button" },
        });
        ir.addEventListener("click", () => dispatch({ type: "openTarget", tab: "validacion", id: idCheck }));
        item.append(elemento("span", { texto: " " }), ir);
      } else {
        item.append(elemento("span", { clase: "nota", texto: ` (${idCheck}: comprobación no declarada en esta revisión)` }));
      }
    }
    lista.append(item);
  }
  return lista;
}

function detalleDe(hallazgo, { review, checksDeclarados, dispatch, resaltado, fueraDelFiltro }) {
  const articulo = elemento("article", {
    clase: "hallazgo hallazgo-detalle",
    atributos: { "data-detalle": "hallazgo", tabindex: "-1", "data-resaltado": resaltado ? "true" : null },
  });
  // La prioridad y el ID van en H3; el título en H4.
  articulo.append(
    elemento("h3", { texto: `${textoDe(hallazgo.priority) ?? SIN_PRIORIDAD} · ${idDe(hallazgo)}` }),
    elemento("h4", { texto: textoDe(hallazgo.title) ?? "Sin título" }),
  );
  if (fueraDelFiltro) {
    articulo.append(elemento("p", { clase: "nota", texto: "Este hallazgo no coincide con los filtros actuales." }));
  }
  const marcas = elemento("ul", { clase: "marcas" });
  if (hallazgo.blocking === true) marcas.append(elemento("li", { clase: "marca marca--bloqueante", texto: "Bloqueante" }));
  if (marcas.children.length > 0) articulo.append(marcas);
  const motivo = textoDe(hallazgo.blocking_reason);
  if (hallazgo.blocking === true && motivo) articulo.append(elemento("p", { clase: "motivo-bloqueo", texto: motivo }));

  const lugar = ubicacion(hallazgo);
  articulo.append(
    listaDefinitiva([
      campo("Estado", valorLegible(hallazgo.status, ESTADOS_HALLAZGO, { vacio: "Sin estado declarado" })),
      campo("Prioridad", textoDe(hallazgo.priority), { textoVacio: SIN_PRIORIDAD }),
      campo("Ubicación", lugar ? elemento("code", { clase: "ubicacion", texto: lugar }) : null, { textoVacio: "Sin ubicación declarada" }),
      campo("Origen", textoDe(hallazgo.origin), { textoVacio: "No declarado" }),
      campo("Escenario", textoDe(hallazgo.scenario), { textoVacio: "No declarado" }),
      campo("Impacto", textoDe(hallazgo.impact), { textoVacio: "No declarado" }),
      campo("Corrección", textoDe(hallazgo.correction), { textoVacio: "No declarada" }),
    ]),
  );

  const lista = evidencia(hallazgo, checksDeclarados, dispatch);
  if (lista) articulo.append(elemento("h5", { texto: "Evidencia" }), lista);
  else articulo.append(elemento("h5", { texto: "Evidencia" }), elemento("p", { clase: "estado", texto: "Sin evidencia declarada." }));

  const citas = referencias(hallazgo, review);
  if (citas.length > 0) {
    const refs = elemento("ul", { clase: "evidencia" });
    refs.append(...citas);
    articulo.append(elemento("h5", { texto: "Referencias" }), refs);
  }

  const extras = Object.fromEntries(Object.entries(hallazgo).filter(([nombre]) => !CAMPOS_CONOCIDOS.includes(nombre)));
  const cantidad = Object.keys(extras).length;
  if (cantidad > 0) {
    articulo.append(detallesJson(`Campos originales sin presentación propia (${cantidad})`, extras, "campos-originales"));
  }
  return articulo;
}

function opcion(valor, texto) {
  return elemento("option", { atributos: { value: valor }, texto });
}

function selector(filtro, etiqueta, opciones) {
  const control = elemento("select", { atributos: { "data-filtro": filtro } });
  for (const [valor, texto] of opciones) control.append(opcion(valor, texto));
  const bloque = elemento("label", { clase: "filtro-campo" });
  bloque.append(elemento("span", { texto: etiqueta }), control);
  return { bloque, control };
}

/** Dibuja los hallazgos conservando estado, prioridad y bloqueo de la fuente. */
export function renderFindings(contenedor, view, dispatch = () => {}, contexto = {}) {
  contenedor.replaceChildren();
  const review = view?.review ?? null;
  const findings = Array.isArray(review?.findings) ? review.findings : [];

  if (!review) {
    contenedor.append(
      seccion("Hallazgos", [
        elemento("p", { clase: "estado", texto: "No hay hallazgos registrados: la corrida aún no conserva registro final." }),
      ]),
    );
    return;
  }

  if (findings.length === 0) {
    contenedor.append(
      seccion("Hallazgos", [
        elemento("p", { clase: "estado", texto: "No hay hallazgos registrados en esta revisión." }),
      ]),
    );
    return;
  }

  const todos = findings.filter(esObjeto);
  if (todos.length === 0) {
    contenedor.append(
      seccion("Hallazgos", [
        elemento("p", { clase: "estado", texto: "Los hallazgos declarados no tienen una forma reconocible; el JSON original está en Archivo." }),
      ]),
    );
    return;
  }

  const checksDeclarados = new Set(
    (Array.isArray(review.checks) ? review.checks : []).filter(esObjeto).map((c) => textoDe(c.id)).filter(Boolean),
  );

  // Estado local de la vista: filtros, hallazgo seleccionado y su resalte. Si
  // la aplicación aporta una memoria (recarga en vivo de la misma revisión),
  // filtros y selección se restauran en lugar de reiniciarse.
  const recuerdo = contexto?.memoria ? (contexto.memoria.hallazgos ??= {}) : {};
  const filtros = { status: "", priority: "", text: "", ...(esObjeto(recuerdo.filtros) ? recuerdo.filtros : {}) };
  let seleccionado = (recuerdo.id !== undefined && todos.find((h) => textoDe(h.id) === recuerdo.id)) || todos[0];
  let resaltado = false;
  let aviso = null;

  const destino = consumirDestino(contexto, dispatch, "hallazgos");
  if (destino !== null) {
    const buscado = todos.find((h) => textoDe(h.id) === destino);
    if (buscado) {
      seleccionado = buscado;
      resaltado = true;
      recuerdo.id = destino;
    } else {
      aviso = `El hallazgo «${destino}» no está declarado en esta revisión; se conserva la selección actual.`;
    }
  }

  // --- Controles ---------------------------------------------------------
  const estadosPresentes = [...new Set(todos.map((h) => escalar(h.status)).filter((v) => v !== null && v !== ""))];
  const estadosConocidos = Object.keys(ESTADOS_HALLAZGO);
  const estado = selector("estado", "Estado", [
    ["", "Todos"],
    ...estadosConocidos.map((valor) => [valor, `${ESTADOS_HALLAZGO[valor]} (${valor})`]),
    ...estadosPresentes.filter((v) => !estadosConocidos.includes(v)).map((v) => [v, v]),
  ]);
  const prioridadesPresentes = [...new Set(todos.map((h) => escalar(h.priority)).filter((v) => v !== null && v !== ""))];
  const prioridad = selector("prioridad", "Prioridad", [
    ["", "Todas"],
    ...PRIORIDADES.map((v) => [v, v]),
    ...prioridadesPresentes.filter((v) => !PRIORIDADES.includes(v)).map((v) => [v, v]),
  ]);
  const texto = elemento("input", {
    atributos: { type: "search", "data-filtro": "texto", autocomplete: "off", placeholder: "ID, título, ruta…" },
  });
  const bloqueTexto = elemento("label", { clase: "filtro-campo" });
  bloqueTexto.append(elemento("span", { texto: "Buscar" }), texto);
  const limpiar = elemento("button", { clase: "filtros-limpiar", texto: "Limpiar filtros", atributos: { type: "button" } });
  limpiar.hidden = true;
  const barra = elemento("div", { clase: "filtros-locales", atributos: { role: "group", "aria-label": "Filtros de hallazgos" } });
  barra.append(estado.bloque, prioridad.bloque, bloqueTexto, limpiar);
  const conteo = elemento("p", { clase: "conteo-filtro", atributos: { role: "status", "data-conteo": "hallazgos" } });

  // --- Lista y detalle ---------------------------------------------------
  const lista = elemento("ul", { clase: "lista-densa", atributos: { "aria-label": "Hallazgos" } });
  const vacio = elemento("p", { clase: "estado", texto: "Ningún hallazgo coincide con los filtros." });
  const maestro = elemento("div", { clase: "maestro" });
  maestro.append(lista, vacio);
  const detalle = elemento("div", { clase: "detalle" });
  let filas = [];

  function pintarDetalle() {
    const visibles = filterFindings(todos, filtros);
    const articulo = detalleDe(seleccionado, {
      review,
      checksDeclarados,
      dispatch,
      resaltado,
      fueraDelFiltro: !visibles.includes(seleccionado),
    });
    detalle.replaceChildren(
      ...(aviso ? [elemento("p", { clase: "estado estado--aviso", texto: aviso })] : []),
      articulo,
    );
    return articulo;
  }

  function marcarSeleccion() {
    for (const { hallazgo, boton } of filas) boton.setAttribute("aria-pressed", String(hallazgo === seleccionado));
  }

  function pintarLista() {
    const visibles = filterFindings(todos, filtros);
    const conocidos = GRUPOS.map((g) => g.estado);
    filas = [];
    const grupos = [];
    for (const grupo of [...GRUPOS, OTROS]) {
      const miembros = visibles.filter((h) => (grupo.estado === null
        ? !conocidos.includes(h.status)
        : h.status === grupo.estado));
      if (miembros.length === 0 && !grupo.siempre) continue;
      const items = miembros.map((hallazgo) => {
        const boton = fila(hallazgo, hallazgo === seleccionado);
        boton.addEventListener("click", () => {
          seleccionado = hallazgo;
          recuerdo.id = textoDe(hallazgo.id) ?? undefined;
          resaltado = false;
          aviso = null;
          marcarSeleccion();
          pintarDetalle();
        });
        filas.push({ hallazgo, boton });
        const item = elemento("li");
        item.append(boton);
        return item;
      });
      // El recuento se muestra siempre, incluido el cero. El rótulo no es un
      // encabezado: H3 queda para «prioridad · ID» y H4 para el título.
      const rotulo = `${grupo.titulo} (${miembros.length})`;
      const contenedorGrupo = elemento("li", { clase: "grupo-lista" });
      const interior = elemento("ul", { clase: "grupo-filas-densas", atributos: { "aria-label": rotulo } });
      interior.append(...items);
      contenedorGrupo.append(
        elemento("p", { clase: "grupo-titulo", texto: rotulo, atributos: { "aria-hidden": "true" } }),
        interior,
      );
      grupos.push(contenedorGrupo);
    }
    lista.replaceChildren(...grupos);
    vacio.hidden = visibles.length > 0;
    conteo.textContent = `Mostrando ${visibles.length} de ${todos.length} hallazgos`;
    limpiar.hidden = filtros.status === "" && filtros.priority === "" && filtros.text.trim() === "";
  }

  function alCambiarFiltro() {
    filtros.status = estado.control.value;
    filtros.priority = prioridad.control.value;
    filtros.text = texto.value;
    recuerdo.filtros = { ...filtros };
    pintarLista();
    pintarDetalle();
  }

  estado.control.addEventListener("change", alCambiarFiltro);
  prioridad.control.addEventListener("change", alCambiarFiltro);
  texto.addEventListener("input", alCambiarFiltro);
  // Filtros restaurados: los controles reflejan lo aplicado (un valor que ya no
  // es una opción vuelve a «Todos»).
  estado.control.value = filtros.status;
  prioridad.control.value = filtros.priority;
  texto.value = filtros.text;
  filtros.status = estado.control.value;
  filtros.priority = prioridad.control.value;
  limpiar.addEventListener("click", () => {
    estado.control.value = "";
    prioridad.control.value = "";
    texto.value = "";
    alCambiarFiltro();
    // El botón se oculta al limpiar: el foco pasa al primer filtro.
    if (typeof estado.control.focus === "function") estado.control.focus();
  });

  pintarLista();
  const articulo = pintarDetalle();

  const rejilla = elemento("div", { clase: "maestro-detalle" });
  rejilla.append(maestro, detalle);
  contenedor.append(
    elemento("h2", { texto: "Hallazgos" }),
    resumen(selectFindingCounts(review)),
    barra,
    conteo,
    rejilla,
  );

  if (resaltado) {
    const activa = filas.find(({ hallazgo }) => hallazgo === seleccionado);
    if (activa) traerAVista(activa.boton);
    traerAVista(articulo, { enfocar: true });
  }

  const aliases = esObjeto(review.aliases) ? review.aliases : {};
  const claves = Object.keys(aliases);
  if (claves.length > 0) {
    const referenciasDeclaradas = elemento("ul", { clase: "lista-simple" });
    for (const alias of claves) {
      referenciasDeclaradas.append(elemento("li", { texto: `${alias} → ${textoDe(aliases[alias]) ?? ""}` }));
    }
    contenedor.append(seccion("Alias declarados", [referenciasDeclaradas]));
  }
}
