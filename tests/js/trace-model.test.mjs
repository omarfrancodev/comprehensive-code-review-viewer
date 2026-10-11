import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { actorKey } from "../../src/ccr_viewer/web/present.js";
import { WINDOW_SIZE, buildTraceModel, reconcileTrace } from "../../src/ccr_viewer/web/trace-model.js";
import { trazaSintetica } from "./generators.mjs";

const ids = (modelo) => modelo.events.map((evento) => evento.event_id);

function evento(secuencia, extra = {}) {
  return {
    event_id: `E${String(secuencia).padStart(6, "0")}`,
    sequence: secuencia,
    kind: "check",
    status: "passed",
    summary: `resumen ${secuencia}`,
    actor: null,
    executor: null,
    recorder: null,
    sha256: `h${secuencia}`,
    ...extra,
  };
}

function traza(eventos, extra = {}) {
  return {
    events: eventos,
    valid_prefix_length: eventos.length,
    chain_status: "verified",
    temporal_order: eventos.map((e) => e.event_id),
    relations: [],
    diagnostics: [],
    ...extra,
  };
}

describe("buildTraceModel: orden y objetos originales", () => {
  it("ordena por sequence y conserva los objetos originales", () => {
    const e3 = evento(3, { campo_desconocido: { a: 1 } });
    const e1 = evento(1);
    const e2 = evento(2);
    const modelo = buildTraceModel(traza([e3, e1, e2]));
    assert.deepEqual(ids(modelo), ["E000001", "E000002", "E000003"]);
    assert.equal(modelo.events[0], e1);
    assert.equal(modelo.events[2], e3);
    assert.equal(modelo.byId.get("E000002"), e2);
    assert.equal(modelo.index.get("E000003"), 2);
    assert.deepEqual(e3.campo_desconocido, { a: 1 });
    assert.equal(modelo.lastId, "E000003");
  });

  it("no muta la entrada ni descarta campos desconocidos", () => {
    const entrada = traza([evento(2, { extra: "x" }), evento(1)]);
    const copia = JSON.parse(JSON.stringify(entrada));
    buildTraceModel(entrada);
    assert.deepEqual(entrada, copia);
  });

  it("maneja 0 y 1 evento", () => {
    const vacio = buildTraceModel(traza([]));
    assert.equal(vacio.lastId, null);
    assert.deepEqual(vacio.actors, []);
    assert.deepEqual(vacio.search("a"), []);
    assert.deepEqual(vacio.windowAround(null), { start: 0, end: 0, total: 0 });
    const uno = buildTraceModel(traza([evento(1)]));
    assert.equal(uno.lastId, "E000001");
    assert.equal(uno.actors.length, 1);
  });

  it("tolera entradas ausentes o mal formadas", () => {
    for (const entrada of [null, undefined, {}, { events: "no" }, 7]) {
      const modelo = buildTraceModel(entrada);
      assert.deepEqual(modelo.events, []);
      assert.equal(modelo.lastId, null);
    }
  });
});

