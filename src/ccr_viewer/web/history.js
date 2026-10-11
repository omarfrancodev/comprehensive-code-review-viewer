/**
 * Seguimiento: entradas de re-review, revisiones anteriores declaradas,
 * aliases y vínculos con otras revisiones.
 *
 * Una entrada se estructura solo cuando su forma es reconocida; cualquier otra
 * conserva su JSON en un `<details>` secundario. Los IDs y valores originales no
 * se normalizan, las URL se muestran como texto (nunca se consultan) y una
 * revisión anterior se abre únicamente con una acción explícita.
 */

import { campo, elemento, listaDefinitiva, seccion } from "./dom.js";
import {
  ESTADOS_REREVIEW,
  ESTADOS_VINCULO,
  ORIGENES_VINCULO,
  banderaDeclarada,
  originalDeclarado,
  valorLegible,
} from "./estados.js";

const CAMPOS_ENTRADA = [
  "status", "details", "previous_review_id", "previous_reference",
  "previous_finding_id", "previous_title", "previous_url", "check_ids",
];

function objeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

const json = (valor) => JSON.stringify(valor, null, 2) ?? String(valor);

/** Reconocida: objeto con `status` textual y al menos otro campo conocido. */
function esEntradaReconocida(entrada) {
  const fila = objeto(entrada);
  if (!fila || typeof fila.status !== "string") return false;
  return CAMPOS_ENTRADA.some((nombre) => nombre !== "status" && Object.hasOwn(fila, nombre));
}

function detallesJson(titulo, valor, clase = "json-secundario") {
  const detalles = elemento("details", { clase });
  detalles.append(elemento("summary", { texto: titulo }), elemento("pre", { clase: "codigo", texto: json(valor) }));
  return detalles;
}

/** Valor de un campo conocido: texto tal cual o, si su tipo no es el esperado, su JSON. */
function valorTexto(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string" || typeof valor === "number") return String(valor);
  return elemento("pre", { clase: "codigo", texto: json(valor) });
}

function listaDeIds(valor) {
  if (valor === null || valor === undefined) return null;
  if (!Array.isArray(valor)) return valorTexto(valor);
  if (valor.length === 0) return null;
  if (!valor.every((id) => typeof id === "string")) return elemento("pre", { clase: "codigo", texto: json(valor) });
  return elemento("span", { clase: "ids", texto: valor.join(", ") });
}

function tarjetaEntrada(entrada) {
  const articulo = elemento("article", { clase: "seguimiento-entrada", atributos: { "data-estado": entrada.status } });
  // «Sin ID declarado» solo cuando la fuente no declara nada: un valor presente
  // de otro tipo se muestra tal cual (número) o como JSON (otros tipos).
  const idAnterior = entrada.previous_finding_id;
  const sinId = idAnterior === undefined || idAnterior === null || idAnterior === "";
  let identificador = "Hallazgo anterior";
  if (sinId) identificador = "Hallazgo anterior sin ID declarado";
  else if (typeof idAnterior === "string" || typeof idAnterior === "number") identificador = String(idAnterior);
  articulo.append(elemento("h3", { texto: identificador }));
  const estado = elemento("p", { clase: "entrada-estado" });
  estado.append(valorLegible(entrada.status, ESTADOS_REREVIEW));
  articulo.append(estado);
  const idAtipico = !sinId && typeof idAnterior !== "string" && typeof idAnterior !== "number";
  articulo.append(
    listaDefinitiva([
      idAtipico
        ? campo("ID del hallazgo anterior", valorTexto(idAnterior), {
          nota: "La fuente declara este ID con una forma no esperada; se conserva sin interpretar.",
        })
        : null,
      campo("Título anterior", valorTexto(entrada.previous_title), { textoVacio: "Sin título declarado" }),
      campo("Revisión anterior", valorTexto(entrada.previous_review_id), { textoVacio: "No declarada" }),
      campo("Referencia anterior", valorTexto(entrada.previous_reference), { textoVacio: "No declarada" }),
      campo("URL anterior", valorTexto(entrada.previous_url), {
        textoVacio: "No declarada",
        nota: "Se muestra como texto; el visor no la consulta.",
      }),
      campo("Comprobaciones", listaDeIds(entrada.check_ids), { textoVacio: "Sin comprobaciones declaradas" }),
      campo("Detalles", valorTexto(entrada.details), { textoVacio: "Sin detalles declarados" }),
    ]),
  );
  const extras = Object.fromEntries(Object.entries(entrada).filter(([nombre]) => !CAMPOS_ENTRADA.includes(nombre)));
  if (Object.keys(extras).length > 0) {
    articulo.append(detallesJson("Campos originales de la entrada", extras));
  }
  return articulo;
}

function tarjetaDesconocida(entrada) {
  const articulo = elemento("article", { clase: "seguimiento-entrada seguimiento-entrada--desconocida" });
  articulo.append(
    elemento("p", {
      clase: "nota",
      texto: "Entrada de forma no reconocida: se conserva tal como la declara la fuente.",
    }),
    detallesJson("JSON original de la entrada", entrada),
  );
  return articulo;
}

