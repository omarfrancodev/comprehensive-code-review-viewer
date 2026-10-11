import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPresenter, liveAvailability, revealStages } from "../../src/ccr_viewer/web/presenter.js";
import { buildTraceModel, reconcileTrace } from "../../src/ccr_viewer/web/trace-model.js";
import { createFakeClock } from "./fake-clock.mjs";
import { trazaSintetica } from "./generators.mjs";

const CERRADA = { closureState: "complete", partial: false, connected: true };
const VIVA = { closureState: "processing", partial: false, connected: true };

const modelo = (n) => buildTraceModel(trazaSintetica(n));

function crear(n = 5, ctx = CERRADA, opciones = {}) {
  const clock = createFakeClock();
  const p = createPresenter({ clock, ...opciones });
  const m = modelo(n);
  p.load(m, ctx);
  return { p, clock, m };
}

/** Aplica una recarga coherente con el diff real de `reconcileTrace`. */
function actualizar(p, previo, siguiente, ctx = VIVA) {
  p.update(siguiente, ctx, reconcileTrace(previo, siguiente));
  return siguiente;
}

const cerca = (real, esperado, mensaje) => assert.ok(Math.abs(real - esperado) < 1e-4, `${mensaje ?? ""} ${real} ≈ ${esperado}`);

