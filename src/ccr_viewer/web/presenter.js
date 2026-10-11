/**
 * Controlador de presentación de la traza (parte pura: sin DOM ni CSS).
 *
 * Coordina el recorrido (`replay`), el revelado del elemento, la cola de IDs
 * nuevos y la disponibilidad de En Vivo. Hay un único reloj: el de
 * `createPlayback`. El presentador no programa temporizadores propios; deriva
 * el progreso del revelado de `stepElapsedMs` y la UI lo lee con `state()`
 * en cada frame (las suscripciones solo avisan de cambios discretos).
 *
 * Las duraciones son decisiones de diseño, nunca tiempos del productor.
 */

import { createPlayback, REVELADO_BASE_MS } from "./playback.js";
import { buildTraceModel, reconcileTrace } from "./trace-model.js";

/** Tramos solapados de cada etapa del revelado, como fracción del revelado. */
const TRAMOS = [
  ["structure", 0, 0.22],
  ["header", 0.18, 0.42],
  ["content", 0.36, 0.72],
  ["actions", 0.68, 1],
];

/** Estados de cierre conocidos que no son `processing`. */
const CIERRES_CONOCIDOS = new Set(["prepared", "retaining", "closing", "complete"]);

/** Prioridad del código cuando una recarga produce varios avisos. */
const PRIORIDAD_AVISO = ["selection_removed", "prefix_replaced", "live_ended", "events_arrived", "event_changed"];

/** Fracción de cada etapa: `clamp((p - inicio) / (fin - inicio), 0, 1)`. */
export function revealStages(progress) {
  const p = Number.isFinite(progress) ? progress : 0;
  const etapas = {};
  for (const [nombre, inicio, fin] of TRAMOS) {
    etapas[nombre] = Math.min(1, Math.max(0, (p - inicio) / (fin - inicio)));
  }
  return etapas;
}

/**
 * Disponibilidad de En Vivo, exclusivamente por el estado del cierre.
 *
 * Un cierre aún sin confirmar por una lectura coherente (`verifying`) nunca
 * habilita: `verifying`. Un cierre parcial (`partial`) tampoco: `updating`. Un
 * estado ausente, vacío o desconocido no equivale a `processing`: `unknown`.
 */
export function liveAvailability(ctx) {
  if (ctx?.verifying) return { enabled: false, reason: "verifying" };
  if (ctx?.partial) return { enabled: false, reason: "updating" };
  const estado = ctx?.closureState;
  if (estado === "processing") return { enabled: true, reason: "processing" };
  if (typeof estado === "string" && CIERRES_CONOCIDOS.has(estado)) return { enabled: false, reason: "not_processing" };
  return { enabled: false, reason: "unknown" };
}

/**
 * `verifying` (cierre leído sin la comprobación vista/traza/vista) se trata
 * como un cierre parcial: no habilita ni expulsa de En Vivo y no rige la carga.
 */
function contextoDe(ctx) {
  const verifying = Boolean(ctx?.verifying);
  return {
    closureState: ctx?.closureState,
    partial: Boolean(ctx?.partial) || verifying,
    verifying,
    connected: ctx?.connected !== false,
  };
}

function plural(n, uno, varios) {
  return n === 1 ? uno : varios;
}

/**
 * Crea el presentador. `opts.clock` se pasa a `createPlayback` (reloj
 * inyectable en pruebas); `opts.reducedMotion` desactiva el revelado.
 */
