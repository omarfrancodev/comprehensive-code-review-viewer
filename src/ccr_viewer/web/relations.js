/**
 * Relaciones y evidencia de un hito (§9), parte pura: sin DOM ni red.
 *
 * Solo una relación `resolved` cuyo destino está dentro de la raíz habilita
 * navegación; el resto conserva su valor original con una explicación y nunca
 * se resuelve por parecido. La evidencia solo enlaza coincidencias exactas del
 * inventario local por `relative_path` y devuelve la clave opaca del archivo:
 * quien la usa nunca concatena la ruta del archivo a una URL de la API.
 */

const EVENTO = /^E[0-9]{6}$/;
const HALLAZGO = /^F[0-9]{3,}$/;
const CHECK = /^C[0-9]{3,}$/;
// Mismo vocabulario que el backend (`trace._CROSS_REVIEW`).
const ENTRE_CORRIDAS = /^CR-[0-9a-f]{20}#(E[0-9]{6}|F[0-9]{3,}|C[0-9]{3,})$/;

const MOTIVOS = {
  dangling: "El destino no aparece en esta traza; se conserva el valor original y no se busca un hito parecido.",
  unresolved: "El destino no se pudo resolver en esta revisión (p. ej. un hallazgo candidato descartado o un destino no canónico); se conserva el valor original.",
  ambiguous: "Varias revisiones de la raíz coinciden con el destino; no se elige ninguna.",
  unavailable: "La revisión de destino no está disponible en la raíz seleccionada; no se buscan rutas fuera de ella.",
  cyclic: "Ciclo declarado (diagnóstico relation.cyclic): la relación forma un ciclo y no se recorre automáticamente.",
};

const SIN_NAVEGACION = (reason) => ({ navigable: false, scope: "none", reason });

function ambitoLocal(id) {
  if (EVENTO.test(id)) return "event";
  if (HALLAZGO.test(id)) return "finding";
  if (CHECK.test(id)) return "check";
  return null;
}

/**
 * Clasifica una relación resuelta por el backend respecto de la corrida actual.
 *
 * Devuelve `{ navigable, scope, reason }`; si navega, también `id` (destino
 * local) y, entre corridas, `runKey` (clave opaca de la corrida de destino).
 */
export function classifyRelation(relation, currentRunKey) {
  if (relation === null || typeof relation !== "object" || Array.isArray(relation)) {
    return SIN_NAVEGACION("La relación no tiene una forma reconocible; se conserva sin interpretar.");
  }
  const estado = relation.status;
  if (estado !== "resolved") {
    if (typeof estado === "string" && Object.hasOwn(MOTIVOS, estado)) return SIN_NAVEGACION(MOTIVOS[estado]);
    const valor = typeof estado === "string" && estado ? `«${estado}»` : "no declarado";
    return SIN_NAVEGACION(`Estado de resolución ${valor} no reconocido; no se navega.`);
  }
  const destino = typeof relation.target === "string" ? relation.target : "";
  const corrida = typeof relation.run_key === "string" ? relation.run_key : "";
  if (!corrida) return SIN_NAVEGACION("La relación resuelta no declara la revisión de destino; no se navega.");
  if (corrida === currentRunKey) {
    const scope = ambitoLocal(destino);
    if (!scope) return SIN_NAVEGACION("El destino local no es un hito, hallazgo ni check reconocible; no se navega.");
    return { navigable: true, scope, reason: "", id: destino };
  }
  const cruce = ENTRE_CORRIDAS.exec(destino);
  if (!cruce) return SIN_NAVEGACION("El destino entre revisiones no tiene una forma reconocible; no se navega.");
  return { navigable: true, scope: "run", reason: "", id: cruce[1], runKey: corrida };
}

/** Diagnóstico legible de una evidencia inerte, por código. */
export const MOTIVOS_EVIDENCIA = {
  absolute_path: "Ruta absoluta: el visor solo enlaza archivos del inventario de la corrida.",
  path_traversal: "La ruta sale de la corrida («..»); se muestra como texto.",
  url: "Es una dirección (URL); no se abre ni se consulta evidencia remota.",
  not_in_inventory: "No coincide exactamente con ningún archivo del inventario; no se busca por nombre ni por parecido.",
  unrecognized: "Forma de evidencia no reconocida; se conserva su valor original.",
};

/**
 * Evidencia declarada por un hito como lista: sin campo, ninguna; un valor
 * que no es lista se conserva como un único elemento (quedará inerte).
 */
export function evidenciasDe(evento) {
  const valor = evento?.evidence;
  if (valor === null || valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

const inerte = (text, code) => ({ kind: "inert", text, code });

function rutaCandidata(item) {
  if (typeof item === "string") return item;
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  if (typeof item.relative_path === "string") return item.relative_path;
  if (typeof item.path === "string") return item.path;
  return null;
}

function textoOriginal(item) {
  try {
    return JSON.stringify(item) ?? String(item);
  } catch {
    return String(item);
  }
}

/**
 * Enlace de una evidencia declarada: un archivo del inventario por coincidencia
 * exacta de `relative_path`, o texto inerte con su código de diagnóstico.
 */
export function evidenceLink(item, inventory) {
  const ruta = rutaCandidata(item);
  if (ruta === null || ruta.trim() === "") return inerte(typeof item === "string" ? item : textoOriginal(item), "unrecognized");
  if (/^[\\/]/.test(ruta) || /^[A-Za-z]:/.test(ruta)) return inerte(ruta, "absolute_path");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ruta)) return inerte(ruta, "url");
  if (ruta.split(/[\\/]/).includes("..")) return inerte(ruta, "path_traversal");
  const archivos = Array.isArray(inventory) ? inventory : [];
  const exacto = archivos.find((archivo) =>
    archivo !== null && typeof archivo === "object"
    && typeof archivo.key === "string" && archivo.key !== ""
    && archivo.relative_path === ruta);
  if (!exacto) return inerte(ruta, "not_in_inventory");
  return { kind: "file", fileKey: exacto.key, relativePath: exacto.relative_path };
}