describe("presentador: reproducción y revelado", () => {
  it("P-1 inicia en replay, en pausa, con el último seleccionado y sin autoplay", () => {
    const { p, clock } = crear();
    const s = p.state();
    assert.equal(s.mode, "replay");
    assert.equal(s.paused, true);
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.presentedCount, 5);
    assert.equal(s.reveal, null);
    assert.equal(s.canPlay, false);
    clock.advance(10000);
    assert.equal(p.state().selectedId, "E000005");
    assert.equal(p.state().paused, true);
  });

  it("P-2 restart() selecciona el primero con solo esa tarjeta presentada", () => {
    const { p } = crear();
    p.restart();
    const s = p.state();
    assert.equal(s.selectedId, "E000001");
    assert.equal(s.presentedCount, 1);
    assert.equal(s.reveal.eventId, "E000001");
    assert.equal(s.reveal.progress, 0);
    assert.equal(s.paused, true);
    assert.equal(s.canPlay, true);
  });

  it("P-3 tras restart()+togglePlay() y 2350 ms presenta el segundo", () => {
    const { p, clock } = crear();
    p.restart();
    p.togglePlay();
    assert.equal(p.state().paused, false);
    clock.advance(2349);
    assert.equal(p.state().selectedId, "E000001");
    clock.advance(1);
    const s = p.state();
    assert.equal(s.selectedId, "E000002");
    assert.equal(s.presentedCount, 2);
    assert.equal(s.reveal.eventId, "E000002");
    assert.equal(s.reveal.progress, 0);
  });

  it("P-4 a 2× el revelado termina a 900 ms y el siguiente llega a 1175 ms", () => {
    const { p, clock } = crear();
    p.restart();
    p.setSpeed(2);
    p.togglePlay();
    clock.advance(900);
    assert.equal(p.state().reveal.progress, 1);
    assert.equal(p.state().selectedId, "E000001");
    clock.advance(274);
    assert.equal(p.state().selectedId, "E000001");
    clock.advance(1);
    assert.equal(p.state().selectedId, "E000002");
  });

  it("P-5 revealStages reparte las etapas solapadas", () => {
    const a = revealStages(0.10);
    cerca(a.structure, 0.4545);
    assert.equal(a.header, 0);
    assert.equal(a.content, 0);
    assert.equal(a.actions, 0);
    const b = revealStages(0.30);
    cerca(b.header, 0.5);
    assert.equal(b.structure, 1);
    assert.deepEqual(revealStages(1), { structure: 1, header: 1, content: 1, actions: 1 });
    assert.deepEqual(revealStages(0), { structure: 0, header: 0, content: 0, actions: 0 });
    assert.deepEqual(revealStages(2), { structure: 1, header: 1, content: 1, actions: 1 });
  });

  it("P-6 la pausa congela el revelado y reanudar continúa desde el punto conservado", () => {
    const { p, clock } = crear();
    p.restart();
    p.togglePlay();
    clock.advance(900);
    assert.equal(p.state().reveal.progress, 0.5);
    p.pause();
    assert.equal(p.state().paused, true);
    clock.advance(5000);
    assert.equal(p.state().reveal.progress, 0.5);
    assert.equal(p.state().selectedId, "E000001");
    p.togglePlay();
    clock.advance(900);
    assert.equal(p.state().reveal.progress, 1);
    // A 1× quedan 2350 − 1800 = 550 ms del paso (separación) antes de avanzar.
    clock.advance(549);
    assert.equal(p.state().selectedId, "E000001");
    clock.advance(1);
    assert.equal(p.state().selectedId, "E000002");
  });

  it("P-7 showComplete() termina el efecto sin pausar ni avanzar", () => {
    const { p, clock } = crear();
    p.restart();
    p.togglePlay();
    clock.advance(900);
    p.showComplete();
    const s = p.state();
    assert.equal(s.reveal, null);
    assert.equal(s.paused, false);
    assert.equal(s.selectedId, "E000001");
  });

  it("P-8 con movimiento reducido no hay revelado y la espera es 2350/velocidad", () => {
    const { p, clock } = crear();
    p.setReducedMotion(true);
    p.restart();
    assert.equal(p.state().reveal, null);
    p.setSpeed(4);
    p.togglePlay();
    clock.advance(587);
    assert.equal(p.state().selectedId, "E000001");
    assert.equal(p.state().reveal, null);
    clock.advance(0.5);
    assert.equal(p.state().selectedId, "E000002");
    assert.equal(p.state().reveal, null);
  });

  it("P-9 seleccionar en pausa no revela y extiende el prefijo presentado", () => {
    const { p } = crear();
    p.select("E000004");
    assert.equal(p.state().reveal, null);
    assert.equal(p.state().selectedId, "E000004");
    assert.equal(p.state().presentedCount, 5);

    p.restart();
    assert.equal(p.state().presentedCount, 1);
    p.select("E000004");
    assert.equal(p.state().presentedCount, 4);
    assert.equal(p.state().reveal, null);
    assert.equal(p.state().paused, true);
  });

  it("P-10 cambiar de pestaña, corrida, ocultar o abrir un diálogo pausa y volver no reanuda", () => {
    for (const motivo of ["tab", "run", "hidden", "dialog", "user"]) {
      const { p, clock } = crear();
      p.restart();
      p.togglePlay();
      clock.advance(500);
      p.pause(motivo);
      assert.equal(p.state().paused, true, motivo);
      clock.advance(10000);
      assert.equal(p.state().paused, true, motivo);
      assert.equal(p.state().selectedId, "E000001", motivo);
    }
  });

  it("togglePlay() en el último evento es no-op", () => {
    const { p, clock } = crear();
    p.togglePlay();
    assert.equal(p.state().paused, true);
    assert.equal(clock.pending(), 0);
  });

  it("al terminar el recorrido queda en pausa en el último con todo presentado", () => {
    const { p, clock } = crear(3);
    p.restart();
    p.togglePlay();
    clock.advance(2350 * 3);
    const s = p.state();
    assert.equal(s.selectedId, "E000003");
    assert.equal(s.presentedCount, 3);
    assert.equal(s.paused, true);
    assert.equal(s.canPlay, false);
    assert.equal(s.reveal.progress, 1);
  });
});

