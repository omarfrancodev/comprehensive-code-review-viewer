import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TEXTO_ACTUALIZACION,
  TEXTO_NO_ACTUALIZADO,
  TEXTO_SESION,
  createLiveReload,
} from "../../src/ccr_viewer/web/live-reload.js";
import { createPresenter } from "../../src/ccr_viewer/web/presenter.js";
import { buildTraceModel } from "../../src/ccr_viewer/web/trace-model.js";
import { createFakeClock } from "./fake-clock.mjs";
import { trazaSintetica } from "./generators.mjs";

const CLAVE = "a".repeat(32);
const vista = (estado = "processing", extra = {}) => ({ closure: { state: estado }, diagnostics: [], ...extra });

/** Deja correr las promesas pendientes (respuestas simuladas y continuaciones). */
async function drenar() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

function sesionCaducada() {
  const error = new Error("Se requiere una sesión local.");
  error.status = 403;
  error.code = "session_required";
  return error;
}

/**
 * Montaje con API mutable: `fuente.vista`/`fuente.traza` pueden ser un valor,
 * un `Error` (se lanza) o una función. Devuelve los registros de cada callback.
 */
function montar({ traza = trazaSintetica(3, { chain: "updating" }), estado = "processing", conPresentador = true } = {}) {
  const clock = createFakeClock();
  const fuente = { vista: vista(estado), traza, peticiones: { run: 0, trace: 0 } };
  const responder = (valor) => {
    const v = typeof valor === "function" ? valor() : valor;
    if (v instanceof Error) throw v;
    return structuredClone(v);
  };
  const api = {
    async getRun() {
      fuente.peticiones.run += 1;
      return responder(fuente.vista);
    },
    async getTrace() {
      fuente.peticiones.trace += 1;
      return responder(fuente.traza);
    },
  };
  let modelo = buildTraceModel(traza);
  const presentador = conPresentador ? createPresenter({ clock }) : null;
  presentador?.load(modelo, { closureState: estado });
  const registro = { vistas: [], trazas: [], estados: [], anuncios: [], caducadas: 0 };
  let clave = CLAVE;
  const vivo = createLiveReload({
    api,
    runKey: () => clave,
    trace: () => (presentador ? { presenter: presentador, model: modelo } : null),
    onView: (v) => registro.vistas.push(v),
    onTrace: (m, diff) => {
      modelo = m;
      registro.trazas.push(diff);
    },
    onStatus: (estadoBanda) => registro.estados.push(estadoBanda),
    announce: (texto, opciones) => registro.anuncios.push({ texto, opciones }),
    onSessionExpired: () => { registro.caducadas += 1; },
    sleep: async () => {},
    clock,
  });
  const cambiarClave = (nueva) => { clave = nueva; };
  return { clock, fuente, presentador, vivo, registro, cambiarClave, modelo: () => modelo };
}

async function avisar(m, aviso = { kind: "run_changed", run_key: CLAVE }) {
  m.vivo.notice(aviso);
  m.clock.advance(100);
  await drenar();
}

