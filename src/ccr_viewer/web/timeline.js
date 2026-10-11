/**
 * Timeline del explorador y controles del recorrido (§6.3, §6.4).
 *
 * Los marcadores se reparten por pasos de secuencia: la distancia entre dos
 * puntos es un paso de presentación, nunca una duración. Se pinta una ventana
 * de como máximo 50 marcadores; la forma depende de la base temporal (círculo,
 * rombo o hueco) y el nombre accesible la describe sin depender del color.
 * Los tiempos se muestran como los declara la fuente, con su base.
 */

import { botonAccion, elemento, fijarInactivo, reconciliarHijos } from "./dom.js";
import { VELOCIDADES } from "./playback.js";
import { basisLabel, basisShape, formatInstant } from "./present.js";

let identificadores = 0;
const nuevoId = (prefijo) => `${prefijo}-${++identificadores}`;

/** Hora declarada del hito y su base; nunca se fabrica un instante. */
export function tiempoDeHito(evento) {
  const base = basisLabel(evento?.temporal_basis);
  const instante = formatInstant(evento?.temporal_at);
  if (instante.original === null) return { base, instante, texto: "sin hora", sinHora: true };
  if (instante.local === null) return { base, instante, texto: `hora sin interpretar: ${instante.original}`, sinHora: false };
  return { base, instante, texto: instante.local, sinHora: false };
}

/** Hora local con UTC y valor original en `title`, seguida de su base. */
export function nodoTiempo(evento) {
  const tiempo = tiempoDeHito(evento);
  const caja = elemento("span", { clase: "hito-tiempo" });
  if (tiempo.instante.local !== null) {
    caja.append(
      elemento("time", {
        texto: tiempo.instante.local,
        atributos: {
          datetime: tiempo.instante.original,
          title: `${tiempo.instante.utc} UTC · Origen: ${tiempo.instante.original}`,
        },
      }),
    );
  } else {
    caja.append(elemento("span", { clase: "valor--desconocido", texto: tiempo.texto }));
  }
  caja.append(elemento("span", { clase: "hito-base", texto: ` · ${tiempo.base}` }));
  return caja;
}

function simbolo(forma, texto) {
  const item = elemento("span", { clase: "leyenda-item" });
  item.append(elemento("span", { clase: "leyenda-forma", atributos: { "data-shape": forma, "aria-hidden": "true" } }), elemento("span", { texto }));
  return item;
}

/** Lleva `nodo` a la vista dentro de la pista horizontal, sin mover la página. */
function mostrarEnPista(pista, nodo) {
  const caja = pista.getBoundingClientRect();
  const destino = nodo.getBoundingClientRect();
  if (destino.left < caja.left) pista.scrollLeft += destino.left - caja.left - 8;
  else if (destino.right > caja.right) pista.scrollLeft += destino.right - caja.right + 8;
}

/**
 * Timeline por ventanas. `render` pinta la ventana `[start, end)` de `total`
 * reutilizando los marcadores ya montados; `seleccionar` solo actualiza el
 * marcador actual y el cursor.
 */
