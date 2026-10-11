/**
 * Transporte del visor: sesión de capacidad, peticiones JSON y avisos en vivo.
 *
 * El token viaja sólo en el fragmento de la dirección de arranque y se canjea
 * por una cookie HttpOnly de sesión. Nunca se guarda en localStorage.
 */

const TOKEN_KEY = "token";

/** Canjea el token del fragmento por una sesión y limpia el fragmento del historial. */
export async function bootstrapSession(fragment) {
  const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const token = new URLSearchParams(raw).get(TOKEN_KEY);
  if (!token) return false;
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error("No se pudo establecer la sesión local.");
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

/**
 * Devuelve `data` o lanza un `Error` cuyo mensaje es el del sobre de la API.
 * El error lleva además `status` (HTTP) y `code` (p. ej. `unknown_id`) para
 * que quien llama distinga una corrida ausente de un fallo de lectura.
 */
async function unwrap(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    if (response.ok) throw error;
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? "Error inesperado.");
    error.status = response.status;
    error.code = typeof payload?.error?.code === "string" ? payload.error.code : null;
    throw error;
  }
  return payload.data;
}

/** Ejecuta una petición autenticada por cookie y devuelve `data`. */
export async function request(path, options = {}) {
  const { method = "GET", body } = options;
  const init = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return unwrap(await fetch(path, init));
}

export const getConfig = () => request("/api/config");

export const getRuns = (filters = {}, offset = 0) => {
  const query = new URLSearchParams({ offset: String(offset), limit: "50" });
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
  }
  return request(`/api/runs?${query}`);
};

export const getRun = (key) => request(`/api/runs/${key}`);
export const getTrace = (key) => request(`/api/runs/${key}/trace`);
export const getFiles = (key) => request(`/api/runs/${key}/files`);
export const getPreview = (runKey, fileKey) => request(`/api/runs/${runKey}/files/${fileKey}`);
export const validateRun = (key) => request(`/api/runs/${key}/validate`, { method: "POST" });

/**
 * Suscribe la aplicación a los avisos del servidor.
 *
 * El navegador reenvía `Last-Event-ID` automáticamente al reconectar; si el
 * servidor ya no conserva ese cursor, envía un aviso `resync` y toca recargar
 * una instantánea coherente en lugar de perder avisos.
 *
 * Devuelve la función para cancelar la suscripción.
 */
export function subscribeNotices(onNotice, onState) {
  const source = new EventSource("/api/events", { withCredentials: true });
  source.onopen = () => onState("connected");
  source.onerror = () => onState("disconnected");
  source.addEventListener("notice", (event) => {
    let notice;
    try {
      notice = JSON.parse(event.data);
    } catch {
      onState("disconnected");
      return;
    }
    onNotice(notice);
  });
  return () => source.close();
}