describe("buildTraceModel: actores", () => {
  const agente = (name, extra = {}) => ({ kind: "agent", name, provider_id: null, ...extra });

  it("deduplica por kind+name+provider_id y distingue kind con el mismo nombre", () => {
    const modelo = buildTraceModel(traza([
      evento(1, { actor: agente("a1") }),
      evento(2, { actor: agente("a1") }),
      evento(3, { actor: { kind: "tool", name: "a1", provider_id: null } }),
      evento(4, { actor: agente("a1", { provider_id: "p-9" }) }),
      evento(5, { actor: agente("a1") }),
    ]));
    assert.equal(modelo.actors.length, 3);
    assert.deepEqual(modelo.actors.map((a) => a.count), [3, 1, 1]);
    assert.deepEqual(modelo.actors.map((a) => a.firstId), ["E000001", "E000003", "E000004"]);
    assert.equal(modelo.actors[0].key, actorKey(agente("a1")));
    assert.equal(modelo.actors[0].label, "agent · a1");
  });

  it("agrupa los actores no declarados y no los sustituye por recorder ni executor", () => {
    const modelo = buildTraceModel(traza([
      evento(1, { actor: null, recorder: { kind: "helper", name: "rec", provider_id: null } }),
      evento(2, { actor: agente("a1") }),
      evento(3, { actor: null, executor: { name: "ejecutor-1", provider_id: null } }),
      evento(4),
    ]));
    assert.deepEqual(modelo.actors.map((a) => a.label), ["Actor no declarado", "agent · a1"]);
    assert.equal(modelo.actors[0].key, "∅");
    assert.equal(modelo.actors[0].count, 3);
    assert.equal(modelo.actors[0].firstId, "E000001");
    assert.ok(!modelo.actors.some((a) => a.label.includes("rec") || a.label.includes("ejecutor")));
  });

  it("ordena los actores por primera aparición según sequence", () => {
    const modelo = buildTraceModel(traza([
      evento(3, { actor: agente("c") }),
      evento(1, { actor: agente("b") }),
      evento(2, { actor: agente("a") }),
    ]));
    assert.deepEqual(modelo.actors.map((a) => a.label), ["agent · b", "agent · a", "agent · c"]);
  });

  it("firstOfActor devuelve el primero del actor, opcionalmente dentro de un subconjunto", () => {
    const modelo = buildTraceModel(traza([
      evento(1, { actor: agente("a") }),
      evento(2, { actor: agente("b") }),
      evento(3, { actor: agente("a") }),
      evento(4, { actor: agente("a") }),
    ]));
    const clave = actorKey(agente("a"));
    assert.equal(modelo.firstOfActor(clave), "E000001");
    assert.equal(modelo.firstOfActor(clave, ["E000004", "E000003", "E000002"]), "E000003");
    assert.equal(modelo.firstOfActor(clave, ["E000002"]), null);
    assert.equal(modelo.firstOfActor(clave, []), null);
    assert.equal(modelo.firstOfActor("inexistente"), null);
  });
});

describe("buildTraceModel: búsqueda", () => {
  it("encuentra un ID en 10 000 eventos recorriendo todo el modelo", () => {
    const modelo = buildTraceModel(trazaSintetica(10000));
    assert.deepEqual(modelo.search("E009999"), ["E009999"]);
    assert.deepEqual(modelo.search("e009999"), ["E009999"]);
    assert.equal(modelo.search("Evento sintético").length, 10000);
  });

  it("busca en actor, ID, kind, status y summary sin distinguir mayúsculas", () => {
    const modelo = buildTraceModel(traza([
      evento(1, { actor: { kind: "agent", name: "Revisor-Uno", provider_id: "prov-77" }, summary: "Inicio" }),
      evento(2, { kind: "Discovery", status: "Started", summary: "Otra cosa" }),
      evento(3, { summary: "Contiene PALABRA clave" }),
    ]));
    assert.deepEqual(modelo.search("revisor-uno"), ["E000001"]);
    assert.deepEqual(modelo.search("PROV-77"), ["E000001"]);
    assert.deepEqual(modelo.search("discovery"), ["E000002"]);
    assert.deepEqual(modelo.search("STARTED"), ["E000002"]);
    assert.deepEqual(modelo.search("palabra"), ["E000003"]);
    assert.deepEqual(modelo.search("e000003"), ["E000003"]);
    assert.deepEqual(modelo.search("   "), []);
    assert.deepEqual(modelo.search("no-existe"), []);
  });

  it("devuelve los IDs en orden de sequence", () => {
    const modelo = buildTraceModel(traza([evento(3), evento(1), evento(2)]));
    assert.deepEqual(modelo.search("resumen"), ["E000001", "E000002", "E000003"]);
  });
});

describe("buildTraceModel: ventanas", () => {
  it("usa ventanas de 50", () => {
    assert.equal(WINDOW_SIZE, 50);
    const cincuenta = buildTraceModel(trazaSintetica(50));
    assert.deepEqual(cincuenta.windowAround("E000001"), { start: 0, end: 50, total: 50 });
    const mas = buildTraceModel(trazaSintetica(51));
    assert.deepEqual(mas.windowAround("E000050"), { start: 0, end: 50, total: 51 });
    assert.deepEqual(mas.windowAround("E000051"), { start: 50, end: 51, total: 51 });
  });

  it("mantiene el total y la posición global en 10 000 eventos", () => {
    const modelo = buildTraceModel(trazaSintetica(10000));
    assert.deepEqual(modelo.windowAround("E000051"), { start: 50, end: 100, total: 10000 });
    assert.deepEqual(modelo.windowAround("E000050"), { start: 0, end: 50, total: 10000 });
    assert.deepEqual(modelo.windowAround(null), { start: 9950, end: 10000, total: 10000 });
  });

  it("sin ID o con un ID desconocido devuelve la última ventana", () => {
    const modelo = buildTraceModel(trazaSintetica(120));
    assert.deepEqual(modelo.windowAround(null), { start: 100, end: 120, total: 120 });
    assert.deepEqual(modelo.windowAround("E999999"), { start: 100, end: 120, total: 120 });
  });

  it("acepta otro tamaño y descarta tamaños inválidos", () => {
    const modelo = buildTraceModel(trazaSintetica(25));
    assert.deepEqual(modelo.windowAround("E000012", 10), { start: 10, end: 20, total: 25 });
    assert.deepEqual(modelo.windowAround("E000012", 0), { start: 0, end: 25, total: 25 });
    assert.deepEqual(modelo.windowAround("E000012", -3), { start: 0, end: 25, total: 25 });
  });
});

