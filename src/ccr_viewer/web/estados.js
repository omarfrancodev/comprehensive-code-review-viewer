/**
 * Etiquetas legibles de valores que declara la fuente.
 *
 * Una etiqueta nunca sustituye al valor: se muestra «legible (original)» y un
 * valor que el visor no conoce se conserva tal cual, sin traducirlo.
 */

import { elemento } from "./dom.js";

/** Estado del cierre (`cierre.json › state`). */
export const ESTADOS_CIERRE = {
  prepared: "preparada",
  retaining: "reteniendo resultados",
  closing: "cerrando",
  complete: "completa",
  processing: "en procesamiento",
};

/** Limpieza de recursos temporales (`cierre.json › cleanup`). */
export const ESTADOS_LIMPIEZA = {
  pending: "pendiente",
  complete: "completa",
  not_needed: "no necesaria",
};

/** Veredictos del contrato publicado. */
export const VEREDICTOS = {
  approvable: "aprobable",
  approvable_with_reservations: "aprobable con reservas",
  not_approvable: "no aprobable",
  insufficient_evidence: "evidencia insuficiente",
};

/** Estados de un área de cobertura. */
export const ESTADOS_COBERTURA = {
  covered: "cubierta",
  partial: "parcial",
  not_evaluated: "no evaluada",
  not_applicable: "no aplica",
};

/** Estados de una entrada de re-review. */
export const ESTADOS_REREVIEW = {
  resolved: "Resuelto",
  still_valid: "Sigue vigente",
  withdrawn: "Retirado",
  new: "Nuevo",
  not_reevaluated: "No reevaluado",
};

/** Resultado de resolver un vínculo con otra revisión (`lineage[].status`). */
export const ESTADOS_VINCULO = {
  resolved: "resuelto",
  missing: "no encontrado",
  external: "externo (no se consulta)",
  outside_root: "fuera de la raíz",
  ambiguous: "ambiguo",
};

/** Origen declarado de un vínculo (`lineage[].source`). */
export const ORIGENES_VINCULO = {
  previous_reviews: "revisiones anteriores declaradas",
  rereview: "re-review",
  previous_run: "corrida anterior declarada",
};

/** Compatibilidad calculada por el visor. */
export const ESTADOS_COMPATIBILIDAD = {
  supported: "soportada",
  historical: "histórica",
  limited: "limitada",
};

/**
 * Valor de la fuente como nodo: «legible (original)» si se conoce, solo el
 * original si no, y `vacio` si la fuente no lo declara.
 */
export function valorLegible(valor, mapa, { vacio = "No declarado" } = {}) {
  const contenedor = elemento("span", { clase: "valor-legible" });
  if (valor === null || valor === undefined || valor === "") {
    contenedor.append(elemento("span", { clase: "valor--desconocido", texto: vacio }));
    return contenedor;
  }
  const original = typeof valor === "string" ? valor : JSON.stringify(valor);
  if (typeof valor === "string" && Object.hasOwn(mapa, valor)) {
    contenedor.append(
      elemento("span", { clase: "valor-etiqueta", texto: mapa[valor] }),
      elemento("code", { clase: "valor-original", texto: ` (${original})` }),
    );
  } else {
    contenedor.append(elemento("code", { clase: "valor-original", texto: original }));
  }
  return contenedor;
}

/** Estados de un hallazgo (`findings[].status`). */
export const ESTADOS_HALLAZGO = {
  confirmed: "confirmado",
  unresolved: "no resuelto",
  rejected: "descartado",
  candidate: "candidato",
};

/** Estados de una comprobación (`checks[].status`). */
export const ESTADOS_COMPROBACION = {
  passed: "superada",
  failed: "fallida",
  blocked: "bloqueada",
  not_run: "no ejecutada",
};

/** Clase de un fallo (`checks[].failure_kind`). */
export const CLASES_FALLO = {
  product: "defecto de producto",
  fixture: "defecto de la prueba",
  environment: "problema de entorno",
};

/**
 * Bandera booleana declarada por la fuente. Solo `true` («si») y `false` («no»)
 * se traducen; un campo ausente es «ausente» y cualquier otra forma (`null`,
 * `"unknown"`, `"false"`, `0`, un objeto…) es «desconocido»: nunca se convierte
 * en una declaración que la fuente no hizo.
 */
export function banderaDeclarada(valor) {
  if (valor === true) return "si";
  if (valor === false) return "no";
  if (valor === undefined) return "ausente";
  return "desconocido";
}

/** Texto de un valor desconocido tal como lo declara la fuente. */
export function originalDeclarado(valor) {
  return JSON.stringify(valor) ?? String(valor);
}