export function crearTimeline({ onSelect, onVentana }) {
  const raiz = elemento("div", {
    clase: "explorador-timeline",
    atributos: { "data-part": "timeline", role: "group", "aria-label": "Secuencia global de hitos" },
  });
  const cabecera = elemento("div", { clase: "timeline-cabecera" });
  const rango = elemento("span", { clase: "timeline-rango" });
  const anterior = botonAccion("Ventana anterior", () => onVentana(-1));
  const siguiente = botonAccion("Siguiente ventana", () => onVentana(1));
  cabecera.append(elemento("span", { clase: "timeline-titulo", texto: "Secuencia global" }), rango, anterior, siguiente);
  const pista = elemento("div", { clase: "timeline-pista" });
  const linea = elemento("div", { clase: "timeline-linea" });
  const lista = elemento("ol", { clase: "timeline-marcadores" });
  const cursor = elemento("div", { clase: "timeline-cursor", atributos: { "data-part": "cursor", "aria-hidden": "true" } });
  linea.append(lista, cursor);
  pista.append(linea);
  const leyenda = elemento("p", { clase: "timeline-leyenda" });
  leyenda.append(
    simbolo("circle", "ocurrencia observada"),
    simbolo("diamond", "respaldo de registro"),
    simbolo("hollow", "sin hora · respaldo de secuencia"),
    elemento("span", { texto: "Espaciado por pasos de secuencia, no por duración." }),
  );
  raiz.append(cabecera, pista, leyenda);

  const cache = new Map();
  let modelo = null;
  let inicio = 0;
  let cantidad = 0;

  function actualizar(entrada, evento) {
    const tiempo = tiempoDeHito(evento);
    const nombre = `${evento.event_id} · ${tiempo.texto} · ${tiempo.base}`;
    entrada.boton.dataset.basis = typeof evento.temporal_basis === "string" ? evento.temporal_basis : "";
    entrada.boton.dataset.shape = basisShape(evento.temporal_basis);
    entrada.boton.setAttribute("aria-label", nombre);
    entrada.boton.title = nombre;
  }

  function crear(evento) {
    const id = evento.event_id;
    const boton = elemento("button", { clase: "marcador", atributos: { type: "button", "data-event-id": id } });
    boton.addEventListener("click", () => onSelect(id));
    const li = elemento("li", { clase: "timeline-punto" });
    li.append(boton);
    const entrada = { li, boton };
    actualizar(entrada, evento);
    return entrada;
  }

  function seleccionar(id) {
    let posicion = -1;
    for (const [clave, entrada] of cache) {
      if (clave === id) {
        entrada.boton.setAttribute("aria-current", "true");
        posicion = modelo.index.get(id) - inicio;
        if (pista.scrollWidth > pista.clientWidth) mostrarEnPista(pista, entrada.boton);
      } else {
        entrada.boton.removeAttribute("aria-current");
      }
    }
    cursor.hidden = posicion < 0;
    if (posicion >= 0) linea.style.setProperty("--cursor", `${((posicion + 0.5) / cantidad) * 100}%`);
  }

  return {
    elemento: raiz,
    render(nuevoModelo, ventana, seleccionado, cambiados) {
      modelo = nuevoModelo;
      inicio = ventana.start;
      cantidad = ventana.end - ventana.start;
      const nodos = [];
      const vigentes = new Set();
      for (let i = ventana.start; i < ventana.end; i += 1) {
        const evento = modelo.events[i];
        let entrada = cache.get(evento.event_id);
        if (!entrada) {
          entrada = crear(evento);
          cache.set(evento.event_id, entrada);
        } else if (cambiados.has(evento.event_id)) {
          actualizar(entrada, evento);
        }
        vigentes.add(evento.event_id);
        nodos.push(entrada.li);
      }
      for (const clave of [...cache.keys()]) if (!vigentes.has(clave)) cache.delete(clave);
      reconciliarHijos(lista, nodos);
      linea.style.setProperty("--marcadores", String(Math.max(1, cantidad)));
      const paginado = ventana.total > ventana.end - ventana.start || ventana.start > 0;
      anterior.hidden = !paginado;
      siguiente.hidden = !paginado;
      fijarInactivo(anterior, ventana.start === 0);
      fijarInactivo(siguiente, ventana.end >= ventana.total);
      rango.textContent = paginado
        ? `${ventana.start + 1}–${ventana.end} de ${ventana.total}`
        : `${ventana.total} ${ventana.total === 1 ? "hito" : "hitos"}`;
      seleccionar(seleccionado);
    },
    seleccionar,
    /** Nodo estable que recibe el foco si el enfocado se retiró: el marcador, la navegación o el primero. */
    respaldoDeFoco(id) {
      return cache.get(id)?.boton
        ?? [anterior, siguiente].find((boton) => !boton.hidden)
        ?? cache.values().next().value?.boton
        ?? null;
    },
  };
}