describe("buildTraceModel: cadena, tiempos y relaciones", () => {
  it("traduce chain_status y conserva los diagnósticos", () => {
    const diagnostico = { code: "trace.limited", severity: "warning", message: "Cadena limitada", source: null };
    const limitada = buildTraceModel(traza([evento(1)], { chain_status: "limited", diagnostics: [diagnostico], valid_prefix_length: 1 }));
    assert.equal(limitada.chain.status, "limited");
    assert.equal(limitada.chain.verified, false);
    assert.equal(limitada.chain.updating, false);
    assert.equal(limitada.chain.validPrefixLength, 1);
    assert.deepEqual(limitada.diagnostics, [diagnostico]);
    assert.equal(limitada.diagnostics[0], diagnostico);

    const actualizando = buildTraceModel(traza([evento(1)], { chain_status: "updating" }));
    assert.equal(actualizando.chain.updating, true);
    assert.equal(actualizando.chain.verified, false);

    const verificada = buildTraceModel(traza([evento(1)]));
    assert.equal(verificada.chain.verified, true);
    assert.equal(verificada.chain.updating, false);

    const fallida = buildTraceModel(traza([evento(1)], { chain_status: "failed", valid_prefix_length: 0 }));
    assert.equal(fallida.chain.status, "failed");
    assert.equal(fallida.chain.verified, false);
    assert.equal(fallida.chain.validPrefixLength, 0);
  });

  it("conserva horas iguales, respaldos de secuencia y el orden temporal del backend", () => {
    const e1 = evento(1, { temporal_basis: "sequence_fallback", temporal_at: undefined, occurred_at: null });
    const e2 = evento(2, { temporal_basis: "observed_occurrence", temporal_at: "2026-09-01T12:00:00+00:00" });
    const e3 = evento(3, { temporal_basis: "observed_occurrence", temporal_at: "2026-09-01T12:00:00+00:00" });
    const orden = ["E000003", "E000001", "E000002"];
    const modelo = buildTraceModel(traza([e1, e2, e3], { temporal_order: orden }));
    assert.deepEqual(ids(modelo), ["E000001", "E000002", "E000003"]);
    assert.equal(modelo.events[0].temporal_basis, "sequence_fallback");
    assert.equal("temporal_at" in modelo.events[0], true);
    assert.equal(modelo.events[0].temporal_at, undefined);
    assert.equal(modelo.events[1].temporal_at, modelo.events[2].temporal_at);
    assert.deepEqual(modelo.temporalOrder, orden);
  });

  it("separa relaciones salientes y entrantes con su status original", () => {
    const relaciones = [
      { event_id: "E000002", relation: "follows", raw: "E000001", target: "E000001", status: "resolved" },
      { event_id: "E000003", relation: "depends_on", raw: "E000002", target: "E000002", status: "resolved" },
      { event_id: "E000002", relation: "depends_on", raw: "E000009", target: "E000009", status: "dangling" },
      { event_id: "E000001", relation: "relates_to", raw: "E000002", target: "E000002", status: "cyclic" },
    ];
    const modelo = buildTraceModel(traza([evento(1), evento(2), evento(3)], { relations: relaciones }));
    const { outgoing, incoming } = modelo.relationsOf("E000002");
    assert.deepEqual(outgoing.map((r) => [r.target, r.status]), [["E000001", "resolved"], ["E000009", "dangling"]]);
    assert.deepEqual(incoming.map((r) => [r.event_id, r.status]), [["E000003", "resolved"], ["E000001", "cyclic"]]);
    assert.equal(outgoing[0], relaciones[0]);
    assert.equal(incoming[1], relaciones[3]);
    assert.deepEqual(modelo.relationsOf("E000099"), { outgoing: [], incoming: [] });
    assert.equal(modelo.relations, relaciones);
  });
});

