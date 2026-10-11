/**
 * Controles de En Vivo (§8, §8.2) e indicador de fuente del último hito.
 *
 * La disponibilidad sale solo de `presenter.state().live` (el cierre de la
 * revisión tras una lectura coherente); la conexión nunca habilita En Vivo.
 * El botón deshabilitado conserva el foco (`aria-disabled`) y enlaza su motivo
 * visible. «Reanudar En Vivo», «Mostrar nuevos» y el contador «N nuevos sin
 * presentar» solo aparecen cuando aplican.
 *
 * El indicador de fuente (`data-part="source-loader"`) es distinto del brillo
 * del revelado (`data-part="shimmer"`): representa el cierre `processing` de
 * la revisión, no que un actor esté ejecutando algo. Sin conexión (o mientras
 * se espera la recarga tras reconectar) es un icono estático con «Último
 * estado conocido: processing · sin conexión».
 */

import { botonAccion, elemento, fijarInactivo } from "./dom.js";

export const ETIQUETA_FUENTE_ACTIVA = "Último hito activo · revisión en procesamiento";
export const ETIQUETA_FUENTE_ESTATICA = "Último estado conocido: processing · sin conexión";

const MOTIVOS = {
  updating: "Archivo en actualización",
  not_processing: "En Vivo no disponible: la revisión no está en procesamiento.",
  unknown: "En Vivo no disponible: el estado del cierre es desconocido; no se infiere actividad.",
};

let montajes = 0;

/** Texto de la carga de fuente según su tipo (`active` o `static`). */
export function etiquetaFuente(tipo) {
  return tipo === "static" ? ETIQUETA_FUENTE_ESTATICA : ETIQUETA_FUENTE_ACTIVA;
}

/** Nodo del indicador de fuente: icono decorativo y etiqueta textual. */
export function nodoCargaFuente({ oculto = false } = {}) {
  const nodo = elemento("span", { clase: "fuente-carga", atributos: { "data-part": "source-loader" } });
  if (oculto) nodo.setAttribute("aria-hidden", "true");
  nodo.append(
    elemento("span", { clase: "fuente-icono", atributos: { "aria-hidden": "true" } }),
    elemento("span", { clase: oculto ? "fuente-texto solo-lectores" : "fuente-texto" }),
  );
  return nodo;
}

/** Ajusta el indicador a `active` o `static` (solo escribe si cambia). */
export function fijarCargaFuente(nodo, tipo) {
  if (nodo.dataset.loader === tipo) return;
  nodo.dataset.loader = tipo;
  nodo.querySelector(".fuente-texto").textContent = etiquetaFuente(tipo);
}

/**
 * Monta los controles en `container`.
 *
 * Opciones: `presenter`, `isMounted(id)` (la tarjeta del hito está en la
 * página y el filtro actuales) y `onShowLast(id)` (acceso explícito al último
 * activo cuando no está montado).
 */
