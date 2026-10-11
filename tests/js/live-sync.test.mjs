import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COALESCE_MS,
  RETRY_DELAYS_MS,
  createReloadScheduler,
  readCoherent,
} from "../../src/ccr_viewer/web/live-sync.js";
import { createFakeClock } from "./fake-clock.mjs";

const CIERRE = { state: "processing", schema_version: 1 };

const vista = (extra = {}) => ({ closure: { ...CIERRE }, updating: false, diagnostics: [], ...extra });
const traza = (extra = {}) => ({ events: [], chain_status: "valid", ...extra });

/**
 * API simulada: `vistas` y `trazas` son colas de respuestas (un valor, una
 * función o un `Error` que se lanza). La última se repite si la cola se agota.
 */
function crearApi({ vistas = [vista()], trazas = [traza()] } = {}) {
  const llamadas = { getRun: 0, getTrace: 0, orden: [] };
  const siguiente = (cola, indice) => {
    const item = cola[Math.min(indice, cola.length - 1)];
    const valor = typeof item === "function" ? item() : item;
    if (valor instanceof Error) throw valor;
    return valor;
  };
  return {
    llamadas,
    async getRun(key) {
      llamadas.orden.push(`run:${key}`);
      return siguiente(vistas, llamadas.getRun++);
    },
    async getTrace(key) {
      llamadas.orden.push(`trace:${key}`);
      return siguiente(trazas, llamadas.getTrace++);
    },
  };
}

function crearSleep() {
  const esperas = [];
  return { esperas, sleep: async (ms) => { esperas.push(ms); } };
}