export function createPresenter(opts = {}) {
  const reloj = opts.clock;
  let movimientoReducido = Boolean(opts.reducedMotion);
  let velocidad = 1;
  let modelo = buildTraceModel(null);
  let contexto = contextoDe(null);
  // Último estado de cierre leído de forma coherente (sin `partial`): rige el
  // último activo, la carga y la salida de En Vivo. Un cierre parcial nunca
  // habilita En Vivo, pero tampoco expulsa de él a quien ya lo sigue.
  let cierre = null;
  let modo = "replay";
  let pausado = true;
  let siguiendo = false;
  let presentados = 0;
  let revelando = null;
  let pendientes = [];
  let conectado = true;
  // Tras reconectar se espera una recarga antes de restablecer la carga activa.
  let esperaRecarga = false;
  // Una lectura falló (error, traza no leída o archivo en actualización): la
  // fuente no pudo actualizarse y la carga es estática hasta una lectura fresca.
  let obsoleto = false;
  let aviso = null;
  let contadorAvisos = 0;
  let playback = null;
  let interno = 0;
  let destruido = false;
  let instantanea = null;
  const listeners = new Set();

  const indiceDe = (id) => (typeof id === "string" && modelo.index.has(id) ? modelo.index.get(id) : -1);
  const seleccionado = () => playback.state().selectedEventId;

  function estadoActual() {
    const pb = playback.state();
    const procesando = cierre === "processing";
    let reveal = null;
    if (revelando !== null && !movimientoReducido && pb.selectedEventId === revelando) {
      const progress = Math.min(1, pb.stepElapsedMs / (REVELADO_BASE_MS / pb.speed));
      reveal = { eventId: revelando, progress, stages: revealStages(progress) };
    }
    const posicion = indiceDe(pb.selectedEventId);
    let loader = "off";
    let loaderReason = null;
    if (procesando) {
      loaderReason = !conectado ? "offline" : obsoleto ? "stale" : esperaRecarga ? "reconnecting" : null;
      loader = loaderReason ? "static" : "active";
    }
    return {
      mode: modo,
      paused: pausado,
      following: siguiendo,
      selectedId: pb.selectedEventId,
      speed: pb.speed,
      presentedCount: presentados,
      reveal,
      pendingIds: [...pendientes],
      live: liveAvailability(contexto),
      lastActiveId: procesando ? modelo.lastId : null,
      loader,
      loaderReason,
      waitingFirst: procesando && modelo.events.length === 0,
      notice: aviso ? { ...aviso } : null,
      canPlay: modo === "replay" && posicion >= 0 && posicion < modelo.events.length - 1,
    };
  }

  function emitir() {
    if (destruido) return;
    const actual = estadoActual();
    for (const listener of [...listeners]) listener(actual);
  }

  /** Ejecuta una operación y notifica una sola vez al terminar. */
  function operar(fn) {
    if (destruido) return;
    interno += 1;
    try {
      fn();
    } finally {
      interno -= 1;
    }
    emitir();
  }

  function descartarPresentados() {
    pendientes = pendientes.filter((id) => indiceDe(id) >= presentados);
  }

  /** Avance del reloj de reproducción (no de una operación del presentador). */
  function alAvanzar(pb) {
    if (interno > 0 || destruido) return;
    if (modo === "replay") {
      if (pb.mode !== "playing") pausado = true;
      const posicion = indiceDe(pb.selectedEventId);
      if (posicion >= presentados) {
        // Se presenta una tarjeta nueva del recorrido: es la única que se revela.
        presentados = posicion + 1;
        revelando = movimientoReducido ? null : pb.selectedEventId;
        descartarPresentados();
      } else if (pb.selectedEventId !== revelando) {
        revelando = null;
      }
    }
    emitir();
  }

  function crearPlayback() {
    playback?.destroy();
    playback = createPlayback(modelo.events, { clock: reloj, speed: velocidad });
    playback.subscribe(alAvanzar);
  }

  function anunciar(partes) {
    if (partes.length === 0) return;
    const ordenadas = [...partes].sort((a, b) => PRIORIDAD_AVISO.indexOf(a.code) - PRIORIDAD_AVISO.indexOf(b.code));
    contadorAvisos += 1;
    aviso = { id: contadorAvisos, code: ordenadas[0].code, text: ordenadas.map((parte) => parte.text).join(" ") };
  }

  /** Pausa de lectura: congela reloj y revelado; en En Vivo deja de seguir. */
  function pausar() {
    playback.pause();
    pausado = true;
    siguiendo = false;
  }

  /**
   * Selección explícita: deja el recorrido en pausa, no revela y extiende el
   * prefijo presentado hasta el elegido (los anteriores quedan completos).
   */
  function seleccionar(id) {
    playback.seek(id);
    revelando = null;
    pausado = true;
    siguiendo = false;
    const posicion = indiceDe(id);
    if (posicion + 1 > presentados) presentados = posicion + 1;
    descartarPresentados();
  }

  /**
   * Retoma el seguimiento: reconoce la cola y selecciona el último. Si la
   * selección salta al último o había pendientes, se revela solo el último; si
   * ya estaba en él con un revelado congelado, continúa desde ese punto.
   */
  function reanudarVivo() {
    const previo = seleccionado();
    const habiaPendientes = pendientes.length > 0;
    pendientes = [];
    presentados = modelo.events.length;
    siguiendo = true;
    pausado = false;
    const ultimo = modelo.lastId;
    if (ultimo === null) return;
    if (previo === ultimo && revelando === ultimo && !movimientoReducido) {
      playback.present();
      return;
    }
    if (previo !== ultimo) playback.last();
    if ((previo !== ultimo || habiaPendientes) && !movimientoReducido) {
      revelando = ultimo;
      playback.present();
    } else {
      revelando = null;
    }
  }

  function entrarVivo() {
    modo = "live";
    siguiendo = true;
    pausado = false;
    pendientes = [];
    presentados = modelo.events.length;
    revelando = null;
    playback.last();
  }

  crearPlayback();

  return {
    state() {
      return destruido ? structuredClone(instantanea) : estadoActual();
    },

    /**
     * Corrida nueva: reinicia todo. Replay en pausa con el último seleccionado,
     * todo presentado, sin revelado, cola ni aviso. Velocidad y movimiento
     * reducido son ajustes del visor y se conservan; el contador de avisos
     * sigue creciendo para que cada anuncio tenga un ID nuevo.
     */
    load(model, ctx) {
      operar(() => {
        modelo = model ?? buildTraceModel(null);
        contexto = contextoDe(ctx);
        cierre = contexto.partial ? null : contexto.closureState;
        conectado = contexto.connected;
        esperaRecarga = false;
        obsoleto = Boolean(ctx?.stale);
        modo = "replay";
        pausado = true;
        siguiendo = false;
        presentados = modelo.events.length;
        revelando = null;
        pendientes = [];
        aviso = null;
        crearPlayback();
      });
    },

    /**
     * Recarga coherente de la misma corrida. Produce como máximo un aviso por
     * llamada: si coinciden varios cambios, el código es el de mayor prioridad
     * y el texto los enumera todos.
     */
    update(model, ctx, diff) {
      if (destruido || !model) return;
      operar(() => {
        const previo = modelo;
        const cambios = diff ?? reconcileTrace(previo, model);
        const seleccionPrevia = seleccionado();
        const partes = [];
        modelo = model;
        contexto = contextoDe(ctx);
        if (typeof ctx?.connected === "boolean") conectado = ctx.connected;
        // Solo una lectura coherente completa (no parcial y con traza fresca)
        // restablece la carga; `stale` declara que la traza no se pudo leer.
        if (ctx?.stale === true) {
          obsoleto = true;
        } else if (!contexto.partial) {
          obsoleto = false;
          esperaRecarga = false;
        }

        playback.ingest(modelo.events);
        pendientes = pendientes.filter((id) => modelo.byId.has(id));
        presentados = Math.min(presentados, modelo.events.length);
        // El seleccionado siempre está presentado: con una traza que estaba
        // vacía, la reproducción selecciona por regla inicial el último recibido.
        const posicionSeleccion = indiceDe(seleccionado());
        if (posicionSeleccion + 1 > presentados) presentados = posicionSeleccion + 1;
        if (revelando !== null && !modelo.byId.has(revelando)) revelando = null;

        // Prefijo reemplazado: el modelo se sustituye, se pausa y se advierte.
        const seleccionPerdida = seleccionPrevia !== null && !modelo.byId.has(seleccionPrevia);
        if (cambios.prefixReplaced || seleccionPerdida) {
          pausar();
          if (seleccionPerdida) {
            if (modelo.lastId !== null) seleccionar(modelo.lastId);
            partes.push({
              code: "selection_removed",
              text: modelo.lastId !== null
                ? `La traza se reemplazó por el prefijo aceptado y el hito ${seleccionPrevia} ya no existe; se seleccionó ${modelo.lastId}.`
                : `La traza se reemplazó por el prefijo aceptado y el hito ${seleccionPrevia} ya no existe; no quedan hitos.`,
            });
          } else {
            partes.push({ code: "prefix_replaced", text: "La traza se reemplazó por el prefijo aceptado; la presentación quedó en pausa." });
          }
        }

        // IDs nuevos: únicos, ausentes del modelo anterior y presentes en el nuevo.
        const nuevos = [];
        for (const id of Array.isArray(cambios.newIds) ? cambios.newIds : []) {
          if (previo.byId.has(id) || !modelo.byId.has(id) || pendientes.includes(id) || nuevos.includes(id)) continue;
          nuevos.push(id);
        }
        nuevos.sort((a, b) => indiceDe(a) - indiceDe(b));
        if (nuevos.length > 0) {
          if (modo === "live" && siguiendo && !pausado) {
            // En seguimiento solo se anima el más reciente; los demás, completos.
            const ultimo = modelo.lastId;
            playback.seek(ultimo);
            presentados = modelo.events.length;
            pendientes = [];
            if (movimientoReducido) {
              revelando = null;
            } else {
              revelando = ultimo;
              playback.present();
            }
            partes.push({
              code: "events_arrived",
              text: nuevos.length === 1
                ? `Nuevo hito ${nuevos[0]}.`
                : `${nuevos.length} hitos nuevos; el último es ${nuevos.at(-1)}.`,
            });
          } else {
            pendientes = [...pendientes, ...nuevos].sort((a, b) => indiceDe(a) - indiceDe(b));
            descartarPresentados();
            const total = pendientes.length;
            if (total > 0) {
              partes.push({
                code: "events_arrived",
                text: plural(total, "1 hito nuevo sin presentar.", `${total} hitos nuevos sin presentar.`),
              });
            } else {
              // Los nuevos quedaron presentados con la selección (primeros hitos).
              partes.push({
                code: "events_arrived",
                text: nuevos.length === 1
                  ? `Nuevo hito ${nuevos[0]}.`
                  : `${nuevos.length} hitos nuevos; el último es ${nuevos.at(-1)}.`,
              });
            }
          }
        }

        const cambiados = (Array.isArray(cambios.changedIds) ? cambios.changedIds : []).filter((id) => modelo.byId.has(id));
        if (cambiados.length > 0) {
          partes.push({
            code: "event_changed",
            text: cambiados.length === 1
              ? `El hito ${cambiados[0]} cambió en la fuente.`
              : `${cambiados.length} hitos cambiaron en la fuente.`,
          });
        }

        // Un cierre coherente que deja `processing` desactiva En Vivo de
        // inmediato: completa el revelado y vuelve a replay en pausa, sin
        // reproducción automática; cola y selección se conservan.
        if (!contexto.partial) {
          const anterior = cierre;
          cierre = contexto.closureState;
          if (anterior === "processing" && cierre !== "processing") {
            const estabaEnVivo = modo === "live";
            if (estabaEnVivo) {
              revelando = null;
              pausar();
              modo = "replay";
            }
            partes.push({
              code: "live_ended",
              text: estabaEnVivo
                ? "La revisión dejó de estar en procesamiento; En Vivo se desactivó y la presentación quedó en pausa."
                : "La revisión dejó de estar en procesamiento.",
            });
          }
        }

        anunciar(partes);
      });
    },

    setConnection(connected) {
      operar(() => {
        if (!connected) {
          conectado = false;
        } else if (!conectado) {
          conectado = true;
          esperaRecarga = true;
        }
      });
    },

    /** La fuente no pudo leerse: carga estática hasta la próxima lectura fresca. */
    setStale(flag = true) {
      operar(() => {
        obsoleto = Boolean(flag);
      });
    },

    setReducedMotion(flag) {
      operar(() => {
        movimientoReducido = Boolean(flag);
        if (movimientoReducido) revelando = null;
      });
    },

    /** `source` se acepta para la UI; toda selección explícita es de lectura. */
    select(id, source) {
      void source;
      if (destruido || indiceDe(id) < 0) return;
      operar(() => seleccionar(id));
    },

    /** Replay desde el primero, en pausa, con solo esa tarjeta presentada. */
    restart() {
      if (destruido || modelo.events.length === 0) return;
      operar(() => {
        const primero = modelo.events[0].event_id;
        modo = "replay";
        siguiendo = false;
        pausado = true;
        playback.seek(primero);
        presentados = 1;
        descartarPresentados();
        revelando = movimientoReducido ? null : primero;
      });
    },

    /**
     * Replay: pausa si reproduce; si no, reproduce cuando hay un siguiente
     * (`canPlay`); en el último es no-op. En Vivo: pausa o reanuda En Vivo.
     */
    togglePlay() {
      operar(() => {
        if (modo === "live") {
          if (pausado) reanudarVivo();
          else pausar();
          return;
        }
        if (playback.state().mode === "playing") {
          pausar();
          return;
        }
        if (!estadoActual().canPlay) return;
        playback.play();
        // Se deriva de la reproducción: nunca se declara «reproduciendo» sin temporizador.
        pausado = playback.state().mode !== "playing";
      });
    },

    step(delta) {
      if (destruido || modelo.events.length === 0) return;
      const actual = Math.max(0, indiceDe(seleccionado()));
      const destino = Math.min(Math.max(actual + (delta < 0 ? -1 : 1), 0), modelo.events.length - 1);
      operar(() => seleccionar(modelo.events[destino].event_id));
    },

    last() {
      if (destruido || modelo.lastId === null) return;
      operar(() => seleccionar(modelo.lastId));
    },

    setSpeed(valor) {
      if (destruido) return;
      operar(() => {
        playback.setSpeed(valor);
        velocidad = valor;
      });
    },

    /** «Mostrar tarjeta completa»: termina el efecto sin pausar ni avanzar. */
    showComplete() {
      operar(() => {
        revelando = null;
      });
    },

    /** Solo aplica en En Vivo; desactivar el seguimiento es una pausa de lectura. */
    setFollowing(flag) {
      operar(() => {
        if (modo !== "live") return;
        if (flag) reanudarVivo();
        else pausar();
      });
    },

    enterLive() {
      if (destruido || !liveAvailability(contexto).enabled) return false;
      operar(entrarVivo);
      return true;
    },

    resumeLive() {
      if (destruido) return;
      if (modo !== "live") {
        if (liveAvailability(contexto).enabled) operar(entrarVivo);
        return;
      }
      operar(reanudarVivo);
    },

    /** «Mostrar nuevos»: incorpora lo pendiente sin seleccionar, desplazar ni reanudar. */
    showPending() {
      operar(() => {
        pendientes = [];
        presentados = modelo.events.length;
      });
    },

    /** Toda pausa es igual; volver de una pestaña, diálogo u ocultación no reanuda. */
    pause(reason = "user") {
      void reason;
      operar(pausar);
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    destroy() {
      if (destruido) return;
      instantanea = estadoActual();
      destruido = true;
      playback.destroy();
      listeners.clear();
    },
  };
}