describe("reconcileTrace", () => {
  it("solo añadidos: newIds ordenados y prefijo conservado", () => {
    const anterior = buildTraceModel(traza([evento(1), evento(2)]));
    const siguiente = buildTraceModel(traza([evento(4), evento(1), evento(3), evento(2)]));
    assert.deepEqual(reconcileTrace(anterior, siguiente), {
      newIds: ["E000003", "E000004"],
      changedIds: [],
      prefixReplaced: false,
    });
  });

  it("mismo ID con otro sha256: changedIds y no newIds", () => {
    const anterior = buildTraceModel(traza([evento(1), evento(2)]));
    const siguiente = buildTraceModel(traza([evento(1), evento(2, { sha256: "otro", summary: "editado" })]));
    assert.deepEqual(reconcileTrace(anterior, siguiente), { newIds: [], changedIds: ["E000002"], prefixReplaced: false });
  });

  it("sin sha256 compara el contenido completo", () => {
    const sinHash = (n, extra) => {
      const e = evento(n, extra);
      delete e.sha256;
      return e;
    };
    const anterior = buildTraceModel(traza([sinHash(1), sinHash(2)]));
    const igual = buildTraceModel(traza([sinHash(1), sinHash(2)]));
    const distinto = buildTraceModel(traza([sinHash(1), sinHash(2, { summary: "otro" })]));
    assert.deepEqual(reconcileTrace(anterior, igual), { newIds: [], changedIds: [], prefixReplaced: false });
    assert.deepEqual(reconcileTrace(anterior, distinto).changedIds, ["E000002"]);
  });

  it("prefijo más corto o IDs previos ausentes marca prefixReplaced", () => {
    const anterior = buildTraceModel(traza([evento(1), evento(2), evento(3)]));
    const corto = buildTraceModel(traza([evento(1), evento(2)]));
    assert.deepEqual(reconcileTrace(anterior, corto), { newIds: [], changedIds: [], prefixReplaced: true });
    const distinto = buildTraceModel(traza([evento(1), evento(3), evento(4)]));
    const diff = reconcileTrace(anterior, distinto);
    assert.equal(diff.prefixReplaced, true);
    assert.deepEqual(diff.newIds, ["E000004"]);
  });

  it("sin cambios devuelve todo vacío", () => {
    const anterior = buildTraceModel(traza([evento(1), evento(2)]));
    const siguiente = buildTraceModel(traza([evento(1), evento(2)]));
    assert.deepEqual(reconcileTrace(anterior, siguiente), { newIds: [], changedIds: [], prefixReplaced: false });
  });

  it("sin modelo anterior no hay nada nuevo que comparar", () => {
    const siguiente = buildTraceModel(traza([evento(1)]));
    assert.deepEqual(reconcileTrace(null, siguiente), { newIds: [], changedIds: [], prefixReplaced: false });
  });

  it("compara 10 000 eventos sin recorridos cuadráticos", () => {
    const anterior = buildTraceModel(trazaSintetica(10000));
    const siguiente = buildTraceModel(trazaSintetica(10001));
    const diff = reconcileTrace(anterior, siguiente);
    assert.deepEqual(diff, { newIds: ["E010001"], changedIds: [], prefixReplaced: false });
  });
});

describe("trazaSintetica", () => {
  it("genera la forma de /trace con opciones deterministas", () => {
    const t = trazaSintetica(4, { actors: 2, basis: "none", chain: "limited" });
    assert.equal(t.events.length, 4);
    assert.equal(t.chain_status, "limited");
    assert.equal(t.valid_prefix_length, 4);
    assert.ok(t.events.every((e) => e.temporal_basis === "sequence_fallback" && e.temporal_at === null));
    assert.equal(new Set(t.events.map((e) => e.actor.name)).size, 2);
    assert.deepEqual(trazaSintetica(4), trazaSintetica(4));
    const observada = trazaSintetica(3, { basis: "observed" });
    assert.ok(observada.events.every((e) => e.temporal_basis === "observed_occurrence" && e.occurred_at !== null));
  });
});