describe("presentador: disponibilidad de En Vivo", () => {
  it("L-1 solo processing habilita En Vivo", () => {
    assert.deepEqual(liveAvailability({ closureState: "processing", partial: false }), { enabled: true, reason: "processing" });
    for (const estado of ["prepared", "retaining", "closing", "complete"]) {
      assert.deepEqual(liveAvailability({ closureState: estado, partial: false }), { enabled: false, reason: "not_processing" }, estado);
    }
    for (const estado of ["", null, undefined, "future_state", 7]) {
      assert.deepEqual(liveAvailability({ closureState: estado, partial: false }), { enabled: false, reason: "unknown" }, String(estado));
    }
    assert.deepEqual(liveAvailability(undefined), { enabled: false, reason: "unknown" });
  });

  it("L-2 un cierre parcial nunca habilita En Vivo", () => {
    assert.deepEqual(liveAvailability({ closureState: "processing", partial: true }), { enabled: false, reason: "updating" });
  });

  it("L-3 enterLive() sin disponibilidad devuelve false y no cambia el modo", () => {
    for (const ctx of [CERRADA, { closureState: null, partial: false, connected: true }, { ...VIVA, partial: true }]) {
      const { p } = crear(5, ctx);
      assert.equal(p.enterLive(), false);
      assert.equal(p.state().mode, "replay");
      assert.equal(p.state().live.enabled, false);
    }
  });

  it("L-4 enterLive() disponible selecciona el último y sigue", () => {
    const { p } = crear(5, VIVA);
    p.restart();
    assert.equal(p.enterLive(), true);
    const s = p.state();
    assert.equal(s.mode, "live");
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.following, true);
    assert.equal(s.paused, false);
    assert.equal(s.presentedCount, 5);
    assert.deepEqual(s.live, { enabled: true, reason: "processing" });
  });

  it("L-5 el último activo es independiente de la selección", () => {
    const { p } = crear(5, VIVA);
    p.select("E000002");
    assert.equal(p.state().lastActiveId, "E000005");
    assert.equal(p.state().loader, "active");
    assert.equal(p.state().waitingFirst, false);

    const cerrada = crear(5, CERRADA).p;
    assert.equal(cerrada.state().lastActiveId, null);
    assert.equal(cerrada.state().loader, "off");
  });

  it("L-6 processing sin eventos espera el primer registro", () => {
    const { p } = crear(0, VIVA);
    const s = p.state();
    assert.equal(s.lastActiveId, null);
    assert.equal(s.waitingFirst, true);
    assert.equal(s.loader, "active");
    assert.equal(s.selectedId, null);
    assert.equal(p.enterLive(), true);
    assert.equal(p.state().waitingFirst, true);
  });
});