export function mountLiveControls(container, { presenter, isMounted = () => true, onShowLast } = {}) {
  const n = ++montajes;
  const motivoId = `vivo-motivo-${n}`;
  const raiz = elemento("div", {
    clase: "explorador-vivo",
    atributos: { "data-part": "live", role: "group", "aria-label": "En Vivo" },
  });
  const fila = elemento("div", { clase: "vivo-fila" });
  const alternar = elemento("button", {
    clase: "vivo-boton",
    atributos: { type: "button", "data-part": "live-toggle", "aria-pressed": "false" },
  });
  alternar.append(elemento("span", { clase: "vivo-punto", atributos: { "aria-hidden": "true" } }), elemento("span", { texto: "En Vivo" }));
  const reanudar = botonAccion("Reanudar En Vivo", () => presenter.resumeLive(), { atributos: { hidden: true } });
  const contador = elemento("span", { clase: "vivo-contador", atributos: { "data-part": "pending-count", hidden: true } });
  const mostrar = botonAccion("Mostrar nuevos", () => presenter.showPending(), { atributos: { hidden: true } });
  fila.append(alternar, reanudar, contador, mostrar);
  const motivo = elemento("p", { clase: "vivo-motivo nota", atributos: { id: motivoId, "data-part": "live-reason", hidden: true } });
  const fuente = elemento("p", { clase: "vivo-fuente", atributos: { "data-part": "live-source", hidden: true } });
  const fuenteTexto = elemento("span");
  const fuenteEstado = elemento("span", { clase: "vivo-fuente-estado" });
  let ultimoMostrable = null;
  const irUltimo = botonAccion("Ir al último activo", () => {
    if (ultimoMostrable) onShowLast?.(ultimoMostrable);
  });
  fuente.append(fuenteTexto, fuenteEstado, irUltimo);
  const aviso = elemento("p", { clase: "vivo-aviso estado estado--aviso", atributos: { "data-part": "live-notice", hidden: true } });
  raiz.append(fila, motivo, fuente, aviso);
  container.append(raiz);

  let avisoMostrado = null;
  let destruido = false;

  alternar.addEventListener("click", () => {
    if (destruido || alternar.getAttribute("aria-disabled") === "true") return;
    const actual = presenter.state();
    if (actual.mode !== "live") presenter.enterLive();
    else if (actual.paused) presenter.resumeLive();
    else presenter.pause("user");
  });

  /** Un control que se oculta con el foco lo cede al botón En Vivo, sin desplazar. */
  function ocultar(nodo, oculto) {
    if (oculto && !nodo.hidden && nodo.contains(document.activeElement)) alternar.focus({ preventScroll: true });
    nodo.hidden = oculto;
  }

  function update() {
    if (destruido) return;
    const actual = presenter.state();
    const enVivo = actual.mode === "live";
    const siguiendo = enVivo && !actual.paused;
    alternar.setAttribute("aria-pressed", String(siguiendo));
    // En replay solo `processing` coherente habilita; en En Vivo (incluso con un
    // cierre parcial) el botón sigue sirviendo para pausar o reanudar.
    const inactivo = !enVivo && !actual.live.enabled;
    fijarInactivo(alternar, inactivo);
    const textoMotivo = actual.live.enabled ? "" : (MOTIVOS[actual.live.reason] ?? MOTIVOS.unknown);
    motivo.textContent = textoMotivo;
    motivo.hidden = textoMotivo === "";
    if (textoMotivo) alternar.setAttribute("aria-describedby", motivoId);
    else alternar.removeAttribute("aria-describedby");
    ocultar(reanudar, !(enVivo && actual.paused));

    const pendientes = actual.pendingIds.length;
    contador.textContent = pendientes === 0 ? "" : `${pendientes} ${pendientes === 1 ? "nuevo" : "nuevos"} sin presentar`;
    contador.hidden = pendientes === 0;
    ocultar(mostrar, pendientes === 0);

    const ultimo = actual.lastActiveId;
    const fuera = typeof ultimo === "string" && !isMounted(ultimo);
    ultimoMostrable = fuera ? ultimo : null;
    if (fuera) {
      fuenteTexto.textContent = `Último activo: ${ultimo}`;
      fuenteEstado.textContent = actual.loader === "static" ? ` · ${ETIQUETA_FUENTE_ESTATICA}` : "";
    }
    ocultar(fuente, !fuera);
    raiz.dataset.loader = actual.loader;

    // Diagnósticos de la recarga (prefijo, hito eliminado o modificado, fin de
    // En Vivo) quedan visibles; las llegadas se reflejan en el contador.
    const notice = actual.notice;
    if (notice && notice.id !== avisoMostrado && notice.code !== "events_arrived") {
      avisoMostrado = notice.id;
      aviso.dataset.code = notice.code;
      aviso.textContent = notice.text;
      aviso.hidden = false;
    }
  }

  update();
  return {
    elemento: raiz,
    update,
    destroy() {
      destruido = true;
      raiz.remove();
    },
  };
}
