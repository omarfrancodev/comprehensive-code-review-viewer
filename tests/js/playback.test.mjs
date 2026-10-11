import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as playback from "../../src/ccr_viewer/web/playback.js";
import { createPlayback, PASO_BASE_MS, REVELADO_BASE_MS, VELOCIDADES } from "../../src/ccr_viewer/web/playback.js";
import { createFakeClock } from "./fake-clock.mjs";

const evento = (id, sequence, occurred_at, recorded_at) => ({
  event_id: id,
  sequence,
  occurred_at,
  recorded_at,
  temporal_basis: occurred_at ? "observed_occurrence" : "recording_fallback",
  temporal_at: occurred_at ?? recorded_at,
});

const TRAZA = {
  events: [
    evento("E000001", 1, null, "2026-09-01T12:00:00+00:00"),
    evento("E000002", 2, "2026-09-01T11:00:00+00:00", "2026-09-01T12:00:09+00:00"),
  ],
  valid_prefix_length: 2,
  chain_status: "verified",
  temporal_order: ["E000002", "E000001"],
  relations: [],
  diagnostics: [],
};

const TRES = [
  ...TRAZA.events,
  evento("E000003", 3, null, "2026-09-01T12:00:20+00:00"),
];

describe("createPlayback", () => {
  it("expone las duraciones de diseño y elimina el intervalo de 800 ms", () => {
    assert.equal(PASO_BASE_MS, 2350);
    assert.equal(REVELADO_BASE_MS, 1800);
    assert.equal("INTERVALO_BASE_MS" in playback, false);
  });

  it("inicia en pausa con el último evento seleccionado, sin autoplay", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().selectedEventId, "E000002");
    assert.equal(p.state().newEvents, 0);
    assert.equal(p.state().stepElapsedMs, 0);
    assert.equal(p.state().stepMs, 2350);
    assert.equal(reloj.pending(), 0, "no programa nada al crearse");
    reloj.advance(10000);
    assert.equal(p.state().selectedEventId, "E000002");
  });

  it("tolera una traza vacía o de un solo evento", () => {
    const vacia = createPlayback([], { clock: createFakeClock() });
    // Sin eventos no hay nada seleccionado: se dice null, no un identificador falso.
    assert.equal(vacia.state().selectedEventId, null);
    vacia.step(1);
    vacia.step(-1);
    vacia.play();
    assert.equal(vacia.state().selectedEventId, null);
    assert.equal(vacia.state().mode, "paused");

    const simple = createPlayback([TRAZA.events[0]], { clock: createFakeClock() });
    assert.equal(simple.state().selectedEventId, "E000001");
    simple.step(-1);
    assert.equal(simple.state().selectedEventId, "E000001", "no retrocede antes del inicio");
  });

  it("avanza y retrocede por el orden de grabación", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    p.seek("E000001");
    p.step(1);
    assert.equal(p.state().selectedEventId, "E000002");
    p.step(1);
    assert.equal(p.state().selectedEventId, "E000002", "no avanza más allá del final");
    p.step(-2);
    assert.equal(p.state().selectedEventId, "E000001");
    assert.equal(p.state().mode, "paused");
  });

  it("conserva el orden canónico y el temporal", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    assert.deepEqual(p.order(), ["E000001", "E000002"]);
    assert.deepEqual(p.temporalOrder(), ["E000002", "E000001"]);
  });

  it("a 1× avanza cada 2350 ms y a 2× cada 1175 ms", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    p.seek("E000001");
    p.play();
    assert.equal(p.state().mode, "playing");
    reloj.advance(2349);
    assert.equal(p.state().selectedEventId, "E000001");
    assert.equal(p.state().stepElapsedMs, 2349);
    reloj.advance(1);
    assert.equal(p.state().selectedEventId, "E000002");
    assert.equal(p.state().stepElapsedMs, 0, "cada paso empieza de cero");

    const reloj2 = createFakeClock();
    const q = createPlayback(TRES, { clock: reloj2, speed: 2 });
    assert.equal(q.state().stepMs, 1175);
    q.seek("E000001");
    q.play();
    reloj2.advance(1174);
    assert.equal(q.state().selectedEventId, "E000001");
    reloj2.advance(1);
    assert.equal(q.state().selectedEventId, "E000002");
    reloj2.advance(1175);
    assert.equal(q.state().selectedEventId, "E000003");
  });

  it("pausar a 900 ms y reanudar 5 s después retoma con el tiempo restante", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    p.seek("E000001");
    p.play();
    reloj.advance(900);
    p.pause();
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().stepElapsedMs, 900);
    reloj.advance(5000);
    assert.equal(p.state().stepElapsedMs, 900, "la pausa congela el progreso");
    assert.equal(p.state().selectedEventId, "E000001");
    p.play();
    reloj.advance(1449);
    assert.equal(p.state().selectedEventId, "E000001");
    assert.equal(p.state().stepElapsedMs, 2349);
    reloj.advance(1);
    assert.equal(p.state().selectedEventId, "E000002");
  });

  it("play() en el último evento es no-op", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    let avisos = 0;
    p.subscribe(() => { avisos += 1; });
    p.play();
    assert.equal(p.state().mode, "paused");
    assert.equal(reloj.pending(), 0);
    assert.equal(avisos, 0);
  });

  it("al llegar al último completa su paso y queda en pausa", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    p.seek("E000001");
    p.play();
    reloj.advance(2350);
    assert.equal(p.state().selectedEventId, "E000002");
    assert.equal(p.state().mode, "playing", "el último hito también recibe su paso");
    reloj.advance(2350);
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().stepElapsedMs, 2350);
    assert.equal(reloj.pending(), 0);
  });

  it("present() cronometra el paso del seleccionado sin avanzar", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    p.seek("E000002");
    p.present();
    assert.equal(p.state().mode, "playing");
    reloj.advance(1000);
    assert.equal(p.state().stepElapsedMs, 1000);
    reloj.advance(5000);
    assert.equal(p.state().selectedEventId, "E000002", "no avanza al siguiente");
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().stepElapsedMs, 2350);
  });

  it("cambiar la velocidad conserva la fracción del paso", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    p.seek("E000001");
    p.play();
    reloj.advance(1175);
    p.setSpeed(2);
    assert.equal(p.state().stepMs, 1175);
    assert.equal(p.state().stepElapsedMs, 587.5);
    reloj.advance(587.5);
    assert.equal(p.state().selectedEventId, "E000002");
  });

  it("ingest no mueve un cursor pausado y cuenta cada nuevo una vez", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    p.seek("E000001");
    const conNuevo = {
      events: [...TRAZA.events, evento("E000003", 3, "2026-09-01T10:00:00+00:00", "2026-09-01T12:00:20+00:00")],
      temporal_order: ["E000003", "E000002", "E000001"],
    };
    p.ingest(conNuevo);
    assert.equal(p.state().selectedEventId, "E000001", "el cursor pausado no se mueve solo");
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().newEvents, 1);
    p.ingest(conNuevo);
    assert.equal(p.state().newEvents, 1, "un duplicado no vuelve a contar");
    assert.deepEqual(p.order(), ["E000001", "E000002", "E000003"]);
  });

  it("ingest tampoco mueve el cursor pausado en el último ni notifica sin cambios", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    let avisos = 0;
    p.subscribe(() => { avisos += 1; });
    p.ingest(TRAZA);
    assert.equal(avisos, 0, "una instantánea idéntica no notifica");
    p.ingest({ events: TRES });
    assert.equal(p.state().selectedEventId, "E000002");
    assert.equal(p.state().newEvents, 1);
    assert.equal(avisos, 1);
  });

  it("ingest sustituye la lista por la instantánea recibida", () => {
    const p = createPlayback(TRES, { clock: createFakeClock() });
    p.seek("E000003");
    p.ingest({ events: TRAZA.events });
    assert.deepEqual(p.order(), ["E000001", "E000002"], "no conserva una unión obsoleta");
    assert.equal(p.state().selectedEventId, "E000002", "un cursor fuera de rango se acota al final");
  });

  it("last() selecciona el más reciente por secuencia y descarta nuevos", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    p.seek("E000001");
    p.ingest({ events: [...TRAZA.events, evento("E000003", 3, "2026-09-01T10:00:00+00:00", "2026-09-01T12:00:20+00:00")] });
    p.last();
    assert.equal(p.state().selectedEventId, "E000003");
    assert.equal(p.state().newEvents, 0);
    assert.equal(p.state().mode, "paused");
  });

  it("acepta sólo las velocidades indicadas", () => {
    assert.deepEqual(VELOCIDADES, [0.5, 1, 2, 4]);
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    for (const velocidad of VELOCIDADES) {
      p.setSpeed(velocidad);
      assert.equal(p.state().speed, velocidad);
      assert.equal(p.state().stepMs, PASO_BASE_MS / velocidad);
    }
    assert.throws(() => p.setSpeed(3), /velocidad/i);
  });

  it("destroy cancela los temporizadores", () => {
    const reloj = createFakeClock();
    const p = createPlayback(TRES, { clock: reloj });
    p.seek("E000001");
    p.play();
    assert.equal(reloj.pending(), 1);
    p.destroy();
    assert.equal(reloj.pending(), 0);
    reloj.advance(10000);
    assert.equal(p.state().mode, "paused");
  });

  it("seek a un identificador desconocido no cambia la selección", () => {
    const p = createPlayback(TRAZA.events, { clock: createFakeClock() });
    const antes = p.state().selectedEventId;
    p.seek("E999999");
    assert.equal(p.state().selectedEventId, antes);
  });
});