describe("createLiveReload", () => {
  it("agrupa avisos en una recarga coherente y entrega vista, modelo y diferencias", async () => {
    const m = montar();
    m.fuente.traza = trazaSintetica(5, { chain: "updating" });
    m.vivo.notice({ kind: "run_changed", run_key: CLAVE });
    m.vivo.notice({ kind: "run_changed", run_key: CLAVE });
    m.vivo.notice({ kind: "run_changed", run_key: null });
    m.clock.advance(100);
    await drenar();
    assert.deepEqual(m.fuente.peticiones, { run: 2, trace: 1 });
    assert.equal(m.registro.vistas.length, 1);
    assert.deepEqual(m.registro.trazas[0].newIds, ["E000004", "E000005"]);
    assert.equal(m.modelo().events.length, 5);
    assert.deepEqual(m.presentador.state().pendingIds, ["E000004", "E000005"]);
  });

  it("ignora avisos de otra corrida", async () => {
    const m = montar();
    await avisar(m, { kind: "run_changed", run_key: "b".repeat(32) });
    assert.deepEqual(m.fuente.peticiones, { run: 0, trace: 0 });
  });

  it("403 session_required: aviso fijo una vez, detiene el suscriptor y no reintenta", async () => {
    const m = montar();
    m.fuente.vista = sesionCaducada;
    await avisar(m);
    assert.equal(m.registro.caducadas, 1);
    assert.deepEqual(m.registro.estados.at(-1), { code: "session", text: TEXTO_SESION, retry: false });
    assert.deepEqual(m.registro.anuncios.map((a) => a.texto), [TEXTO_SESION]);
    assert.deepEqual(m.fuente.peticiones, { run: 1, trace: 0 });
    await avisar(m);
    m.vivo.retry();
    m.vivo.connection("disconnected");
    m.vivo.connection("connected");
    m.clock.advance(5000);
    await drenar();
    assert.deepEqual(m.fuente.peticiones, { run: 1, trace: 0 });
    assert.equal(m.registro.caducadas, 1);
    assert.equal(m.registro.vistas.length, 0);
    assert.equal(m.vivo.connected(), false);
  });

  it("una traza 403 session_required también caduca la sesión (no se trata como «mantener traza»)", async () => {
    const m = montar();
    m.fuente.traza = sesionCaducada;
    await avisar(m);
    assert.equal(m.registro.caducadas, 1);
    assert.equal(m.vivo.status().code, "session");
  });

  it("updating: conserva el modelo, deshabilita En Vivo por cierre parcial y espera otro aviso", async () => {
    const m = montar();
    const antes = m.modelo();
    m.fuente.vista = vista("processing", { updating: true });
    await avisar(m);
    assert.equal(m.modelo(), antes);
    assert.equal(m.registro.vistas.length, 0);
    assert.deepEqual(m.presentador.state().live, { enabled: false, reason: "updating" });
    assert.deepEqual(m.vivo.status(), { code: "updating", text: TEXTO_ACTUALIZACION, retry: true });
    const pedidas = m.fuente.peticiones.run;
    m.clock.advance(10_000);
    await drenar();
    assert.equal(m.fuente.peticiones.run, pedidas);
    m.fuente.vista = vista("processing");
    m.vivo.retry();
    m.clock.advance(100);
    await drenar();
    assert.equal(m.vivo.status(), null);
    assert.deepEqual(m.presentador.state().live, { enabled: true, reason: "processing" });
  });

  it("trace_failed: aplica solo el cierre coherente y conserva la última traza", async () => {
    const m = montar();
    m.presentador.enterLive();
    const antes = m.modelo();
    m.fuente.vista = vista("complete");
    m.fuente.traza = new Error("fallo de lectura");
    await avisar(m);
    assert.equal(m.modelo(), antes);
    assert.equal(m.registro.vistas.length, 1);
    const estado = m.presentador.state();
    assert.equal(estado.mode, "replay");
    assert.equal(estado.live.enabled, false);
    assert.equal(estado.notice.code, "live_ended");
    assert.deepEqual(m.vivo.status(), { code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true });
  });

  it("un cambio de corrida durante la carga descarta la respuesta", async () => {
    const m = montar();
    m.fuente.traza = trazaSintetica(4, { chain: "updating" });
    m.vivo.notice({ kind: "run_changed", run_key: CLAVE });
    m.clock.advance(100);
    // La carga está en curso: se cambia de corrida antes de que termine.
    m.cambiarClave("c".repeat(32));
    m.vivo.runChanged();
    await drenar();
    assert.equal(m.registro.vistas.length, 0);
    assert.equal(m.registro.trazas.length, 0);
    // Tras la primera vista, las demás peticiones ya no se emiten.
    assert.deepEqual(m.fuente.peticiones, { run: 1, trace: 0 });
  });

  it("desconexión: banda sin anuncio y carga estática; al reconectar recarga antes de restablecer", async () => {
    const m = montar();
    m.vivo.connection("connected");
    m.vivo.connection("disconnected");
    assert.deepEqual(m.vivo.status(), { code: "stale", text: TEXTO_NO_ACTUALIZADO, retry: true });
    assert.deepEqual(m.registro.anuncios, []);
    assert.equal(m.presentador.state().loader, "static");
    m.vivo.connection("connected");
    assert.equal(m.presentador.state().loader, "static");
    assert.equal(m.fuente.peticiones.run, 0);
    m.clock.advance(100);
    await drenar();
    assert.equal(m.fuente.peticiones.run, 2);
    assert.equal(m.presentador.state().loader, "active");
    assert.equal(m.vivo.status(), null);
    // Una vista idéntica tras reconectar no se vuelve a entregar.
    m.vivo.connection("disconnected");
    m.vivo.connection("connected");
    m.clock.advance(100);
    await drenar();
    assert.equal(m.registro.vistas.length, 1);
  });

  it("sin presentador solo entrega la vista coherente", async () => {
    const m = montar({ conPresentador: false });
    await avisar(m);
    assert.equal(m.registro.vistas.length, 1);
    assert.equal(m.registro.trazas.length, 0);
  });

  it("watch anuncia cada aviso del presentador una sola vez, aunque repita texto", async () => {
    const m = montar();
    const presentador = createPresenter({ clock: m.clock });
    presentador.load(buildTraceModel(trazaSintetica(2)), { closureState: "processing" });
    const dejar = m.vivo.watch(presentador);
    presentador.update(buildTraceModel(trazaSintetica(3)), { closureState: "processing" });
    presentador.select("E000001");
    presentador.showPending();
    presentador.update(buildTraceModel(trazaSintetica(4)), { closureState: "processing" });
    assert.deepEqual(m.registro.anuncios.map((a) => a.texto), ["1 hito nuevo sin presentar.", "1 hito nuevo sin presentar."]);
    assert.ok(m.registro.anuncios.every((a) => a.opciones?.repeat === true));
    dejar();
  });
});
