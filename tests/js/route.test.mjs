import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ROUTE_TABS, buildRoute, parseRoute } from "../../src/ccr_viewer/web/route.js";

const RUN = "0123456789abcdef0123456789abcdef";

describe("parseRoute", () => {
  it("acepta una ruta válida", () => {
    assert.deepEqual(parseRoute(`?run=${RUN}&tab=trazabilidad&event=E000003`), {
      run: RUN,
      tab: "trazabilidad",
      event: "E000003",
    });
  });

  it("devuelve nulos sin parámetros", () => {
    assert.deepEqual(parseRoute(""), { run: null, tab: null, event: null });
    assert.deepEqual(parseRoute(undefined), { run: null, tab: null, event: null });
  });

  it("rechaza un run de 31 hex o con mayúsculas", () => {
    assert.equal(parseRoute(`?run=${RUN.slice(1)}`).run, null);
    assert.equal(parseRoute(`?run=${RUN.toUpperCase()}`).run, null);
  });

  it("rechaza pestañas inventadas", () => {
    assert.equal(parseRoute("?tab=inventada").tab, null);
  });

  it("rechaza eventos mal formados", () => {
    assert.equal(parseRoute("?event=E00001").event, null);
    assert.equal(parseRoute("?event=E0000001").event, null);
    assert.equal(parseRoute("?event=e000001").event, null);
  });

  it("ignora claves desconocidas", () => {
    assert.deepEqual(parseRoute(`?token=x&run=${RUN}`), { run: RUN, tab: null, event: null });
  });

  it("expone las pestañas existentes", () => {
    assert.deepEqual(ROUTE_TABS, [
      "ficha", "hallazgos", "validacion", "seguimiento", "documentos", "trazabilidad", "archivo",
    ]);
  });
});

describe("buildRoute", () => {
  it("omite nulos", () => {
    assert.equal(buildRoute({ run: null, tab: null, event: null }), "");
    assert.equal(buildRoute({ run: RUN, tab: null, event: null }), `?run=${RUN}`);
  });

  it("emite las tres claves en orden estable", () => {
    assert.equal(
      buildRoute({ run: RUN, tab: "hallazgos", event: "E000010" }),
      `?run=${RUN}&tab=hallazgos&event=E000010`,
    );
  });

  it("nunca emite token y descarta valores inválidos", () => {
    const ruta = buildRoute({ run: "xyz", tab: "inventada", event: "E1", token: "secreto" });
    assert.equal(ruta, "");
    assert.equal(buildRoute({ run: RUN, token: "secreto" }).includes("token"), false);
  });

  it("es idempotente con parseRoute", () => {
    const rutas = [
      { run: RUN, tab: "trazabilidad", event: "E000003" },
      { run: RUN, tab: null, event: null },
      { run: null, tab: "ficha", event: null },
      { run: null, tab: null, event: null },
    ];
    for (const ruta of rutas) {
      assert.deepEqual(parseRoute(buildRoute(ruta)), ruta);
    }
  });
});
