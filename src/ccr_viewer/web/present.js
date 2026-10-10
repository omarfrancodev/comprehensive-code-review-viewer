/**
 * Presentación de valores declarados por la fuente.
 *
 * Estas funciones solo dan formato legible: nunca infieren la verdad de un
 * hallazgo ni inventan títulos, actores o instantes que la fuente no declara.
 */

const PR_URL = /\/pull\/([0-9]+)(?:[/?#]|$)/;
const MR_URL = /\/merge_requests\/([0-9]+)(?:[/?#]|$)/;
const REFERENCIA = /^([#!]?)([0-9]+)$/;

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

/** Reconoce PR/MR en la referencia; `null` si no es reconocible. */
function reconocerCambio(modo, referencia) {
  const simple = REFERENCIA.exec(referencia);
  if (simple) {
    const [, marcador, numero] = simple;
    if (modo === "pr") return { kind: "pr", numero };
    if (modo === "mr") return { kind: "mr", numero };
    if (marcador === "#") return { kind: "pr", numero };
    if (marcador === "!") return { kind: "mr", numero };
    return null;
  }
  const pull = PR_URL.exec(referencia);
  if (pull) return { kind: "pr", numero: pull[1] };
  const merge = MR_URL.exec(referencia);
  if (merge) return { kind: "mr", numero: merge[1] };
  return null;
}

/** Título legible de una revisión a partir de su alcance declarado. */
export function runTitle(summary) {
  const etiqueta = texto(summary?.scope_label);
  const referencia = texto(summary?.scope_reference);
  if (referencia) {
    const modo = etiqueta.split(/\s+/)[0].toLowerCase();
    const cambio = reconocerCambio(modo, referencia);
    if (cambio?.kind === "pr") return { label: `PR #${cambio.numero}`, kind: "pr" };
    if (cambio?.kind === "mr") return { label: `MR !${cambio.numero}`, kind: "mr" };
  }
  if (etiqueta) return { label: etiqueta, kind: "scope" };
  if (referencia) return { label: referencia, kind: "reference" };
  const clave = texto(summary?.key);
  return { label: clave ? `Revisión ${clave.slice(0, 8)}` : "Revisión sin identificar", kind: "key" };
}

/**
 * Etiqueta cada revisión y añade una pista solo cuando la etiqueta se repite.
 * La pista es el ID de origen declarado o, si falta, el inicio de la clave.
 */
export function labelRuns(items) {
  const titulos = (items ?? []).map((item) => ({ item, titulo: runTitle(item) }));
  const repeticiones = new Map();
  for (const { titulo } of titulos) {
    repeticiones.set(titulo.label, (repeticiones.get(titulo.label) ?? 0) + 1);
  }
  const resultado = new Map();
  for (const { item, titulo } of titulos) {
    let hint = null;
    if (repeticiones.get(titulo.label) > 1) {
      const origen = texto(item?.source_review_id);
      hint = origen || texto(item?.key).slice(0, 8) || null;
    }
    resultado.set(item?.key, { label: titulo.label, hint });
  }
  return resultado;
}

function identidadDeActor(actor) {
  if (typeof actor === "string") return { kind: "", name: actor.trim(), provider_id: "" };
  if (actor === null || typeof actor !== "object") return null;
  const identidad = { kind: texto(actor.kind), name: texto(actor.name), provider_id: texto(actor.provider_id) };
  return identidad.kind || identidad.name || identidad.provider_id ? identidad : null;
}

/** Clave estable de la identidad declarada; `"∅"` si no hay actor. */
export function actorKey(actor) {
  const identidad = identidadDeActor(actor);
  if (!identidad) return "∅";
  return JSON.stringify([identidad.kind, identidad.name, identidad.provider_id]);
}

/** Etiqueta del actor, p. ej. «agent · a1». */
export function actorLabel(actor) {
  const identidad = identidadDeActor(actor);
  if (!identidad) return "Actor no declarado";
  const partes = [identidad.kind, identidad.name].filter(Boolean);
  return partes.length ? partes.join(" · ") : identidad.provider_id;
}

// Solo se aceptan instantes ISO 8601 con desplazamiento explícito: sin él, el
// navegador los interpretaría en la zona local y fabricaría un instante.
const INSTANTE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})$/;

/** Formatea un instante sin perder el valor original; lo inválido queda sin interpretar. */
export function formatInstant(value) {
  if (value === null || value === undefined || value === "") {
    return { local: null, utc: null, original: null };
  }
  const original = String(value);
  const normalizado = typeof value === "string" ? value.trim().replace(" ", "T") : "";
  if (!INSTANTE.test(normalizado)) return { local: null, utc: null, original };
  const fecha = new Date(normalizado);
  if (!Number.isFinite(fecha.getTime())) return { local: null, utc: null, original };
  return {
    local: fecha.toLocaleString("es", { dateStyle: "medium", timeStyle: "medium" }),
    utc: fecha.toISOString(),
    original,
  };
}

const BASE = {
  observed_occurrence: { label: "ocurrencia observada", shape: "circle" },
  recording_fallback: { label: "respaldo de registro", shape: "diamond" },
  sequence_fallback: { label: "respaldo de secuencia", shape: "hollow" },
};

/** Texto en español de la base temporal; el valor original si es desconocido. */
export function basisLabel(basis) {
  if (typeof basis === "string" && Object.hasOwn(BASE, basis)) return BASE[basis].label;
  if (basis === null || basis === undefined || basis === "") return "base no declarada";
  return String(basis);
}

/** Forma del marcador: lo observado es sólido; los respaldos son más débiles. */
export function basisShape(basis) {
  if (typeof basis === "string" && Object.hasOwn(BASE, basis)) return BASE[basis].shape;
  return "hollow";
}
