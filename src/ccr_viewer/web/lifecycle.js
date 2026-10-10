/**
 * Vista de trazabilidad: hitos, procedencia del tiempo y relaciones.
 *
 * Los tiempos se muestran como los declara la fuente, con su base y su origen.
 * Nunca se fabrica una duración a partir de dos tiempos de registro.
 */

import { elemento, seccion } from "./dom.js";
import { VELOCIDADES } from "./playback.js";

const BASE = {
  observed_occurrence: "ocurrencia observada",
  recording_fallback: "respaldo de registro",
  sequence_fallback: "respaldo de secuencia",
};

const ESTADO_CADENA = {
  verified: "cadena verificada",
  limited: "cadena con limitaciones",
  failed: "cadena no verificada",
  updating: "cadena en actualización",
};

function identidad(valor) {
  if (!valor) return null;
  const partes = [valor.name];
  if (valor.provider_id) partes.push(valor.provider_id);
  if (valor.kind) partes.unshift(valor.kind);
  return partes.filter(Boolean).join(" · ");
}

function filaEvento(evento, seleccionado) {
  const fila = elemento("li", {
    clase: seleccionado ? "hito hito--seleccionado" : "hito",
    atributos: { "data-event-id": evento.event_id },
  });
  const cabecera = elemento("div", { clase: "hito-cabecera" });
  cabecera.append(elemento("strong", { texto: `${evento.event_id} · ${evento.kind} · ${evento.status}` }));
  cabecera.append(elemento("span", { clase: "hito-resumen", texto: evento.summary ?? "" }));
  fila.append(cabecera);

  const meta = elemento("dl", { clase: "campos hito-meta" });
  const hora = elemento("dd");
  hora.textContent = evento.temporal_at ?? "sin tiempo utilizable";
  hora.append(
    elemento("span", {
      clase: "nota",
      texto: ` (base: ${BASE[evento.temporal_basis] ?? evento.temporal_basis ?? "desconocida"})`,
    }),
  );
  const campos = [
    ["Tiempo", hora],
    ["Registro", evento.recorded_at ?? null],
    ["Procedencia", evento.provenance ? `${evento.provenance.kind}: ${evento.provenance.source ?? "sin fuente"}` : null],
    ["Registrador", identidad(evento.recorder)],
    ["Actor", identidad(evento.actor)],
    ["Ejecutor", identidad(evento.executor)],
  ];
  for (const [etiqueta, valor] of campos) {
    if (valor === null || valor === undefined || valor === "") continue;
    const bloque = elemento("div", { clase: "campo" });
    bloque.append(elemento("dt", { texto: etiqueta }));
    const cuerpo = elemento("dd");
    if (typeof valor === "string") cuerpo.textContent = valor;
    else cuerpo.append(valor);
    bloque.append(cuerpo);
    meta.append(bloque);
  }
  if (meta.children.length > 0) fila.append(meta);
  return fila;
}

function controles(repeticion, redibujar) {
  const caja = elemento("div", { clase: "reproduccion", atributos: { role: "group", "aria-label": "Controles de reproducción" } });
  const boton = (texto, accion, atributos = {}) => {
    const nodo = elemento("button", { clase: "control", atributos: { type: "button", ...atributos }, texto });
    nodo.addEventListener("click", () => {
      accion();
      redibujar();
    });
    return nodo;
  };

  caja.append(
    boton("◀ Anterior", () => repeticion.step(-1), { "aria-label": "Evento anterior" }),
    boton("▶ Reproducir", () => (repeticion.state().mode === "playing" ? repeticion.pause() : repeticion.play())),
    boton("Pausar", () => repeticion.pause()),
    boton("Siguiente ▶", () => repeticion.step(1), { "aria-label": "Evento siguiente" }),
    boton("Volver a vivo", () => repeticion.resumeLive()),
  );

  const inicio = elemento("button", { clase: "control", atributos: { type: "button", "aria-label": "Primer evento" }, texto: "⏮" });
  inicio.addEventListener("click", () => {
    const primero = repeticion.order()[0];
    if (primero) repeticion.seek(primero);
    redibujar();
  });
  const final = elemento("button", { clase: "control", atributos: { type: "button", "aria-label": "Último evento" }, texto: "⏭" });
  final.addEventListener("click", () => {
    const ultimo = repeticion.order().at(-1);
    if (ultimo) repeticion.seek(ultimo);
    redibujar();
  });
  caja.append(inicio, final);

  const velocidad = elemento("select", { clase: "control", atributos: { "aria-label": "Velocidad de visualización" } });
  for (const valor of VELOCIDADES) {
    const opcion = elemento("option", { atributos: { value: String(valor) }, texto: `${valor}x` });
    if (valor === repeticion.state().speed) opcion.setAttribute("selected", "");
    velocidad.append(opcion);
  }
  velocidad.addEventListener("change", () => {
    repeticion.setSpeed(Number(velocidad.value));
    redibujar();
  });
  caja.append(elemento("span", { clase: "nota", texto: "Velocidad" }), velocidad);
  return caja;
}

