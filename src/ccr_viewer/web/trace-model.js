/**
 * Modelo derivado de la traza (parte pura: sin DOM, sin temporizadores, sin reloj).
 *
 * El modelo se construye una sola vez por respuesta de `/trace`. Conserva los
 * objetos originales del backend sin copiar ni descartar campos, y no infiere
 * concurrencia, ruta crítica ni duraciones: el orden temporal del backend se
 * guarda tal como llegó y las tarjetas siguen `sequence`.
 */

import { actorKey, actorLabel } from "./present.js";

/** Tamaño de las ventanas de tarjetas renderizadas. */
export const WINDOW_SIZE = 50;

function texto(valor) {
  return typeof valor === "string" ? valor : "";
}

function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function lista(valor) {
  return Array.isArray(valor) ? valor : [];
}

function posicionDeSecuencia(evento) {
  const secuencia = evento?.sequence;
  return typeof secuencia === "number" && Number.isFinite(secuencia) ? secuencia : Number.POSITIVE_INFINITY;
}

/**
 * Comparador único del orden de eventos (modelo y reproducción): por
 * `sequence` numérica finita; una ausente o no numérica va al final y los
 * empates conservan el orden de llegada (el ordenamiento es estable).
 */
export function compareBySequence(a, b) {
  const pa = posicionDeSecuencia(a);
  const pb = posicionDeSecuencia(b);
  if (pa === pb) return 0;
  return pa < pb ? -1 : 1;
}

/** Texto de búsqueda en minúsculas: actor, ID, tipo, estado y resumen. */
function pajar(evento) {
  const actor = evento.actor;
  const partes = [texto(evento.event_id), texto(evento.kind), texto(evento.status), texto(evento.summary), actorLabel(actor)];
  if (esObjeto(actor)) partes.push(texto(actor.kind), texto(actor.name), texto(actor.provider_id));
  else if (typeof actor === "string") partes.push(actor);
  return partes.join("\n").toLowerCase();
}

function agrupar(relaciones, campo) {
  const mapa = new Map();
  for (const relacion of relaciones) {
    if (!esObjeto(relacion)) continue;
    const clave = relacion[campo];
    if (typeof clave !== "string") continue;
    const grupo = mapa.get(clave);
    if (grupo) grupo.push(relacion);
    else mapa.set(clave, [relacion]);
  }
  return mapa;
}

function tamanoDeVentana(size) {
  return Number.isInteger(size) && size > 0 ? size : WINDOW_SIZE;
}

/**
 * Construye el modelo completo de una respuesta de traza.
 * Entradas ausentes o mal formadas producen un modelo vacío, nunca una excepción.
 */
export function buildTraceModel(trace) {
  const origen = esObjeto(trace) ? trace : {};

  // Orden estable por `sequence`; los objetos son los originales.
  const vistos = new Set();
  const events = [];
  for (const evento of lista(origen.events)) {
    if (!esObjeto(evento) || typeof evento.event_id !== "string" || evento.event_id === "") continue;
    if (vistos.has(evento.event_id)) continue;
    vistos.add(evento.event_id);
    events.push(evento);
  }
  events.sort(compareBySequence);

  const byId = new Map();
  const index = new Map();
  const claves = new Array(events.length);
  const pajares = new Array(events.length);
  const actorPorClave = new Map();
  events.forEach((evento, posicion) => {
    byId.set(evento.event_id, evento);
    index.set(evento.event_id, posicion);
    const clave = actorKey(evento.actor);
    claves[posicion] = clave;
    pajares[posicion] = pajar(evento);
    const actual = actorPorClave.get(clave);
    if (actual) actual.count += 1;
    else actorPorClave.set(clave, { key: clave, label: actorLabel(evento.actor), count: 1, firstId: evento.event_id });
  });
  const actors = [...actorPorClave.values()];

  const estado = typeof origen.chain_status === "string" ? origen.chain_status : "";
  const prefijo = origen.valid_prefix_length;
  const chain = {
    status: estado,
    verified: estado === "verified",
    updating: estado === "updating",
    validPrefixLength: Number.isInteger(prefijo) && prefijo >= 0 ? prefijo : events.length,
  };

  const relations = lista(origen.relations);
  const salientes = agrupar(relations, "event_id");
  const entrantes = agrupar(relations, "target");
  const total = events.length;

  return {
    events,
    byId,
    index,
    lastId: total ? events[total - 1].event_id : null,
    actors,
    chain,
    diagnostics: lista(origen.diagnostics),
    relations,
    temporalOrder: lista(origen.temporal_order),

    /** IDs, en orden de `sequence`, de los eventos que contienen la consulta. */
    search(query) {
      const consulta = texto(query).trim().toLowerCase();
      if (!consulta) return [];
      const resultado = [];
      for (let i = 0; i < total; i += 1) {
        if (pajares[i].includes(consulta)) resultado.push(events[i].event_id);
      }
      return resultado;
    },

    /**
     * Ventana `[start, end)` de tamaño fijo alineada a múltiplos de `size` que
     * contiene el evento; sin ID (o con uno desconocido) devuelve la última.
     */
    windowAround(eventId, size = WINDOW_SIZE) {
      const tamano = tamanoDeVentana(size);
      if (total === 0) return { start: 0, end: 0, total: 0 };
      const posicion = typeof eventId === "string" && index.has(eventId) ? index.get(eventId) : total - 1;
      const start = Math.floor(posicion / tamano) * tamano;
      return { start, end: Math.min(start + tamano, total), total };
    },

    /** Primer evento (por `sequence`) del actor, opcionalmente dentro de `within`. */
    firstOfActor(key, within) {
      if (within === undefined || within === null) {
        return actorPorClave.get(key)?.firstId ?? null;
      }
      const permitidos = new Set(within);
      for (let i = 0; i < total; i += 1) {
        if (claves[i] === key && permitidos.has(events[i].event_id)) return events[i].event_id;
      }
      return null;
    },

    /** Relaciones salientes (por `event_id`) y entrantes (por `target`). */
    relationsOf(eventId) {
      return {
        outgoing: [...(salientes.get(eventId) ?? [])],
        incoming: [...(entrantes.get(eventId) ?? [])],
      };
    },
  };
}

function cambiado(anterior, siguiente) {
  const a = anterior.sha256;
  const s = siguiente.sha256;
  if (typeof a === "string" && typeof s === "string") return a !== s;
  if (a !== undefined || s !== undefined) return true;
  return JSON.stringify(anterior) !== JSON.stringify(siguiente);
}

/**
 * Compara el modelo anterior con el nuevo, por ID.
 *
 * - `newIds`: IDs de `next` ausentes en `previous`, en orden de `sequence`.
 * - `changedIds`: mismo ID con contenido distinto (se actualiza, no es nuevo).
 * - `prefixReplaced`: `next` no contiene todos los IDs previos (prefijo más
 *   corto o distinto); el modelo anterior no puede extenderse.
 *
 * Sin modelo anterior no hay nada que comparar: la primera carga no es «nueva».
 */
export function reconcileTrace(previous, next) {
  if (!previous) return { newIds: [], changedIds: [], prefixReplaced: false };
  const newIds = [];
  const changedIds = [];
  for (const evento of next.events) {
    const anterior = previous.byId.get(evento.event_id);
    if (!anterior) newIds.push(evento.event_id);
    else if (cambiado(anterior, evento)) changedIds.push(evento.event_id);
  }
  let prefixReplaced = false;
  for (const evento of previous.events) {
    if (!next.byId.has(evento.event_id)) {
      prefixReplaced = true;
      break;
    }
  }
  return { newIds, changedIds, prefixReplaced };
}
