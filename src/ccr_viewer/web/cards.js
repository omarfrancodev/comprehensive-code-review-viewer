/**
 * Tarjetas del explorador (§6.3, §6.4).
 *
 * Una página de como máximo 50 hitos en orden de secuencia: botón de
 * selección con metadata breve y resumen, tipo, estado original y hora
 * declarada con su base. No imprime todos los metadatos ni repite una lista
 * de IDs. Es una lista semántica (`<ol>`), sin `role=feed`.
 *
 * Estados: `received` (en el modelo, aún sin presentar en el recorrido),
 * `revealing` (la única tarjeta que se presenta) y `complete`.
 */

import { botonAccion, elemento, fijarInactivo, reconciliarHijos, textoDe } from "./dom.js";
import { actorKey, actorLabel } from "./present.js";
import { nodoTiempo } from "./timeline.js";

/** Estado visual de la tarjeta `id` según el presentador. */
export function estadoDeTarjeta(id, modelo, actual) {
  if (actual.reveal && actual.reveal.eventId === id && actual.reveal.progress < 1) return "revealing";
  const posicion = modelo.index.get(id);
  return posicion !== undefined && posicion < actual.presentedCount ? "complete" : "received";
}

function separador() {
  return elemento("span", { clase: "tarjeta-separador", texto: " · " });
}

/**
 * Lista paginada de tarjetas. `render` reutiliza las tarjetas ya montadas y
 * solo reconstruye las que cambiaron en la fuente; `sincronizar` actualiza
 * estado y selección sin tocar el resto.
 */
export function crearTarjetas({ onSelect, onPagina, onDesplazar }) {
  const raiz = elemento("div", { clase: "explorador-tarjetas", atributos: { "data-part": "cards" } });
  const cabecera = elemento("div", { clase: "tarjetas-cabecera" });
  const rango = elemento("p", { clase: "tarjetas-rango" });
  const anterior = botonAccion("Tarjetas anteriores", () => onPagina(-1));
  const siguiente = botonAccion("Tarjetas siguientes", () => onPagina(1));
  cabecera.append(rango, anterior, siguiente);
  const panel = elemento("div", {
    clase: "tarjetas-panel",
    atributos: { tabindex: "0", role: "region", "aria-label": "Tarjetas en orden de secuencia" },
  });
  const lista = elemento("ol", { clase: "tarjetas" });
  const vacio = elemento("p", { clase: "estado", atributos: { hidden: true } });
  panel.append(lista, vacio);
  panel.addEventListener("scroll", () => onDesplazar(), { passive: true });
  raiz.append(cabecera, panel);

  const cache = new Map();

  function llenar(entrada, evento, etiqueta) {
    const id = evento.event_id;
    const boton = elemento("button", { clase: "tarjeta-boton", atributos: { type: "button" } });
    const meta = elemento("span", { clase: "tarjeta-meta" });
    const secuencia = typeof evento.sequence === "number" ? `#${evento.sequence}` : "secuencia no declarada";
    meta.append(
      elemento("span", { clase: "tarjeta-actor", texto: etiqueta }),
      separador(),
      elemento("code", { clase: "tarjeta-id", texto: id }),
      separador(),
      elemento("span", { clase: "tarjeta-secuencia", texto: secuencia }),
    );
    boton.append(
      meta,
      elemento("span", { clase: "solo-lectores", texto: ": " }),
      elemento("span", { clase: "tarjeta-resumen", texto: textoDe(evento.summary) ?? "Sin resumen declarado." }),
    );
    boton.addEventListener("click", () => onSelect(id));
    const pie = elemento("div", { clase: "tarjeta-pie" });
    pie.append(
      elemento("span", { clase: "tarjeta-tipo", texto: textoDe(evento.kind) ?? "tipo no declarado" }),
      elemento("span", { clase: "tarjeta-estado", texto: textoDe(evento.status) ?? "estado no declarado" }),
      nodoTiempo(evento),
    );
    const recibido = elemento("span", { clase: "tarjeta-recibido", texto: "Recibido · sin presentar", atributos: { hidden: true } });
    const conFoco = entrada.li.contains(document.activeElement);
    entrada.li.replaceChildren(boton, pie, recibido);
    if (conFoco) boton.focus({ preventScroll: true });
    Object.assign(entrada, { boton, recibido, etiqueta });
  }

  function sincronizar(actual, modelo) {
    for (const [id, entrada] of cache) {
      const estado = estadoDeTarjeta(id, modelo, actual);
      if (entrada.li.dataset.state !== estado) entrada.li.dataset.state = estado;
      entrada.recibido.hidden = estado !== "received";
      if (id === actual.selectedId) entrada.li.setAttribute("aria-current", "true");
      else entrada.li.removeAttribute("aria-current");
    }
  }

  return {
    elemento: raiz,
    panel,
    /**
     * `ids` es la página (≤50) en orden; `pagina` describe su rango dentro de
     * la lista completa (o de las coincidencias si `pagina.busqueda`).
     */
    render(modelo, ids, pagina, etiquetas, cambiados, mensajeVacio) {
      const nodos = [];
      const vigentes = new Set();
      for (const id of ids) {
        const evento = modelo.byId.get(id);
        const clave = actorKey(evento.actor);
        const etiqueta = etiquetas.get(clave) ?? actorLabel(evento.actor);
        let entrada = cache.get(id);
        if (!entrada) {
          entrada = { li: elemento("li", { clase: "tarjeta", atributos: { "data-event-id": id } }) };
          llenar(entrada, evento, etiqueta);
          cache.set(id, entrada);
        } else if (cambiados.has(id) || entrada.etiqueta !== etiqueta) {
          llenar(entrada, evento, etiqueta);
        }
        vigentes.add(id);
        nodos.push(entrada.li);
      }
      for (const id of [...cache.keys()]) if (!vigentes.has(id)) cache.delete(id);
      reconciliarHijos(lista, nodos);
      lista.hidden = nodos.length === 0;
      vacio.hidden = nodos.length > 0;
      vacio.textContent = nodos.length > 0 ? "" : mensajeVacio;
      const paginado = pagina.total > ids.length || pagina.start > 0;
      anterior.hidden = !paginado;
      siguiente.hidden = !paginado;
      fijarInactivo(anterior, pagina.start === 0);
      fijarInactivo(siguiente, pagina.end >= pagina.total);
      const nombre = pagina.busqueda ? "Coincidencias" : "Tarjetas";
      rango.textContent = pagina.total === 0
        ? (pagina.busqueda ? "Sin coincidencias" : "Sin tarjetas")
        : `${nombre} ${pagina.start + 1}–${pagina.end} de ${pagina.total}`;
    },
    sincronizar,
    li: (id) => cache.get(id)?.li ?? null,
    boton: (id) => cache.get(id)?.boton ?? null,
    /** Nodo estable que recibe el foco si el enfocado se retiró: la tarjeta o el panel. */
    respaldoDeFoco: (id) => cache.get(id)?.boton ?? panel,
  };
}
