/**
 * Reproducción de la traza de hitos: cursor y único reloj de presentación.
 *
 * Cada paso dura `PASO_BASE_MS / velocidad`: revelado del elemento
 * (`REVELADO_BASE_MS`) más una separación de 550 ms a 1×. Son decisiones de
 * diseño, nunca duración de ejecución: el visor no afirma cuánto tardó el
 * productor. Los tiempos mostrados son los declarados por la fuente.
 *
 * El reloj se inyecta (`opciones.clock`: `ahora`, `programar`, `cancelar`).
 * Pausar congela el tiempo transcurrido del paso y reanudar programa solo el
 * restante; el presentador deriva el revelado de `stepElapsedMs`.
 */

/** Duración de un paso a 1×: 1800 ms de revelado + 550 ms de separación. */
export const PASO_BASE_MS = 2350;

/** Duración del revelado de un elemento a 1×. */
export const REVELADO_BASE_MS = 1800;

/** Únicas velocidades permitidas. */
export const VELOCIDADES = [0.5, 1, 2, 4];

function relojDelNavegador() {
  return {
    ahora: () => Date.now(),
    programar: (fn, ms) => setTimeout(fn, ms),
    cancelar: (id) => clearTimeout(id),
  };
}

function porSecuencia(eventos) {
  return [...eventos].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

/**
 * Crea el control de reproducción de una traza.
 *
 * Arranca en pausa con el último evento seleccionado: no hay autoplay.
 */
export function createPlayback(eventos = [], opciones = {}) {
  const reloj = opciones.clock ?? relojDelNavegador();
  let lista = porSecuencia(eventos);
  const vistos = new Set(lista.map((evento) => evento.event_id));
  let indice = Math.max(0, lista.length - 1);
  let modo = "paused";
  let velocidad = opciones.speed ?? 1;
  if (!VELOCIDADES.includes(velocidad)) velocidad = 1;
  let nuevos = 0;
  let temporizador = null;
  // Tiempo del paso actual acumulado antes del tramo en curso.
  let acumulado = 0;
  // Instante de reloj en que empezó el tramo en curso (solo reproduciendo).
  let inicioTramo = null;
  // `present()` cronometra el paso del seleccionado sin avanzar al siguiente.
  let soloPresentar = false;
  let destruido = false;
  const listeners = new Set();

  const duracionPaso = () => PASO_BASE_MS / velocidad;
  const transcurrido = () => {
    const tramo = modo === "playing" && inicioTramo !== null ? reloj.ahora() - inicioTramo : 0;
    return Math.min(duracionPaso(), acumulado + tramo);
  };

  const estado = () => ({
    mode: modo,
    selectedEventId: lista[indice]?.event_id ?? null,
    speed: velocidad,
    newEvents: nuevos,
    stepElapsedMs: transcurrido(),
    stepMs: duracionPaso(),
  });

  const notify = () => {
    const actual = estado();
    for (const listener of [...listeners]) listener(actual);
  };

  const parar = () => {
    if (temporizador !== null) {
      reloj.cancelar(temporizador);
      temporizador = null;
    }
  };

  /** Detiene el reloj conservando el tiempo transcurrido del paso. */
  const congelar = () => {
    acumulado = transcurrido();
    inicioTramo = null;
    parar();
    modo = "paused";
  };

  /** Coloca el cursor: el paso empieza de cero y en pausa. */
  const colocar = (posicion) => {
    parar();
    indice = posicion;
    acumulado = 0;
    inicioTramo = null;
    soloPresentar = false;
    modo = "paused";
  };

  /** Navegación explícita: además descarta el contador de nuevos. */
  const mover = (posicion) => {
    colocar(posicion);
    nuevos = 0;
  };

  const alTerminarPaso = () => {
    temporizador = null;
    if (soloPresentar || indice >= lista.length - 1) {
      acumulado = duracionPaso();
      inicioTramo = null;
      soloPresentar = false;
      modo = "paused";
      notify();
      return;
    }
    indice += 1;
    acumulado = 0;
    programar();
    notify();
  };

  /** Programa solo el tiempo restante del paso actual. */
  const programar = () => {
    parar();
    inicioTramo = reloj.ahora();
    temporizador = reloj.programar(alTerminarPaso, Math.max(0, duracionPaso() - acumulado));
  };

  return {
    state: estado,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },

    /** Orden canónico de grabación; no cambia aunque se ordene la vista. */
    order: () => lista.map((evento) => evento.event_id),

    /** Orden temporal de presentación, tal como lo calculó el visor. */
    temporalOrder: () =>
      [...lista]
        .sort((a, b) => {
          const left = Date.parse(a.temporal_at ?? a.occurred_at ?? a.recorded_at);
          const right = Date.parse(b.temporal_at ?? b.occurred_at ?? b.recorded_at);
          if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
          const tiempo = Number.isFinite(left) ? left - right : 0;
          if (tiempo !== 0) return tiempo;
          return (a.sequence ?? 0) - (b.sequence ?? 0);
        })
        .map((evento) => evento.event_id),

    events: () => [...lista],

    event: (eventId) => lista.find((evento) => evento.event_id === eventId) ?? null,

    step(delta) {
      if (destruido || lista.length === 0) return;
      mover(Math.min(Math.max(indice + delta, 0), lista.length - 1));
      notify();
    },

    seek(eventId) {
      if (destruido) return;
      const encontrado = lista.findIndex((evento) => evento.event_id === eventId);
      if (encontrado < 0) return;
      mover(encontrado);
      notify();
    },

    /** Selecciona el más reciente por secuencia y descarta el contador de nuevos. */
    last() {
      if (destruido) return;
      mover(Math.max(0, lista.length - 1));
      notify();
    },

    /** Reproduce desde el punto conservado; en el último evento es no-op. */
    play() {
      if (destruido || lista.length === 0 || indice >= lista.length - 1) return;
      if (modo === "playing" && !soloPresentar) return;
      soloPresentar = false;
      modo = "playing";
      programar();
      notify();
    },

    /**
     * Cronometra el paso del evento seleccionado desde el punto conservado y
     * queda en pausa al terminar, sin avanzar (presentación de una llegada).
     */
    present() {
      if (destruido || lista.length === 0) return;
      soloPresentar = true;
      modo = "playing";
      programar();
      notify();
    },

    pause() {
      if (destruido) return;
      const estabaReproduciendo = modo === "playing";
      congelar();
      if (estabaReproduciendo) notify();
    },

    /** Cambia la velocidad conservando la fracción recorrida del paso. */
    setSpeed(valor) {
      if (!VELOCIDADES.includes(valor)) {
        throw new Error(`velocidad no permitida: ${valor}`);
      }
      if (destruido || valor === velocidad) {
        velocidad = valor;
        return;
      }
      const fraccion = transcurrido() / duracionPaso();
      velocidad = valor;
      acumulado = fraccion * duracionPaso();
      if (modo === "playing") programar();
      else inicioTramo = null;
    },

    /**
     * Sustituye la lista por la instantánea recibida sin mover un cursor
     * pausado. Cada ID nuevo cuenta una sola vez, también tras reconectar; una
     * instantánea sin cambios no notifica.
     */
    ingest(trace) {
      if (destruido) return;
      const entrantes = Array.isArray(trace) ? trace : trace?.events;
      if (!Array.isArray(entrantes)) return;
      const antes = estado().selectedEventId;
      const nuevosAntes = nuevos;
      for (const evento of entrantes) {
        if (vistos.has(evento.event_id)) continue;
        vistos.add(evento.event_id);
        nuevos += 1;
      }
      // Orden canónico de grabación aunque la traza llegue desordenada.
      lista = porSecuencia(entrantes);
      const posicion = antes === null ? -1 : lista.findIndex((evento) => evento.event_id === antes);
      if (posicion >= 0) {
        indice = posicion;
      } else if (antes === null) {
        // Sin selección previa (traza vacía) rige la regla inicial: el último.
        colocar(Math.max(0, lista.length - 1));
      } else {
        // La selección ya no existe: se acota al final y el paso empieza de cero.
        colocar(Math.max(0, Math.min(indice, lista.length - 1)));
      }
      if (estado().selectedEventId !== antes || nuevos !== nuevosAntes) notify();
    },

    destroy() {
      parar();
      acumulado = transcurrido();
      inicioTramo = null;
      modo = "paused";
      destruido = true;
      lista = [];
      listeners.clear();
    },
  };
}