describe("readCoherent: lectura coherente de vista y traza", () => {
  it("expone las constantes del diseño", () => {
    assert.deepEqual(RETRY_DELAYS_MS, [250, 500, 1000]);
    assert.equal(COALESCE_MS, 100);
  });

  it("lee A, traza y B una sola vez cuando ya es coherente", async () => {
    const api = crearApi();
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
    assert.deepEqual(resultado.view, vista());
    assert.deepEqual(resultado.trace, traza());
    assert.equal(api.llamadas.getRun, 2);
    assert.equal(api.llamadas.getTrace, 1);
    assert.deepEqual(api.llamadas.orden, ["run:run-1", "trace:run-1", "run:run-1"]);
    assert.deepEqual(esperas, []);
  });

  it("con cierre distinto entre A y B reintenta con 250/500/1000 y devuelve updating", async () => {
    let n = 0;
    // Cada lectura de vista devuelve un cierre distinto del anterior.
    const api = crearApi({ vistas: [() => vista({ closure: { state: "processing", n: n++ } })] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "updating");
    assert.deepEqual(esperas, [250, 500, 1000]);
    assert.equal(api.llamadas.getRun, 8, "cuatro intentos de dos vistas");
    assert.equal(api.llamadas.getTrace, 4);
    assert.equal(resultado.view.closure.n, 7, "devuelve la última B leída");
  });

  it("vista A con updating:true no es coherente aunque B coincida", async () => {
    const api = crearApi({ vistas: [vista({ updating: true }), vista()] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
    assert.deepEqual(esperas, [250]);
  });

  it("view.updating:true en B no es coherente; agotados los reintentos devuelve updating", async () => {
    const api = crearApi({ vistas: [vista({ updating: true })] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "updating");
    assert.deepEqual(esperas, [250, 500, 1000]);
    assert.equal(resultado.view.updating, true);
  });

  for (const code of ["snapshot.transition_pending", "snapshot.transition_detected"]) {
    it(`el diagnóstico ${code} no es coherente`, async () => {
      const marcada = vista({ diagnostics: [{ code, severity: "info", message: "m", source: "x" }] });
      const api = crearApi({ vistas: [marcada] });
      const { esperas, sleep } = crearSleep();
      const resultado = await readCoherent("run-1", api, { sleep });
      assert.equal(resultado.status, "updating");
      assert.deepEqual(esperas, [250, 500, 1000]);
    });
  }

  it("otros diagnósticos no impiden la coherencia", async () => {
    const api = crearApi({
      vistas: [vista({ diagnostics: [{ code: "closure.unknown_field", severity: "info", message: "m", source: "x" }] })],
    });
    const { sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
  });

  it("trace.chain_status:'updating' no impide la coherencia", async () => {
    const api = crearApi({ trazas: [traza({ chain_status: "updating" })] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
    assert.equal(resultado.trace.chain_status, "updating");
    assert.deepEqual(esperas, []);
    assert.equal(api.llamadas.getTrace, 1);
  });

  it("si la traza falla con vistas coherentes devuelve trace_failed con la vista B", async () => {
    const fallo = Object.assign(new Error("traza no disponible"), { status: 500, code: "read_error" });
    const b = vista({ closure: { state: "complete", marca: "b" } });
    const a = vista({ closure: { state: "complete", marca: "b" } });
    const api = crearApi({ vistas: [a, b], trazas: [fallo] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "trace_failed");
    assert.equal(resultado.view, b);
    assert.equal(resultado.error, fallo);
    assert.deepEqual(esperas, []);
  });

  it("si la traza falla y las vistas no son coherentes reintenta en lugar de trace_failed", async () => {
    const fallo = new Error("traza no disponible");
    const api = crearApi({ vistas: [vista({ updating: true }), vista({ updating: true }), vista(), vista()], trazas: [fallo, traza()] });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
    assert.deepEqual(esperas, [250]);
  });

  it("se estabiliza en el segundo intento con una sola espera de 250 ms", async () => {
    const api = crearApi({
      vistas: [
        vista({ closure: { state: "processing", n: 1 } }),
        vista({ closure: { state: "processing", n: 2 } }),
        vista({ closure: { state: "processing", n: 3 } }),
        vista({ closure: { state: "processing", n: 3 } }),
      ],
    });
    const { esperas, sleep } = crearSleep();
    const resultado = await readCoherent("run-1", api, { sleep });
    assert.equal(resultado.status, "ok");
    assert.deepEqual(esperas, [250]);
    assert.equal(resultado.view.closure.n, 3);
    assert.equal(api.llamadas.getRun, 4);
    assert.equal(api.llamadas.getTrace, 2);
  });

  it("un error al leer la vista se propaga a quien llama", async () => {
    const expirada = Object.assign(new Error("Sesión expirada."), { status: 403, code: "forbidden" });
    const api = crearApi({ vistas: [expirada] });
    const { esperas, sleep } = crearSleep();
    await assert.rejects(readCoherent("run-1", api, { sleep }), (error) => error === expirada);
    assert.deepEqual(esperas, []);
    assert.equal(api.llamadas.getTrace, 0);
  });

  it("un error al leer la segunda vista también se propaga", async () => {
    const caida = Object.assign(new Error("Corrida ausente."), { status: 404, code: "unknown_id" });
    const api = crearApi({ vistas: [vista(), caida] });
    const { sleep } = crearSleep();
    await assert.rejects(readCoherent("run-1", api, { sleep }), (error) => error === caida);
  });
});

describe("createReloadScheduler: coalescencia, una recarga activa y una pendiente", () => {
  /** `load` manual: cada llamada queda en espera hasta que el test la resuelve. */
  function crearCarga() {
    const llamadas = [];
    return {
      llamadas,
      load: (generation) =>
        new Promise((resolve, reject) => {
          llamadas.push({ generation, resolve, reject });
        }),
    };
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  it("cinco request() dentro de 100 ms producen un único load", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    for (let i = 0; i < 5; i += 1) {
      scheduler.request();
      clock.advance(15);
    }
    assert.equal(carga.llamadas.length, 0, "aún dentro de la ventana (75 ms)");
    clock.advance(25);
    assert.equal(carga.llamadas.length, 1);
    carga.llamadas[0].resolve();
    await tick();
    clock.advance(1000);
    assert.equal(carga.llamadas.length, 1, "sin pendiente no hay otra carga");
  });

  it("la ventana de coalescencia por defecto es de 100 ms", () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(99);
    assert.equal(carga.llamadas.length, 0);
    clock.advance(1);
    assert.equal(carga.llamadas.length, 1);
  });

  it("un request() durante una carga activa produce exactamente una carga pendiente", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(100);
    assert.equal(carga.llamadas.length, 1);
    // Varios avisos mientras la carga sigue activa: una sola pendiente.
    scheduler.request();
    clock.advance(30);
    scheduler.request();
    scheduler.request();
    clock.advance(500);
    assert.equal(carga.llamadas.length, 1, "no hay segunda carga concurrente");
    carga.llamadas[0].resolve();
    await tick();
    clock.advance(100);
    assert.equal(carga.llamadas.length, 2, "exactamente una carga adicional");
    carga.llamadas[1].resolve();
    await tick();
    clock.advance(1000);
    assert.equal(carga.llamadas.length, 2);
  });

  it("cancel() invalida la generación en vuelo y descarta lo pendiente", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(100);
    const generacion = carga.llamadas[0].generation;
    assert.equal(scheduler.isCurrent(generacion), true);
    scheduler.request();
    scheduler.cancel();
    assert.equal(scheduler.isCurrent(generacion), false);
    carga.llamadas[0].resolve();
    await tick();
    clock.advance(1000);
    assert.equal(carga.llamadas.length, 1, "lo pendiente se descartó con cancel()");
  });

  it("cancel() antes de que venza la ventana evita el load", () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    scheduler.cancel();
    clock.advance(1000);
    assert.equal(carga.llamadas.length, 0);
    assert.equal(clock.pending(), 0);
  });

  it("tras cancel() una nueva solicitud usa una generación vigente distinta", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(100);
    const vieja = carga.llamadas[0].generation;
    scheduler.cancel();
    carga.llamadas[0].resolve();
    await tick();
    scheduler.request();
    clock.advance(100);
    assert.equal(carga.llamadas.length, 2);
    const nueva = carga.llamadas[1].generation;
    assert.notEqual(nueva, vieja);
    assert.equal(scheduler.isCurrent(nueva), true);
    assert.equal(scheduler.isCurrent(vieja), false);
  });

  it("un load que lanza no rompe el planificador ni deja la carga activa", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(100);
    carga.llamadas[0].reject(new Error("fallo de carga"));
    await tick();
    scheduler.request();
    clock.advance(100);
    assert.equal(carga.llamadas.length, 2, "una nueva solicitud vuelve a cargar");
    carga.llamadas[1].resolve();
    await tick();
  });

  it("un load que lanza de forma síncrona tampoco deja la carga activa", async () => {
    const clock = createFakeClock();
    let veces = 0;
    const scheduler = createReloadScheduler({
      load: () => {
        veces += 1;
        throw new Error("fallo síncrono");
      },
      clock,
    });
    scheduler.request();
    clock.advance(100);
    await tick();
    scheduler.request();
    clock.advance(100);
    await tick();
    assert.equal(veces, 2);
  });

  it("una pendiente sobrevive al fallo de la carga activa y se ejecuta una vez", async () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock });
    scheduler.request();
    clock.advance(100);
    scheduler.request();
    carga.llamadas[0].reject(new Error("fallo"));
    await tick();
    clock.advance(100);
    assert.equal(carga.llamadas.length, 2);
  });

  it("respeta coalesceMs personalizado", () => {
    const clock = createFakeClock();
    const carga = crearCarga();
    const scheduler = createReloadScheduler({ load: carga.load, clock, coalesceMs: 40 });
    scheduler.request();
    clock.advance(40);
    assert.equal(carga.llamadas.length, 1);
  });
});
