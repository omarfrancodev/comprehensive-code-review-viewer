/**
 * Cabecera de la revisión seleccionada.
 *
 * Se monta encima del panel y acompaña a todas las pestañas: título,
 * repositorio, ID copiable, referencia y, como conceptos SEPARADOS, el estado
 * del cierre, el veredicto de la fuente, la integridad y los conteos con su
 * alcance. No calcula puntuaciones ni porcentajes: cada cifra sale del registro
 * declarado y nombra de qué lista procede.
 */

import { campo, elemento } from "./dom.js";
import { runTitle } from "./present.js";
import { ESTADOS_CIERRE, VEREDICTOS, valorLegible } from "./estados.js";
import { selectFindingCounts } from "./store.js";

const COMPROBACIONES = [
  ["passed", "Superadas"],
  ["failed", "Fallidas"],
  ["blocked", "Bloqueadas"],
  ["not_run", "No ejecutadas"],
];

const textoNoVacio = (valor) => (typeof valor === "string" && valor.trim() !== "" ? valor : null);

function objeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

/** Un concepto de la cabecera: su propio elemento, con etiqueta y valor. */
function concepto(id, etiqueta, contenido) {
  const nodo = elemento("li", { clase: "concepto", atributos: { "data-concepto": id } });
  nodo.append(elemento("span", { clase: "concepto-etiqueta", texto: etiqueta }), contenido);
  return nodo;
}

function textoConcepto(texto) {
  return elemento("span", { clase: "concepto-valor", texto });
}

function conteoHallazgos(review) {
  if (!objeto(review)) return "No hay hallazgos declarados: la revisión no tiene registro final.";
  const lista = Array.isArray(review.findings) ? review.findings : [];
  if (lista.length === 0) return "Sin hallazgos declarados.";
  const c = selectFindingCounts(review);
  const prioridades = Object.entries(c.confirmed).map(([p, n]) => `${p} ${n}`);
  if (c.unknownPriority > 0) prioridades.push(`prioridad desconocida ${c.unknownPriority}`);
  const partes = [
    `Confirmados ${c.totalConfirmed} (${prioridades.join(" · ")})`,
    `No resueltos ${c.unresolved}`,
    `Descartados ${c.rejected}`,
  ];
  if (c.candidate > 0) partes.push(`Candidatos ${c.candidate}`);
  return partes.join(" · ");
}

function conteoComprobaciones(review) {
  const lista = Array.isArray(review?.checks) ? review.checks : [];
  if (lista.length === 0) return "Sin comprobaciones declaradas.";
  const partes = COMPROBACIONES.map(([estado, etiqueta]) => {
    const n = lista.filter((check) => objeto(check)?.status === estado).length;
    return { etiqueta, n };
  });
  const clasificadas = partes.reduce((suma, { n }) => suma + n, 0);
  const texto = partes.map(({ etiqueta, n }) => `${etiqueta} ${n}`);
  if (clasificadas < lista.length) texto.push(`Otro estado ${lista.length - clasificadas}`);
  return texto.join(" · ");
}

async function copiarAlPortapapeles(texto) {
  const portapapeles = globalThis.navigator?.clipboard;
  if (!portapapeles || typeof portapapeles.writeText !== "function") {
    throw new Error("El portapapeles no está disponible.");
  }
  await portapapeles.writeText(texto);
}

/** Selecciona el contenido de `nodo` para que el usuario pueda copiarlo a mano. */
function seleccionar(nodo) {
  try {
    const seleccion = globalThis.getSelection?.();
    const rango = globalThis.document?.createRange?.();
    if (!seleccion || !rango) return;
    rango.selectNodeContents(nodo);
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  } catch {
    // La selección es una ayuda: sin ella el ID sigue a la vista.
  }
}

function campoIdentidad(id, copiar) {
  if (!id) return campo("ID de revisión", null, { textoVacio: "No identificado" });
  const codigo = elemento("code", { clase: "id-completo", texto: id });
  const boton = elemento("button", { clase: "copiar-id", texto: "Copiar ID", atributos: { type: "button" } });
  const estado = elemento("span", { clase: "copiar-estado nota", atributos: { role: "status" } });
  boton.addEventListener("click", async () => {
    try {
      await copiar(id);
      estado.textContent = "ID copiado.";
    } catch {
      seleccionar(codigo);
      estado.textContent = "No se pudo copiar automáticamente; el ID quedó seleccionado para copiarlo a mano.";
    }
  });
  const fila = elemento("span", { clase: "id-fila" });
  fila.append(codigo, boton, estado);
  return campo("ID de revisión", fila);
}

/**
 * Dibuja la cabecera en `container`. Con una vista ausente solo vacía el
 * contenedor. `onCopy(texto)` sustituye a la escritura en el portapapeles
 * (pruebas, anuncios); si falla o no existe, el ID queda seleccionado.
 */
export function renderRunHeader(container, view, { onCopy } = {}) {
  container.replaceChildren();
  if (!objeto(view)) return;
  const review = objeto(view.review);
  const closure = objeto(view.closure);
  const summary = objeto(view.summary) ?? {};

  const titulo = textoNoVacio(review?.presentation?.subject) ?? runTitle(summary).label;
  // El repositorio declarado; la identidad normalizada es solo para comparar.
  const repositorio = textoNoVacio(summary.repository_label) ?? textoNoVacio(summary.repository_identity);
  const id = textoNoVacio(summary.source_review_id) ?? textoNoVacio(review?.review_id);
  const referencia = review?.scope?.reference ?? closure?.scope?.reference ?? summary.scope_reference;

  const encabezado = elemento("header", { clase: "revision-encabezado" });
  encabezado.append(elemento("h2", { texto: titulo }));
  encabezado.append(
    elemento("p", {
      clase: "encabezado-repositorio",
      texto: repositorio ? `Repositorio: ${repositorio}` : "Repositorio no identificado",
    }),
  );

  const datos = elemento("dl", { clase: "campos campos--compactos encabezado-datos" });
  datos.append(
    campoIdentidad(id, onCopy ?? copiarAlPortapapeles),
    campo("Alcance", textoNoVacio(summary.scope_label), { textoVacio: "No declarado" }),
    campo(
      "Referencia",
      referencia === null || referencia === undefined || referencia === ""
        ? null
        : elemento("code", { clase: "referencia", texto: String(referencia) }),
      { textoVacio: "No declarada" },
    ),
  );
  encabezado.append(datos);

  const conceptos = elemento("ul", { clase: "conceptos", atributos: { "aria-label": "Estado de la revisión" } });
  conceptos.append(
    concepto("cierre", "Cierre", valorLegible(closure?.state ?? summary.archive_state, ESTADOS_CIERRE, { vacio: "Sin cierre registrado" })),
    concepto(
      "veredicto",
      "Veredicto de la fuente",
      valorLegible(review?.verdict ?? summary.verdict, VEREDICTOS, { vacio: "Sin veredicto registrado" }),
    ),
    concepto("integridad", "Integridad", textoConcepto("Se verifica bajo demanda en Archivo; es independiente del veredicto.")),
    concepto("hallazgos", "Hallazgos de esta revisión", textoConcepto(conteoHallazgos(review))),
    concepto("comprobaciones", "Comprobaciones declaradas en esta revisión", textoConcepto(conteoComprobaciones(review))),
  );
  encabezado.append(conceptos);
  container.append(encabezado);
}
