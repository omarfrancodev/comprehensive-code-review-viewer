import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createStore, selectFindingCounts, reduce } from "../../src/ccr_viewer/web/store.js";

const review = (overrides = {}) => ({
  schema_version: 7,
  findings: [
    { id: "F001", status: "confirmed", priority: "P0" },
    { id: "F002", status: "confirmed", priority: "P2" },
    { id: "F003", status: "unresolved", priority: "P1" },
    { id: "F004", status: "rejected", priority: "P3" },
    { id: "F005", status: "confirmed", priority: "sin-prioridad" },
  ],
  checks: [],
  coverage: { stale: false, adequate: true, limitations: { material: false, details: "" } },
  ...overrides,
});

describe("selectFindingCounts", () => {
  it("cuenta sólo confirmados en el resumen por prioridad", () => {
    const counts = selectFindingCounts(review());
    assert.equal(counts.confirmed.P0, 1);
    assert.equal(counts.confirmed.P1, 0);
    assert.equal(counts.confirmed.P2, 1);
    assert.equal(counts.confirmed.P3, 0);
    assert.equal(counts.totalConfirmed, 3);
  });

  it("separa no confirmados de los confirmados", () => {
    const counts = selectFindingCounts(review());
    assert.equal(counts.unresolved, 1);
    assert.equal(counts.rejected, 1);
    assert.equal(counts.totalConfirmed, 3);
  });

  it("agrupa las prioridades desconocidas aparte", () => {
    const counts = selectFindingCounts(review());
    assert.equal(counts.unknownPriority, 1);
  });

  it("un registro ausente produce ceros, no hallazgos inventados", () => {
    const counts = selectFindingCounts(null);
    assert.equal(counts.totalConfirmed, 0);
    assert.equal(counts.unknownPriority, 0);
    assert.equal(counts.unresolved, 0);
    assert.equal(counts.rejected, 0);
  });
});

describe("createStore", () => {
  it("entrega el estado inicial y notifica a los suscriptores", () => {
    const store = createStore({ selectedRun: null });
    const seen = [];
    store.subscribe((state) => seen.push(state.selectedRun));
    store.dispatch({ type: "selectRun", key: "abc" });
    assert.equal(store.getState().selectedRun, "abc");
    // Suscribirse no notifica: el primer render se dispara explícitamente.
    assert.deepEqual(seen, ["abc"]);
  });

  it("conserva la selección y el desplazamiento al recargar", () => {
    const store = createStore({ selectedRun: "abc", scrollTop: 320, tab: "hallazgos" });
    store.dispatch({ type: "selectRun", key: "abc" });
    store.dispatch({ type: "notice", notice: { kind: "catalog_changed" } });
    store.dispatch({ type: "reloadLibrary" });
    const state = store.getState();
    assert.equal(state.selectedRun, "abc");
    assert.equal(state.scrollTop, 320);
    assert.equal(state.tab, "hallazgos");
  });

  it("no muta el estado anterior", () => {
    const store = createStore({ selectedRun: "abc" });
    const before = store.getState();
    store.dispatch({ type: "selectRun", key: "otro" });
    assert.equal(before.selectedRun, "abc");
  });

  it("devuelve la función para cancelar la suscripción", () => {
    const store = createStore({});
    const seen = [];
    const unsubscribe = store.subscribe((state) => seen.push(state));
    store.dispatch({ type: "selectRun", key: "a" });
    unsubscribe();
    store.dispatch({ type: "selectRun", key: "b" });
    // Sólo el primer cambio notifica; tras cancelar, el segundo no llega.
    assert.equal(store.getState().selectedRun, "b");
    assert.equal(seen.length, 1);
  });

  it("una acción desconocida conserva el estado", () => {
    const store = createStore({ selectedRun: "abc" });
    store.dispatch({ type: "inexistente" });
    assert.equal(store.getState().selectedRun, "abc");
  });
});

describe("shell: preferencias, selección y conexión", () => {
  it("el estado inicial no conserva `theme` y parte de preferencias por omisión", () => {
    const state = createStore().getState();
    assert.equal("theme" in state, false);
    assert.deepEqual(state.prefs, { theme: "system", density: "comfortable", motion: "system" });
    assert.equal(state.selectedEventId, null);
    assert.equal(state.connection, "connecting");
  });

  it("setPrefs actualiza prefs", () => {
    const store = createStore();
    store.dispatch({ type: "setPrefs", prefs: { theme: "dark", density: "compact", motion: "reduce" } });
    assert.deepEqual(store.getState().prefs, { theme: "dark", density: "compact", motion: "reduce" });
  });

  it("selectRun reinicia selectedEventId y tab a «ficha»", () => {
    const store = createStore({ selectedRun: "a", tab: "hallazgos", selectedEventId: "E000002" });
    store.dispatch({ type: "selectRun", key: "b" });
    const state = store.getState();
    assert.equal(state.selectedRun, "b");
    assert.equal(state.tab, "ficha");
    assert.equal(state.selectedEventId, null);
    assert.equal(state.view, null);
  });

  it("selectRun respeta una pestaña y un hito explícitos", () => {
    const store = createStore({ selectedRun: "a", tab: "ficha" });
    store.dispatch({ type: "selectRun", key: "b", tab: "trazabilidad", eventId: "E000003" });
    assert.equal(store.getState().tab, "trazabilidad");
    assert.equal(store.getState().selectedEventId, "E000003");
  });

  it("selectRun ignora una pestaña fuera del vocabulario", () => {
    const store = createStore({ selectedRun: "a" });
    store.dispatch({ type: "selectRun", key: "b", tab: "inventada" });
    assert.equal(store.getState().tab, "ficha");
  });

  it("selectEvent guarda el ID", () => {
    const store = createStore({ selectedRun: "a" });
    store.dispatch({ type: "selectEvent", eventId: "E000001" });
    assert.equal(store.getState().selectedEventId, "E000001");
    store.dispatch({ type: "selectEvent", eventId: null });
    assert.equal(store.getState().selectedEventId, null);
  });

  it("setTab conserva el hito seleccionado de la corrida", () => {
    const store = createStore({ selectedRun: "a", selectedEventId: "E000002" });
    store.dispatch({ type: "setTab", tab: "hallazgos" });
    assert.equal(store.getState().selectedEventId, "E000002");
  });

  it("setConnection registra solo estados conocidos", () => {
    const store = createStore();
    store.dispatch({ type: "setConnection", state: "connected" });
    assert.equal(store.getState().connection, "connected");
    store.dispatch({ type: "setConnection", state: "disconnected" });
    assert.equal(store.getState().connection, "disconnected");
    store.dispatch({ type: "setConnection", state: "inventado" });
    assert.equal(store.getState().connection, "disconnected");
  });
});

describe("reduce", () => {
  it("acumula los avisos nuevos sin duplicar por cursor", () => {
    let state = reduce({ newEventCount: 0 }, { type: "notice", notice: { kind: "run_changed" } });
    assert.equal(state.newEventCount, 1);
    state = reduce(state, { type: "notice", notice: { kind: "catalog_changed" } });
    assert.equal(state.newEventCount, 1, "un aviso de biblioteca no cuenta como evento nuevo");
  });

  it("un resync limpia los avisos pendientes", () => {
    let state = reduce({ newEventCount: 3 }, { type: "notice", notice: { kind: "run_changed" } });
    state = reduce(state, { type: "notice", notice: { kind: "resync" } });
    assert.equal(state.newEventCount, 0);
  });
});