/**
 * Preferencias locales de presentación.
 *
 * Solo viven en el navegador (`localStorage`) y solo afectan a cómo se ve el
 * visor: tema, densidad y movimiento. Nunca contienen datos de una revisión ni
 * credenciales. Si el almacenamiento no está disponible, el visor funciona con
 * los valores por omisión.
 */

export const PREFS_KEY = "ccr-viewer:prefs";

const OPCIONES = {
  theme: ["system", "light", "dark"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduce"],
};

const POR_OMISION = { theme: "system", density: "comfortable", motion: "system" };

/** Devuelve `localStorage` o `null` si el navegador lo bloquea. */
function almacenamientoLocal() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Conserva solo las claves conocidas con valores del vocabulario permitido. */
function normalizar(candidato) {
  const origen = candidato !== null && typeof candidato === "object" && !Array.isArray(candidato) ? candidato : {};
  const resultado = {};
  for (const [clave, permitidos] of Object.entries(OPCIONES)) {
    resultado[clave] = permitidos.includes(origen[clave]) ? origen[clave] : POR_OMISION[clave];
  }
  return resultado;
}

/** Lee las preferencias; ante cualquier fallo devuelve los valores por omisión. */
export function loadPrefs(storage = almacenamientoLocal()) {
  try {
    const crudo = storage?.getItem(PREFS_KEY);
    if (typeof crudo !== "string") return { ...POR_OMISION };
    return normalizar(JSON.parse(crudo));
  } catch {
    return { ...POR_OMISION };
  }
}

/** Guarda solo `theme`, `density` y `motion`; nunca lanza. */
export function savePrefs(prefs, storage = almacenamientoLocal()) {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(normalizar(prefs)));
  } catch {
    // Sin almacenamiento la preferencia dura solo la sesión.
  }
}

/** Refleja las preferencias en `root.dataset`; el valor por omisión borra la clave. */
export function applyPrefs(root, prefs) {
  const valores = normalizar(prefs);
  const fijar = (clave, activo, valor) => {
    if (activo) root.dataset[clave] = valor;
    else delete root.dataset[clave];
  };
  fijar("theme", valores.theme !== "system", valores.theme);
  fijar("density", valores.density === "compact", "compact");
  fijar("motion", valores.motion === "reduce", "reduce");
}

/** `true` si la persona o el sistema piden menos movimiento. */
export function prefersReducedMotion(prefs, matchMedia = globalThis.matchMedia) {
  if (prefs?.motion === "reduce") return true;
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}