/**
 * Controles del recorrido. Los botones inactivos usan `aria-disabled` para no
 * perder el foco; los pasos se acotan en el presentador.
 */
export function crearControles(acciones) {
  const raiz = elemento("div", {
    clase: "explorador-controles",
    atributos: { "data-part": "controls", role: "group", "aria-label": "Controles de reproducción" },
  });
  const motivoId = nuevoId("motivo-reproducir");
  const velocidadId = nuevoId("velocidad");
  const botones = elemento("div", { clase: "controles-botones" });
  const reiniciar = botonAccion("Reiniciar", acciones.onReiniciar);
  const anterior = botonAccion("Evento anterior", () => acciones.onPaso(-1));
  const alternar = botonAccion("Reproducir", acciones.onAlternar, { clase: "boton-primario" });
  const siguiente = botonAccion("Evento siguiente", () => acciones.onPaso(1));
  const ultimo = botonAccion("Ir al último", acciones.onUltimo);
  const velocidad = elemento("select", { atributos: { id: velocidadId } });
  for (const valor of VELOCIDADES) velocidad.append(elemento("option", { atributos: { value: String(valor) }, texto: `${valor}×` }));
  velocidad.addEventListener("change", () => acciones.onVelocidad(Number(velocidad.value)));
  const campoVelocidad = elemento("span", { clase: "controles-velocidad" });
  campoVelocidad.append(elemento("label", { texto: "Velocidad", atributos: { for: velocidadId } }), velocidad);
  const completa = botonAccion("Mostrar tarjeta completa", acciones.onCompleta);
  const seguir = botonAccion("Seguir recorrido", acciones.onSeguir, { atributos: { "aria-pressed": "true" } });
  botones.append(reiniciar, anterior, alternar, siguiente, ultimo, campoVelocidad, completa, seguir);

  const deslizador = elemento("input", {
    clase: "controles-posicion",
    atributos: { type: "range", min: "0", max: "0", step: "1", value: "0", "aria-label": "Posición del recorrido" },
  });
  deslizador.addEventListener("input", () => acciones.onPosicion(Number(deslizador.value)));
  const estado = elemento("p", { clase: "controles-estado" });
  const motivo = elemento("p", {
    clase: "nota",
    texto: "Ya estás en el último hito: usa «Reiniciar» para recorrer desde el principio.",
    atributos: { id: motivoId, hidden: true },
  });
  raiz.append(botones, deslizador, estado, motivo);

  return {
    elemento: raiz,
    sincronizar(actual, modelo, siguiendo) {
      const total = modelo.events.length;
      const id = actual.selectedId;
      const posicion = id !== null && modelo.index.has(id) ? modelo.index.get(id) : -1;
      const reproduciendo = !actual.paused;
      alternar.textContent = reproduciendo ? "Pausar" : "Reproducir";
      const sinSiguiente = !reproduciendo && !actual.canPlay;
      fijarInactivo(alternar, sinSiguiente);
      motivo.hidden = !(sinSiguiente && total > 0 && posicion === total - 1);
      if (motivo.hidden) alternar.removeAttribute("aria-describedby");
      else alternar.setAttribute("aria-describedby", motivoId);
      deslizador.max = String(Math.max(0, total - 1));
      if (posicion >= 0) {
        deslizador.value = String(posicion);
        const resumen = typeof modelo.byId.get(id).summary === "string" ? ` · ${modelo.byId.get(id).summary}` : "";
        deslizador.setAttribute("aria-valuetext", `${id}${resumen} (${posicion + 1} de ${total})`);
      }
      velocidad.value = String(actual.speed);
      fijarInactivo(completa, !(actual.reveal && actual.reveal.progress < 1));
      seguir.setAttribute("aria-pressed", String(Boolean(siguiendo)));
      estado.textContent = posicion >= 0
        ? `Paso ${posicion + 1} de ${total} · ${reproduciendo ? "reproduciendo" : "en pausa"}`
        : "";
    },
  };
}
