/**
 * Ruta local acotada del visor.
 *
 * La URL solo puede llevar tres valores locales y validados: la revisión
 * (`run`), la pestaña (`tab`) y el hito (`event`). Cualquier otra clave, en
 * particular el token de sesión, se ignora y nunca se escribe.
 */

/** Pestañas navegables, en el orden en que se muestran. */
export const ROUTE_TABS = [
  "ficha",
  "hallazgos",
  "validacion",
  "seguimiento",
  "documentos",
  "trazabilidad",
  "archivo",
];

const RUN = /^[0-9a-f]{32}$/;
const EVENT = /^E[0-9]{6}$/;

function validar(route) {
  const origen = route !== null && typeof route === "object" ? route : {};
  const run = typeof origen.run === "string" && RUN.test(origen.run) ? origen.run : null;
  const tab = typeof origen.tab === "string" && ROUTE_TABS.includes(origen.tab) ? origen.tab : null;
  const event = typeof origen.event === "string" && EVENT.test(origen.event) ? origen.event : null;
  return { run, tab, event };
}

/** Interpreta `location.search`; lo no válido queda en `null`. */
export function parseRoute(search) {
  let parametros;
  try {
    parametros = new URLSearchParams(typeof search === "string" ? search : "");
  } catch {
    return { run: null, tab: null, event: null };
  }
  return validar({
    run: parametros.get("run"),
    tab: parametros.get("tab"),
    event: parametros.get("event"),
  });
}

/** Construye `""` o `?run=…&tab=…&event=…` con valores ya validados. */
export function buildRoute(route) {
  const { run, tab, event } = validar(route);
  const partes = [];
  if (run) partes.push(`run=${run}`);
  if (tab) partes.push(`tab=${tab}`);
  if (event) partes.push(`event=${event}`);
  return partes.length ? `?${partes.join("&")}` : "";
}