describe("presentador: recepción en vivo", () => {
  it("L-7 un evento nuevo en seguimiento se selecciona y se revela", () => {
    const { p, m, clock } = crear(5, VIVA);
    p.enterLive();
    actualizar(p, m, modelo(6));
    const s = p.state();
    assert.equal(s.selectedId, "E000006");
    assert.equal(s.reveal.eventId, "E000006");
    assert.equal(s.reveal.progress, 0);
    assert.equal(s.lastActiveId, "E000006");
    assert.equal(s.presentedCount, 6);
    assert.deepEqual(s.pendingIds, []);
    clock.advance(900);
    assert.equal(p.state().reveal.progress, 0.5);
    clock.advance(5000);
    assert.equal(p.state().reveal.progress, 1);
    assert.equal(p.state().selectedId, "E000006");
    assert.equal(p.state().paused, false, "seguir en vivo no es una pausa");
  });

  it("L-8 en una ráfaga solo se revela el más reciente", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    actualizar(p, m, modelo(8));
    const s = p.state();
    assert.equal(s.reveal.eventId, "E000008");
    assert.equal(s.selectedId, "E000008");
    assert.equal(s.presentedCount, 8);
  });

  it("L-9 una llegada durante un revelado lo completa y empieza el nuevo sin acumular espera", () => {
    const { p, m, clock } = crear(5, VIVA);
    p.enterLive();
    const m6 = actualizar(p, m, modelo(6));
    clock.advance(900);
    assert.equal(p.state().reveal.progress, 0.5);
    actualizar(p, m6, modelo(7));
    assert.equal(p.state().reveal.eventId, "E000007");
    assert.equal(p.state().reveal.progress, 0);
    clock.advance(1800);
    assert.equal(p.state().reveal.eventId, "E000007");
    assert.equal(p.state().reveal.progress, 1);
  });

  it("L-10 en pausa los IDs nuevos se acumulan sin duplicados", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.pause();
    const m7 = actualizar(p, m, modelo(7));
    let s = p.state();
    assert.deepEqual(s.pendingIds, ["E000006", "E000007"]);
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.presentedCount, 5);
    assert.equal(s.paused, true);
    assert.equal(s.mode, "live");
    p.update(m7, VIVA, { newIds: ["E000006"], changedIds: [], prefixReplaced: false });
    s = p.state();
    assert.deepEqual(s.pendingIds, ["E000006", "E000007"]);
    assert.equal(s.lastActiveId, "E000007", "el último activo sigue al último recibido");
  });

  it("L-11 Mostrar nuevos incorpora sin reanudar; Reanudar En Vivo reconoce la cola y revela solo el último", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.pause();
    actualizar(p, m, modelo(7));
    p.showPending();
    let s = p.state();
    assert.equal(s.presentedCount, 7);
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.paused, true);
    assert.equal(s.reveal, null);
    p.resumeLive();
    s = p.state();
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.selectedId, "E000007");
    assert.equal(s.following, true);
    assert.equal(s.paused, false);
    assert.equal(s.reveal.eventId, "E000007");

    const otra = crear(5, VIVA);
    otra.p.enterLive();
    otra.p.pause();
    actualizar(otra.p, otra.m, modelo(7));
    otra.p.resumeLive();
    s = otra.p.state();
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.selectedId, "E000007");
    assert.equal(s.presentedCount, 7);
    assert.equal(s.reveal.eventId, "E000007");
  });

  it("L-12 un evento modificado con el mismo ID no es nuevo y se avisa", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.pause();
    const traza = trazaSintetica(5);
    traza.events[2] = { ...traza.events[2], sha256: "f".repeat(64), summary: "Resumen corregido" };
    actualizar(p, m, buildTraceModel(traza));
    const s = p.state();
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.notice.code, "event_changed");
    assert.match(s.notice.text, /E000003/);
  });

  it("L-13 un prefijo reemplazado pausa y avisa; si la selección desaparece selecciona el último", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.select("E000002");
    actualizar(p, m, modelo(3));
    let s = p.state();
    assert.equal(s.paused, true);
    assert.equal(s.notice.code, "prefix_replaced");
    assert.equal(s.selectedId, "E000002");

    const otra = crear(5, VIVA);
    otra.p.enterLive();
    actualizar(otra.p, otra.m, modelo(3));
    s = otra.p.state();
    assert.equal(s.paused, true);
    assert.equal(s.selectedId, "E000003");
    assert.equal(s.notice.code, "selection_removed");
    assert.equal(s.presentedCount, 3);
  });

  it("L-14 el cierre fuera de processing desactiva En Vivo y conserva cola, selección y pausa", () => {
    const { p, m, clock } = crear(5, VIVA);
    p.enterLive();
    const m6 = actualizar(p, m, modelo(6));
    clock.advance(600);
    p.pause();
    const m8 = actualizar(p, m6, modelo(8));
    assert.deepEqual(p.state().pendingIds, ["E000007", "E000008"]);
    assert.ok(p.state().reveal, "el revelado sigue congelado en la pausa");
    actualizar(p, m8, m8, CERRADA);
    const s = p.state();
    assert.deepEqual(s.live, { enabled: false, reason: "not_processing" });
    assert.equal(s.mode, "replay");
    assert.equal(s.loader, "off");
    assert.equal(s.reveal, null);
    assert.deepEqual(s.pendingIds, ["E000007", "E000008"]);
    assert.equal(s.selectedId, "E000006");
    assert.equal(s.paused, true);
    assert.equal(s.lastActiveId, null);
    clock.advance(10000);
    assert.equal(p.state().selectedId, "E000006", "el cierre no inicia una reproducción automática");
    assert.equal(p.state().paused, true);
  });

  it("L-14b si seguía en vivo al cerrar, incorpora lo recibido y vuelve a replay en pausa", () => {
    const { p, m, clock } = crear(5, VIVA);
    p.enterLive();
    actualizar(p, m, modelo(6), CERRADA);
    const s = p.state();
    assert.equal(s.mode, "replay");
    assert.equal(s.paused, true);
    assert.equal(s.following, false);
    assert.equal(s.selectedId, "E000006");
    assert.equal(s.presentedCount, 6);
    assert.equal(s.reveal, null);
    clock.advance(10000);
    assert.equal(p.state().selectedId, "E000006");
  });

  it("L-15 la desconexión deja una carga estática hasta recargar tras reconectar", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.setConnection(false);
    assert.equal(p.state().loader, "static");
    assert.equal(p.state().mode, "live", "En Vivo puede seguir seleccionado esperando reconexión");
    p.setConnection(true);
    assert.equal(p.state().loader, "static");
    p.update(m, VIVA, reconcileTrace(m, m));
    assert.equal(p.state().loader, "active");
  });

  it("L-16 una recarga con IDs ya conocidos no cuenta nuevos", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.pause();
    p.update(modelo(5), VIVA, { newIds: ["E000004", "E000005"], changedIds: [], prefixReplaced: false });
    assert.deepEqual(p.state().pendingIds, []);
    assert.equal(p.state().notice, null);
    actualizar(p, m, modelo(5));
    assert.deepEqual(p.state().pendingIds, []);
    assert.equal(p.state().notice, null);
  });

  it("L-17 destroy() cancela todo y el reloj ya no cambia el estado", () => {
    const { p, clock } = crear();
    p.restart();
    p.togglePlay();
    clock.advance(300);
    let avisos = 0;
    p.subscribe(() => { avisos += 1; });
    const antes = p.state();
    p.destroy();
    clock.advance(10000);
    assert.deepEqual(p.state(), antes);
    assert.equal(avisos, 0);
    assert.equal(clock.pending(), 0);
  });

  it("L-18 una ráfaga produce un aviso, el cierre otro, y el ID crece de uno en uno", () => {
    const { p, m } = crear(5, VIVA);
    const avisos = [];
    p.subscribe((s) => {
      if (s.notice && avisos.at(-1)?.id !== s.notice.id) avisos.push(s.notice);
    });
    p.enterLive();
    const m8 = actualizar(p, m, modelo(8));
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].code, "events_arrived");
    assert.match(avisos[0].text, /E000008/);
    actualizar(p, m8, m8, CERRADA);
    assert.equal(avisos.length, 2);
    assert.equal(avisos[1].code, "live_ended");
    assert.equal(avisos[1].id, avisos[0].id + 1);
    assert.equal(typeof avisos[1].text, "string");
  });

  it("L-19 en replay el modelo recibe los eventos y los nuevos quedan pendientes", () => {
    const { p, m } = crear(5, VIVA);
    actualizar(p, m, modelo(7));
    let s = p.state();
    assert.equal(s.mode, "replay");
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.presentedCount, 5);
    assert.deepEqual(s.pendingIds, ["E000006", "E000007"]);
    assert.equal(s.lastActiveId, "E000007");
    p.showPending();
    s = p.state();
    assert.equal(s.presentedCount, 7);
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.selectedId, "E000005");
    assert.equal(s.paused, true);
    p.select("E000007");
    assert.equal(p.state().selectedId, "E000007");
  });

  it("load() de una corrida nueva reinicia selección, modo, pausa y cola", () => {
    const { p, m } = crear(5, VIVA);
    p.enterLive();
    p.pause();
    actualizar(p, m, modelo(7));
    p.load(modelo(3), CERRADA);
    const s = p.state();
    assert.equal(s.mode, "replay");
    assert.equal(s.paused, true);
    assert.equal(s.following, false);
    assert.equal(s.selectedId, "E000003");
    assert.equal(s.presentedCount, 3);
    assert.deepEqual(s.pendingIds, []);
    assert.equal(s.reveal, null);
    assert.equal(s.notice, null);
  });
});
