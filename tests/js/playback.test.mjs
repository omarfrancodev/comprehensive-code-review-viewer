import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPlayback, INTERVALO_BASE_MS, VELOCIDADES } from "../../src/ccr_viewer/web/playback.js";

function relojFalso() {
  let ahora = 0;
  const pendientes = [];
  return {
    ahora: () => ahora,
    programar: (fn, ms) => {
      pendientes.push({ fn, ms, a: ahora });
      return pendientes.length;
    },
    cancelar: () => {
      pendientes.length = 0;
    },
    avanzar: (ms) => {
      ahora += ms;
      const vencidas = pendientes.filter((p) => ahora - p.a >= p.ms);
      for (const pendiente of vencidas) {
        const indice = pendientes.indexOf(pendiente);
        if (indice >= 0) pendientes.splice(indice, 1);
        pendiente.fn();
      }
    },
    pendientes: () => pendientes.length,
  };
}

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

describe("createPlayback", () => {
  it("empieza en vivo sobre el último evento coherente", () => {
    const reloj = relojFalso();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    assert.equal(p.state().mode, "live");
    assert.equal(p.state().selectedEventId, "E000002");
    assert.equal(p.state().newEvents, 0);
  });

  it("tolera una traza vacía o de un solo evento", () => {
    const vacia = createPlayback([], { clock: relojFalso() });
    // Sin eventos no hay nada seleccionado: se dice null, no un identificado falso.
    assert.equal(vacia.state().selectedEventId, null);
    vacia.step(1);
    vacia.step(-1);
    vacia.play();
    assert.equal(vacia.state().selectedEventId, null);

    const simple = createPlayback([TRAZA.events[0]], { clock: relojFalso() });
    assert.equal(simple.state().selectedEventId, "E000001");
    simple.step(-1);
    assert.equal(simple.state().selectedEventId, "E000001", "no retrocede antes del inicio");
  });

  it("pausa sin perder el evento seleccionado", () => {
    const reloj = relojFalso();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    p.pause();
    p.step(-1);
    assert.equal(p.state().mode, "paused");
    assert.equal(p.state().selectedEventId, "E000001");
  });

  it("avanza y retrocede por el orden de grabación", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    p.pause();
    p.seek("E000001");
    p.step(1);
    assert.equal(p.state().selectedEventId, "E000002");
    p.step(1);
    assert.equal(p.state().selectedEventId, "E000002", "no avanza más allá del final");
    p.step(-2);
    assert.equal(p.state().selectedEventId, "E000001");
  });

  it("conserva el orden canónico y el temporal", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    assert.deepEqual(p.order(), ["E000001", "E000002"]);
    assert.deepEqual(p.temporalOrder(), ["E000002", "E000001"]);
  });

  it("un evento tardío no mueve un cursor pausado", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    p.pause();
    p.seek("E000001");
    p.ingest({
      events: [
        ...TRAZA.events,
        evento("E000003", 3, "2026-09-01T10:00:00+00:00", "2026-09-01T12:00:20+00:00"),
      ],
      temporal_order: ["E000003", "E000002", "E000001"],
    });
    assert.equal(p.state().selectedEventId, "E000001", "el cursor pausado no se mueve solo");
    assert.equal(p.state().newEvents, 1);
  });

  it("cuenta cada evento nuevo una sola vez, incluso tras reconectar", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    const conNuevo = {
      events: [...TRAZA.events, evento("E000003", 3, null, "2026-09-01T12:00:20+00:00")],
      temporal_order: ["E000001", "E000002", "E000003"],
    };
    p.ingest(conNuevo);
    assert.equal(p.state().newEvents, 1);
    p.ingest(conNuevo);
    assert.equal(p.state().newEvents, 1, "un duplicado no vuelve a contar");
  });

  it("volver a vivo elige el evento más reciente por secuencia", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    p.pause();
    p.ingest({
      events: [
        ...TRAZA.events,
        evento("E000003", 3, "2026-09-01T10:00:00+00:00", "2026-09-01T12:00:20+00:00"),
      ],
      temporal_order: ["E000003", "E000002", "E000001"],
    });
    p.resumeLive();
    assert.equal(p.state().selectedEventId, "E000003");
    assert.equal(p.state().newEvents, 0);
  });

  it("acepta sólo las velocidades indicadas", () => {
    assert.deepEqual(VELOCIDADES, [0.5, 1, 2, 4]);
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    for (const velocidad of VELOCIDADES) {
      p.setSpeed(velocidad);
      assert.equal(p.state().speed, velocidad);
    }
    assert.throws(() => p.setSpeed(3), /velocidad/i);
  });

  it("el intervalo de 800 ms es tiempo de visualización, no de ejecución", () => {
    assert.equal(INTERVALO_BASE_MS, 800);
    const p = createPlayback(TRAZA.events, { clock: relojFalso(), speed: 2 });
    assert.equal(p.state().speed, 2);
  });

  it("reproducir avanza con el reloj inyectado y se puede pausar", () => {
    const reloj = relojFalso();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    p.pause();
    p.seek("E000001");
    p.play();
    assert.equal(p.state().mode, "playing");
    reloj.avanzar(800);
    assert.equal(p.state().selectedEventId, "E000002");
    p.pause();
    assert.equal(p.state().mode, "paused");
  });

  it("destroy cancela el temporizador", () => {
    const reloj = relojFalso();
    const p = createPlayback(TRAZA.events, { clock: reloj });
    p.pause();
    p.seek("E000001");
    p.play();
    assert.equal(reloj.pendientes(), 1);
    p.destroy();
    assert.equal(reloj.pendientes(), 0);
  });

  it("seek a un identificador desconocido no cambia la selección", () => {
    const p = createPlayback(TRAZA.events, { clock: relojFalso() });
    const antes = p.state().selectedEventId;
    p.seek("E999999");
    assert.equal(p.state().selectedEventId, antes);
  });
});