/**
 * Filtros de la biblioteca: claves, vocabulario del contrato, normalización,
 * validación y chips de los filtros aplicados.
 *
 * Son funciones puras sin DOM. Los valores de origen desconocidos se conservan
 * tal cual: el visor solo recorta espacios y descarta lo vacío.
 */

/** Claves que acepta `/api/runs`; ninguna otra viaja en la petición. */
export const FILTER_KEYS = Object.freeze([
  "q",
  "repository",
  "verdict",
  "profile",
  "mode",
  "reference",
  "kind",
  "open",
  "date_from",
  "date_to",
]);

// Valores del contrato empaquetado (`contracts/compatibility.json`, sección
// `review`). Una prueba compara estas constantes con el JSON para evitar deriva.
export const VERDICTS = Object.freeze([
  "approvable",
  "approvable_with_reservations",
  "not_approvable",
  "insufficient_evidence",
]);
export const PROFILES = Object.freeze(["economy", "balanced", "deep", "extended", "focused", "standard"]);
export const KINDS = Object.freeze(["review", "rereview", "complement"]);

const ABIERTA = new Set(["1", "true", "yes"]);
const CERRADA = new Set(["0", "false", "no"]);

const ETIQUETAS = {
  q: "Búsqueda",
  repository: "Repositorio",
  verdict: "Veredicto",
  profile: "Perfil",
  mode: "Modo",
  reference: "Referencia",
  kind: "Tipo",
  date_from: "Desde",
  date_to: "Hasta",
};

function comoTexto(valor) {
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "boolean") return String(valor);
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return "";
}

/** Recorta, descarta vacíos y las claves ajenas al contrato; conserva el resto. */
export function normalizeFilters(raw) {
  const filtros = {};
  if (raw === null || typeof raw !== "object") return filtros;
  for (const clave of FILTER_KEYS) {
    if (!Object.hasOwn(raw, clave)) continue;
    const texto = comoTexto(raw[clave]);
    if (texto !== "") filtros[clave] = texto;
  }
  return filtros;
}

/** `true` si ambos conjuntos de filtros normalizados son idénticos. */
export function sameFilters(a, b) {
  const [x, y] = [normalizeFilters(a), normalizeFilters(b)];
  const claves = Object.keys(x);
  return claves.length === Object.keys(y).length && claves.every((clave) => x[clave] === y[clave]);
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` si el texto es una fecha de calendario real con formato AAAA-MM-DD. */
function fechaReal(texto) {
  const partes = FECHA.exec(texto);
  if (!partes) return false;
  const [anio, mes, dia] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** Valida fechas; `errors` indica el campo y el motivo en español. */
export function validateFilters(filtros) {
  const f = normalizeFilters(filtros);
  const errors = {};
  for (const [clave, nombre] of [["date_from", "Desde"], ["date_to", "Hasta"]]) {
    if (f[clave] !== undefined && !fechaReal(f[clave])) {
      errors[clave] = `La fecha «${nombre}» no es válida; usa el formato AAAA-MM-DD.`;
    }
  }
  // AAAA-MM-DD ordena igual como texto que como fecha.
  if (!errors.date_from && !errors.date_to && f.date_from && f.date_to && f.date_from > f.date_to) {
    errors.date_from = "La fecha «Desde» no puede ser posterior a «Hasta».";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Chips de los filtros aplicados en el orden de `FILTER_KEYS`. */
export function filterChips(filtros) {
  const f = normalizeFilters(filtros);
  const chips = [];
  for (const clave of FILTER_KEYS) {
    const value = f[clave];
    if (value === undefined) continue;
    if (clave === "open") {
      const minuscula = value.toLowerCase();
      const label = ABIERTA.has(minuscula) ? "Abiertas" : CERRADA.has(minuscula) ? "Cerradas" : "Abiertas (valor no reconocido)";
      chips.push({ key: clave, label, value });
    } else {
      chips.push({ key: clave, label: ETIQUETAS[clave], value });
    }
  }
  return chips;
}

/** Valores de `field` presentes en la página actual, sin repetir ni vacíos. */
export function suggestFromPage(items, field) {
  const vistos = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (item === null || typeof item !== "object") continue;
    let valor;
    if (field === "repository") valor = item.repository_identity;
    else if (field === "reference") valor = item.scope_reference;
    // El servidor filtra `mode` por la primera palabra de `scope_label`.
    else if (field === "mode") valor = typeof item.scope_label === "string" ? item.scope_label.split(" ")[0] : "";
    else continue;
    const texto = comoTexto(valor);
    if (texto !== "") vistos.add(texto);
  }
  return [...vistos];
}
