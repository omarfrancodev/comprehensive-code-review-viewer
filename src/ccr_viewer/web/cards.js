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
 *
 * Revelado (§7): la tarjeta en `revealing` recibe `--etapa-estructura`,
 * `--etapa-cabecera`, `--etapa-contenido` y `--etapa-acciones` (0–1) con
 * `style.setProperty`; el CSS las traduce a máscara, opacidad y transformación
 * de sus partes. El texto completo está en el DOM desde el principio (copiar,
 * buscar y lectores nunca ven una versión parcial) y el espacio de la tarjeta
 * es el final desde el primer fotograma: nada se mide ni cambia de altura.
 * Mientras las acciones están ocultas, solo sus botones (`data-part="action-buttons"`)
 * son `inert`: tipo, estado original, hora y «Recibido» siguen en el árbol de
 * accesibilidad, seleccionables y localizables durante todo el revelado.
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

/** Etapa del presentador → propiedad CSS de la tarjeta. */
const ETAPAS = [
  ["structure", "--etapa-estructura"],
  ["header", "--etapa-cabecera"],
  ["content", "--etapa-contenido"],
  ["actions", "--etapa-acciones"],
];

let resumenes = 0;

/** Copia el resumen completo; si el portapapeles falla, lo deja seleccionado. */
async function copiarResumen(texto, nodo, rotulo) {
  try {
    await globalThis.navigator.clipboard.writeText(texto);
    rotulo.textContent = "Resumen copiado";
  } catch {
    globalThis.getSelection?.()?.selectAllChildren(nodo);
    rotulo.textContent = "Resumen seleccionado para copiar";
  }
}

/**
 * Aplica (o retira, con `etapas` nulo) el revelado sobre una tarjeta. Solo
 * escribe lo que cambió: una tarjeta por fotograma, sin tocar el resto.
 */
function fijarRevelado(entrada, etapas) {
  const { li, boton, botones, resumen } = entrada;
  if (!etapas) {
    if (!entrada.revelado) return;
    entrada.revelado = null;
    for (const [, propiedad] of ETAPAS) li.style.removeProperty(propiedad);
    boton.removeAttribute("aria-describedby");
    botones.inert = false;
    return;
  }
  if (!entrada.revelado) {
    entrada.revelado = {};
    // El botón principal ofrece de inmediato el resumen completo.
    boton.setAttribute("aria-describedby", resumen.id);
  }
  for (const [nombre, propiedad] of ETAPAS) {
    const valor = String(etapas[nombre] ?? 1);
    if (entrada.revelado[nombre] === valor) continue;
    entrada.revelado[nombre] = valor;
    li.style.setProperty(propiedad, valor);
  }
  // Botones de acción visualmente ocultos no reciben foco; los datos del pie no se ocultan.
  const ocultas = !(etapas.actions > 0);
  if (botones.inert !== ocultas) {
    if (ocultas && botones.contains(document.activeElement)) boton.focus({ preventScroll: true });
    botones.inert = ocultas;
  }
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
    const meta = elemento("span", { clase: "tarjeta-meta", atributos: { "data-part": "header" } });
    const secuencia = typeof evento.sequence === "number" ? `#${evento.sequence}` : "secuencia no declarada";
    meta.append(
      elemento("span", { clase: "tarjeta-actor", texto: etiqueta }),
      separador(),
      elemento("code", { clase: "tarjeta-id", texto: id }),
      separador(),
      elemento("span", { clase: "tarjeta-secuencia", texto: secuencia }),
    );
    const textoResumen = textoDe(evento.summary);
    const resumen = elemento("span", {
      clase: "tarjeta-resumen",
      texto: textoResumen ?? "Sin resumen declarado.",
      atributos: { id: `tarjeta-resumen-${++resumenes}`, "data-part": "content" },
    });
    boton.append(meta, elemento("span", { clase: "solo-lectores", texto: ": " }), resumen);
    boton.addEventListener("click", () => onSelect(id));
    // «Recibido» comparte la fila del pie: presentar la tarjeta no cambia su altura.
    const recibido = elemento("span", { clase: "tarjeta-recibido", texto: "Recibido · sin presentar", atributos: { hidden: true } });
    const acciones = elemento("div", { clase: "tarjeta-pie", atributos: { "data-part": "actions" } });
    acciones.append(
      elemento("span", { clase: "tarjeta-tipo", texto: textoDe(evento.kind) ?? "tipo no declarado" }),
      elemento("span", { clase: "tarjeta-estado", texto: textoDe(evento.status) ?? "estado no declarado" }),
      nodoTiempo(evento),
      recibido,
    );
    // Solo los elementos interactivos del pie: es lo único que se vuelve `inert`.
    const botones = elemento("span", { clase: "tarjeta-botones", atributos: { "data-part": "action-buttons" } });
    if (textoResumen !== null) {
      const rotulo = elemento("span", { texto: "Copiar resumen" });
      const copiar = elemento("button", { clase: "tarjeta-copiar", atributos: { type: "button" } });
      copiar.append(rotulo, elemento("span", { clase: "solo-lectores", texto: ` de ${id}` }));
      copiar.addEventListener("click", () => copiarResumen(textoResumen, resumen, rotulo));
      copiar.addEventListener("blur", () => { rotulo.textContent = "Copiar resumen"; });
      botones.append(copiar);
    }
    // Brillo decorativo de la etapa de estructura.
    const brillo = elemento("span", { clase: "tarjeta-brillo", atributos: { "data-part": "shimmer", "aria-hidden": "true" } });
    const conFoco = entrada.li.contains(document.activeElement);
    if (botones.childElementCount > 0) acciones.append(botones);
    entrada.li.replaceChildren(brillo, boton, acciones);
    if (conFoco) boton.focus({ preventScroll: true });
    // Nodos nuevos: `sincronizar` (en la misma tarea) vuelve a aplicar el revelado vigente.
    if (entrada.revelado) for (const [, propiedad] of ETAPAS) entrada.li.style.removeProperty(propiedad);
    Object.assign(entrada, { boton, botones, resumen, recibido, etiqueta, revelado: null });
  }

  function sincronizar(actual, modelo) {
    for (const [id, entrada] of cache) {
      const estado = estadoDeTarjeta(id, modelo, actual);
      if (entrada.li.dataset.state !== estado) entrada.li.dataset.state = estado;
      entrada.recibido.hidden = estado !== "received";
      fijarRevelado(entrada, estado === "revealing" ? actual.reveal.stages : null);
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
    /**
     * Fotograma del revelado: escribe las etapas solo en la tarjeta que se
     * revela. Devuelve `false` si ya no hay revelado en curso (el estado
     * discreto de las tarjetas debe sincronizarse entonces).
     */
    revelar(actual) {
      const reveal = actual.reveal;
      if (!reveal || !(reveal.progress < 1)) return false;
      const entrada = cache.get(reveal.eventId);
      if (entrada?.li.dataset.state === "revealing") fijarRevelado(entrada, reveal.stages);
      return true;
    },
    li: (id) => cache.get(id)?.li ?? null,
    boton: (id) => cache.get(id)?.boton ?? null,
    /** Nodo estable que recibe el foco si el enfocado se retiró: la tarjeta o el panel. */
    respaldoDeFoco: (id) => cache.get(id)?.boton ?? panel,
  };
}