/** Dibuja la traza con controles, procedencia y relaciones declaradas. */
export function renderLifecycle(contenedor, trace, repeticion) {
  contenedor.replaceChildren();
  if (!repeticion) {
    contenedor.append(
      seccion("Trazabilidad", [
        elemento("p", { clase: "estado", texto: "La revisión no tiene un control de reproducción disponible." }),
      ]),
    );
    return;
  }

  // Sólo se repinta el cuerpo: reconstruir los controles perdería el foco del
  // teclado y haría la reproducción inaccesible.
  const cuerpo = elemento("div", { clase: "cuerpo-trazabilidad" });
  const redibujar = () => {
    const desplazamiento = contenedor.scrollTop;
    pintarCuerpo(cuerpo, trace, repeticion);
    contenedor.scrollTop = desplazamiento;
  };

  const estado = repeticion.state();
  const cabecera = elemento("header", { clase: "revision-encabezado" });
  cabecera.append(elemento("h2", { texto: "Trazabilidad" }));
  cabecera.append(
    elemento("p", {
      clase: "identidad",
      texto: `${ESTADO_CADENA[trace.chain_status] ?? trace.chain_status ?? "estado desconocido"} · ${
        trace.valid_prefix_length ?? 0
      } evento(s) verificado(s)`,
    }),
  );
  if (estado.newEvents > 0) {
    cabecera.append(
      elemento("p", { clase: "estado estado--aviso", texto: `${estado.newEvents} evento(s) nuevo(s)` }),
    );
  }
  contenedor.append(cabecera, controles(repeticion, redibujar), cuerpo);
  pintarCuerpo(cuerpo, trace, repeticion);
}

/** Repinta hitos, orden temporal y relaciones sin tocar los controles. */
function pintarCuerpo(cuerpo, trace, repeticion) {
  cuerpo.replaceChildren();
  const estado = repeticion.state();
  if (estado.newEvents > 0) {
    cuerpo.append(
      elemento("p", { clase: "estado estado--aviso", texto: `${estado.newEvents} evento(s) nuevo(s)` }),
    );
  }

  if (!trace.events || trace.events.length === 0) {
    cuerpo.append(
      seccion("Hitos", [
        elemento("p", {
          clase: "estado",
          texto: trace.diagnostics?.length
            ? "La traza no pudo interpretarse; revisa los diagnósticos."
            : "Esta corrida no conserva hitos registrados.",
        }),
      ]),
    );
    return;
  }

  cuerpo.append(
    seccion(
      "Hitos en orden de grabación",
      [elemento("p", {
        clase: "nota",
        texto: "El orden canónico del productor no cambia aunque la vista se ordene por tiempo.",
      }), lista(repeticion.order(), repeticion)],
      "seccion seccion--hitos",
    ),
  );

  const ordenTemporal = repeticion.temporalOrder();
  cuerpo.append(
    seccion(
      "Orden temporal de presentación",
      [
        elemento("p", {
          clase: "nota",
          texto: "Preferencia por ocurrencia observada, luego registro y por último secuencia. "
            + "Fuentes y bases distintas no establecen un orden global de ejecución.",
        }),
        listaOrden(ordenTemporal),
      ],
      "seccion seccion--temporal",
    ),
  );

  const relaciones = trace.relations ?? [];
  const panel = relaciones.length > 0
    ? elemento("ul", { clase: "relaciones" })
    : elemento("p", { clase: "estado", texto: "El productor no declaró relaciones entre hitos." });
  for (const relacion of relaciones) {
    const item = elemento("li", { clase: `relacion relacion--${relacion.status ?? "unresolved"}` });
    item.append(elemento("strong", { texto: `${relacion.event_id} ${relacion.relation} ${relacion.target}` }));
    item.append(elemento("span", { clase: "nota", texto: ` · ${relacion.status ?? "sin resolver"}` }));
    panel.append(item);
  }
  cuerpo.append(seccion("Relaciones declaradas", [panel], "seccion seccion--relaciones"));

  if (trace.diagnostics?.length) {
    const lista = elemento("ul", { clase: "lista-simple" });
    for (const diagnostico of trace.diagnostics) {
      lista.append(elemento("li", { texto: `${diagnostico.code}: ${diagnostico.message}` }));
    }
    cuerpo.append(seccion("Limitaciones", [lista], "seccion seccion--limitaciones"));
  }
}

function lista(identificadores, repeticion) {
  const items = elemento("ol", { clase: "hitos" });
  for (const identificador of identificadores) {
    const evento = repeticion.event(identificador);
    if (!evento) continue;
    const fila = filaEvento(evento, identificador === repeticion.state().selectedEventId);
    fila.addEventListener("click", () => repeticion.seek(identificador));
    items.append(fila);
  }
  return items;
}

function listaOrden(identificadores) {
  const items = elemento("ol", { clase: "orden-temporal" });
  for (const identificador of identificadores) {
    items.append(elemento("li", { texto: identificador }));
  }
  return items;
}