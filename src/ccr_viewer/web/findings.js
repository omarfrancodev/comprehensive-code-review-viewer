/** Hallazgos: confirmados, no resueltos y descartados, en grupos separados. */

import { elemento, seccion } from "./dom.js";
import { selectFindingCounts } from "./store.js";

const PRIORIDADES = ["P0", "P1", "P2", "P3"];

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

function ubicacion(hallazgo) {
  const lugar = hallazgo.location ?? {};
  if (!lugar.path) return null;
  const partes = [lugar.path];
  if (typeof lugar.line === "number") partes.push(`línea ${lugar.line}`);
  if (lugar.section) partes.push(`sección ${lugar.section}`);
  if (lugar.url) partes.push(lugar.url);
  return partes.join(" · ");
}

function tarjeta(hallazgo) {
  const articulo = elemento("article", { clase: "hallazgo" });
  // La prioridad y el ID van en H3; el título en H4.
  articulo.append(
    elemento("h3", { texto: `${hallazgo.priority ?? "SIN PRIORIDAD"} · ${hallazgo.id}` }),
  );
  articulo.append(elemento("h4", { texto: hallazgo.title ?? "Sin título" }));

  const lugar = ubicacion(hallazgo);
  if (lugar) articulo.append(elemento("p", { clase: "ubicacion", texto: lugar }));
  if (hallazgo.blocking) {
    articulo.append(elemento("p", { clase: "marca marca--bloqueante", texto: "Bloqueante" }));
    if (hallazgo.blocking_reason) {
      articulo.append(elemento("p", { clase: "motivo-bloqueo", texto: hallazgo.blocking_reason }));
    }
  }

  const cuerpo = elemento("dl", { clase: "campos" });
  for (const [etiqueta, valor] of [
    ["Escenario", hallazgo.scenario],
    ["Impacto", hallazgo.impact],
    ["Corrección", hallazgo.correction],
    ["Origen", hallazgo.origin],
  ]) {
    if (!valor) continue;
    const fila = elemento("div", { clase: "campo" });
    fila.append(elemento("dt", { texto: etiqueta }), elemento("dd", { texto: valor }));
    cuerpo.append(fila);
  }
  articulo.append(cuerpo);

  const evidencia = Array.isArray(hallazgo.evidence) ? hallazgo.evidence : [];
  if (evidencia.length > 0) {
    const lista = elemento("ul", { clase: "evidencia" });
    for (const item of evidencia) {
      lista.append(
        elemento("li", {
          texto: `${item.kind === "executed" ? "ejecutada" : "estática"}: ${item.details ?? ""}${
            item.check_id ? ` (${item.check_id})` : ""
          }`,
        }),
      );
    }
    articulo.append(elemento("h5", { texto: "Evidencia" }), lista);
  }
  return articulo;
}

function grupo(titulo, hallazgos, clase) {
  // El recuento se muestra siempre, incluido el cero: una ausencia no es una omisión.
  const articulos = hallazgos.length > 0
    ? hallazgos.map(tarjeta)
    : [elemento("p", { clase: "estado", texto: "Sin elementos en este grupo." })];
  return seccion(`${titulo} (${hallazgos.length})`, articulos, clase);
}

/** Dibuja los hallazgos conservando estado, prioridad y bloqueo de la fuente. */
export function renderFindings(contenedor, view) {
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

  contenedor.append(resumen(selectFindingCounts(review)));

  const confirmados = findings.filter((h) => h?.status === "confirmed");
  const noResueltos = findings.filter((h) => h?.status === "unresolved");
  const descartados = findings.filter((h) => h?.status === "rejected");
  const candidatos = findings.filter((h) => h?.status === "candidate");

  contenedor.append(grupo("Confirmados", confirmados, "grupo grupo--confirmados"));
  contenedor.append(grupo("No resueltos", noResueltos, "grupo grupo--no-resueltos"));
  if (candidatos.length > 0) {
    contenedor.append(grupo("Candidatos", candidatos, "grupo grupo--candidatos"));
  }
  contenedor.append(grupo("Descartados", descartados, "grupo grupo--descartados"));

  const aliases = review.aliases ?? {};
  const claves = Object.keys(aliases);
  if (claves.length > 0) {
    const lista = elemento("ul", { clase: "lista-simple" });
    for (const alias of claves) {
      lista.append(elemento("li", { texto: `${alias} → ${aliases[alias]}` }));
    }
    contenedor.append(seccion("Alias declarados", [lista]));
  }
}