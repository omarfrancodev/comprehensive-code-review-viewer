/**
 * Reproducción de la traza de hitos.
 *
 * El intervalo de 800 ms es velocidad de visualización, nunca duración de
 * ejecución: el visor no afirma cuánto tardó el productor. Los tiempos que se
 * muestran son los declarados por la fuente, con su base y su procedencia.
 */

/** Intervalo de visualización a velocidad 1x. */
export const INTERVALO_BASE_MS = 800;

/** Únicas velocidades permitidas. */
export const VELOCIDADES = [0.5, 1, 2, 4];

const RELOJ_POR_DEFECTO = {
  ahora: () => Date.now(),
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (id) => clearTimeout(id),
};

function relojDelNavegador() {
  if (typeof globalThis !== "undefined" && typeof globalThis.setTimeout === "function") {
    return {
      ahora: () => Date.now(),
      programar: (fn, ms) => setTimeout(fn, ms),
      cancelar: (id) => clearTimeout(id),
    };
  }
  return RELOJ_POR_DEFECTO;
}

/** Identificador del último evento conocido por orden de secuencia. */
function ultimoPorSecuencia(eventos) {
  if (eventos.length === 0) return null;
  return [...eventos].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).at(-1).event_id;
}

/** Crea el control de reproducción de una traza. */
export function createPlayback(eventos = [], opciones = {}) {
  const reloj = opciones.clock ?? relojDelNavegador();
  let lista = [...eventos];
  let vistos = new Set(lista.map((evento) => evento.event_id));
  let indice = Math.max(0, lista.length - 1);
  let modo = "live";
  let velocidad = opciones.speed ?? 1;
  let nuevos = 0;
  let temporizador = null;

  const estado = () => ({
    mode: modo,
    selectedEventId: lista[indice]?.event_id ?? null,
    speed: velocidad,
    newEvents: nuevos,
  });

  const parar = () => {
    if (temporizador !== null) {
      reloj.cancelar(temporizador);
      temporizador = null;
    }
  };

  const avanzar = (delta) => {
    const siguiente = Math.min(Math.max(indice + delta, 0), lista.length - 1);
    indice = siguiente;
    modo = "paused";
    nuevos = 0;
  };

  const programar = () => {
    parar();
    if (modo !== "playing") return;
    const espera = INTERVALO_BASE_MS / velocidad;
    temporizador = reloj.programar(() => {
      if (indice >= lista.length - 1) {
        parar();
        modo = "paused";
        return;
      }
      indice += 1;
      programar();
    }, espera);
  };

  return {
    state: estado,

    /** Orden canónico de grabación; no cambia aunque se ordene la vista. */
    order: () => lista.map((evento) => evento.event_id),

    /** Orden temporal de presentación, tal como lo calculó el visor. */
    temporalOrder: () =>
      [...lista]
        .sort((a, b) => {
          const base = (a.temporal_basis ?? "").localeCompare(b.temporal_basis ?? "");
          if (base !== 0) return base;
          const tiempo = (a.temporal_at ?? "").localeCompare(b.temporal_at ?? "");
          if (tiempo !== 0) return tiempo;
          return (a.sequence ?? 0) - (b.sequence ?? 0);
        })
        .map((evento) => evento.event_id),

    events: () => [...lista],

    event: (eventId) => lista.find((evento) => evento.event_id === eventId) ?? null,

    step(delta) {
      if (modo === "playing") parar();
      avanzar(delta);
    },

    seek(eventId) {
      const encontrado = lista.findIndex((evento) => evento.event_id === eventId);
      if (encontrado < 0) return;
      if (modo === "playing") parar();
      indice = encontrado;
      modo = "paused";
      nuevos = 0;
    },

    play() {
      if (lista.length === 0) return;
      if (modo === "live") indice = 0;
      modo = "playing";
      programar();
    },

    pause() {
      parar();
      modo = "paused";
    },

    setSpeed(valor) {
      if (!VELOCIDADES.includes(valor)) {
        throw new Error(`velocidad no permitida: ${valor}`);
      }
      velocidad = valor;
      if (modo === "playing") programar();
    },

    /** Incorpora una traza nueva sin mover un cursor pausado. */
    ingest(trace) {
      const entrantes = Array.isArray(trace?.events) ? trace.events : [];
      const nuevosVistos = entrantes.filter((evento) => !vistos.has(evento.event_id));
      nuevos += nuevosVistos.length;
      for (const evento of nuevosVistos) vistos.add(evento.event_id);

      // Se conserva el orden canónico de grabación aunque la traza llegue desordenada.
      const porIdentificador = new Map(lista.map((evento) => [evento.event_id, evento]));
      for (const evento of entrantes) porIdentificador.set(evento.event_id, evento);
      lista = [...porIdentificador.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

      const seleccionado = estado().selectedEventId;
      if (modo !== "live" && seleccionado) {
        // Un evento con hora anterior no desplaza un cursor pausado.
        const posicion = lista.findIndex((evento) => evento.event_id === seleccionado);
        if (posicion >= 0) indice = posicion;
      } else if (modo === "live") {
        indice = Math.max(0, lista.length - 1);
      }
    },

    /** Vuelve al último evento y descarta el contador de eventos nuevos. */
    resumeLive() {
      parar();
      modo = "live";
      nuevos = 0;
      indice = Math.max(0, lista.length - 1);
    },

    destroy() {
      parar();
      modo = "paused";
      lista = [];
    },
  };
}