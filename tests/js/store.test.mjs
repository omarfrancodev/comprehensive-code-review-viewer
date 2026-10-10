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