function seccionRereview(review) {
  const hijos = [];
  const entradas = review?.rereview;
  if (entradas === undefined || entradas === null) {
    hijos.push(elemento("p", { clase: "estado", texto: "Sin entradas de re-review declaradas." }));
  } else if (!Array.isArray(entradas)) {
    hijos.push(
      elemento("p", { clase: "nota", texto: "El campo de re-review no es una lista; se conserva sin interpretar." }),
      detallesJson("JSON original del re-review", entradas),
    );
  } else if (entradas.length === 0) {
    hijos.push(elemento("p", { clase: "estado", texto: "Sin entradas de re-review declaradas." }));
  } else {
    for (const entrada of entradas) {
      hijos.push(esEntradaReconocida(entrada) ? tarjetaEntrada(entrada) : tarjetaDesconocida(entrada));
    }
  }
  return seccion("Entradas de re-review", hijos);
}

function seccionRevisionesAnteriores(review) {
  const previas = review?.previous_reviews;
  if (previas === undefined || previas === null) return null;
  if (!Array.isArray(previas)) {
    return seccion("Revisiones anteriores declaradas", [detallesJson("JSON original", previas)]);
  }
  if (previas.length === 0) {
    return seccion("Revisiones anteriores declaradas", [
      elemento("p", { clase: "estado", texto: "Sin revisiones anteriores declaradas." }),
    ]);
  }
  const lista = elemento("ul", { clase: "lista-simple" });
  for (const previa of previas) {
    const fila = objeto(previa);
    const item = elemento("li");
    if (fila && ("review_id" in fila || "reference" in fila)) {
      const partes = [];
      if (fila.review_id !== undefined) partes.push(String(fila.review_id));
      if (fila.reference !== undefined) partes.push(`referencia ${fila.reference}`);
      // Solo true/false son una declaración; otra forma queda desconocida y con su JSON.
      const verificacion = banderaDeclarada(fila.verified);
      if (verificacion === "si") partes.push("verificada por la fuente");
      else if (verificacion === "no") partes.push("no verificada por la fuente");
      else if (verificacion === "desconocido") {
        partes.push(`verificación en estado desconocido (valor original: ${originalDeclarado(fila.verified)})`);
      }
      item.append(elemento("span", { texto: partes.join(" · ") }));
      if (verificacion === "desconocido") item.append(detallesJson("JSON original de la revisión anterior", previa));
    } else {
      item.append(detallesJson("JSON original", previa));
    }
    lista.append(item);
  }
  return seccion("Revisiones anteriores declaradas", [lista]);
}

function seccionAliases(review) {
  const aliases = review?.aliases;
  if (aliases === undefined || aliases === null) return null;
  const mapa = objeto(aliases);
  if (!mapa) return seccion("Aliases originales", [detallesJson("JSON original", aliases)]);
  const entradas = Object.entries(mapa);
  if (entradas.length === 0) {
    return seccion("Aliases originales", [elemento("p", { clase: "estado", texto: "Sin aliases declarados." })]);
  }
  const filas = [];
  const raros = {};
  for (const [alias, destino] of entradas) {
    if (typeof destino === "string") filas.push(campo(alias, destino));
    else raros[alias] = destino;
  }
  const hijos = [listaDefinitiva(filas)];
  if (Object.keys(raros).length > 0) hijos.push(detallesJson("Aliases con forma no reconocida", raros));
  return seccion("Aliases originales", hijos);
}

function seccionVinculos(view, dispatch) {
  const vinculos = Array.isArray(view?.lineage) ? view.lineage : [];
  if (vinculos.length === 0) return null;
  const actual = view?.summary?.key;
  const lista = elemento("ul", { clase: "vinculos" });
  for (const vinculo of vinculos) {
    const dato = objeto(vinculo) ?? {};
    const item = elemento("li", { clase: "vinculo", atributos: { "data-estado": dato.status } });
    item.append(elemento("code", { clase: "referencia", texto: String(dato.raw ?? "") }));
    const detalle = elemento("span", { clase: "nota" });
    const origen = typeof dato.source === "string" && Object.hasOwn(ORIGENES_VINCULO, dato.source)
      ? ORIGENES_VINCULO[dato.source]
      : dato.source;
    detalle.append(elemento("span", { texto: origen ? ` · ${origen} · ` : " · " }), valorLegible(dato.status, ESTADOS_VINCULO));
    item.append(detalle);
    if (Array.isArray(dato.candidates) && dato.status === "ambiguous" && dato.candidates.length > 0) {
      item.append(elemento("span", { clase: "nota", texto: ` · candidatos: ${dato.candidates.join(", ")}` }));
    }
    // Solo un vínculo resuelto hacia OTRA revisión se puede abrir, y siempre con una acción.
    if (dato.status === "resolved" && typeof dato.run_key === "string" && dato.run_key !== "" && dato.run_key !== actual) {
      const boton = elemento("button", { texto: "Abrir revisión anterior", atributos: { type: "button" } });
      boton.addEventListener("click", () => dispatch({ type: "selectRun", key: dato.run_key }));
      item.append(boton);
    }
    lista.append(item);
  }
  return seccion("Vínculos con otras revisiones", [lista]);
}

/** Dibuja el seguimiento conservando IDs, aliases y formas desconocidas. */
export function renderHistory(container, view, dispatch) {
  container.replaceChildren(elemento("h2", { texto: "Seguimiento" }));
  const review = objeto(view?.review);
  container.append(seccionRereview(review));
  for (const parte of [
    seccionRevisionesAnteriores(review),
    seccionAliases(review),
    seccionVinculos(view, dispatch),
  ]) {
    if (parte) container.append(parte);
  }
}
