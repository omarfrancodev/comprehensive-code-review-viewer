import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyRelation, evidenceLink } from "../../src/ccr_viewer/web/relations.js";

const ACTUAL = "a".repeat(32);
const OTRA = "b".repeat(32);

const relacion = (target, status, runKey = ACTUAL) => ({
  event_id: "E000002",
  relation: "depends_on",
  raw: target,
  target,
  status,
  run_key: runKey,
  file_key: null,
});

describe("classifyRelation", () => {
  it("un hito local resuelto en la corrida actual navega como `event`", () => {
    const resultado = classifyRelation(relacion("E000001", "resolved"), ACTUAL);
    assert.equal(resultado.navigable, true);
    assert.equal(resultado.scope, "event");
    assert.equal(resultado.id, "E000001");
  });

  it("hallazgos y checks locales resueltos navegan como `finding` y `check`", () => {
    const hallazgo = classifyRelation(relacion("F001", "resolved"), ACTUAL);
    assert.equal(hallazgo.navigable, true);
    assert.equal(hallazgo.scope, "finding");
    assert.equal(hallazgo.id, "F001");
    const check = classifyRelation(relacion("C012", "resolved"), ACTUAL);
    assert.equal(check.navigable, true);
    assert.equal(check.scope, "check");
    assert.equal(check.id, "C012");
  });

  it("un destino resuelto en otra corrida navega como `run` con su clave y destino local", () => {
    const resultado = classifyRelation(relacion("CR-2222222222222222bbbb#E000001", "resolved", OTRA), ACTUAL);
    assert.equal(resultado.navigable, true);
    assert.equal(resultado.scope, "run");
    assert.equal(resultado.runKey, OTRA);
    assert.equal(resultado.id, "E000001");
  });

  for (const estado of ["dangling", "unresolved", "ambiguous", "unavailable", "cyclic"]) {
    it(`\`${estado}\` no navega y explica por qué`, () => {
      const resultado = classifyRelation(relacion("E000009", estado), ACTUAL);
      assert.equal(resultado.navigable, false);
      assert.equal(resultado.scope, "none");
      assert.equal(typeof resultado.reason, "string");
      assert.ok(resultado.reason.trim().length > 0);
    });
  }

  it("las explicaciones de cada estado son distintas", () => {
    const motivos = ["dangling", "unresolved", "ambiguous", "unavailable", "cyclic"]
      .map((estado) => classifyRelation(relacion("E000009", estado), ACTUAL).reason);
    assert.equal(new Set(motivos).size, motivos.length);
  });

  it("un estado desconocido conserva su valor en la explicación y no navega", () => {
    const resultado = classifyRelation(relacion("E000001", "estado_futuro"), ACTUAL);
    assert.equal(resultado.navigable, false);
    assert.match(resultado.reason, /estado_futuro/);
  });

  it("`resolved` sin corrida declarada o con destino no reconocible no navega", () => {
    assert.equal(classifyRelation(relacion("E000001", "resolved", null), ACTUAL).navigable, false);
    assert.equal(classifyRelation(relacion("destino-libre", "resolved"), ACTUAL).navigable, false);
    assert.equal(classifyRelation(relacion("../E000001", "resolved", OTRA), ACTUAL).navigable, false);
  });

  it("entradas mal formadas no lanzan", () => {
    for (const valor of [null, undefined, 3, "E000001", [], {}]) {
      const resultado = classifyRelation(valor, ACTUAL);
      assert.equal(resultado.navigable, false);
      assert.ok(resultado.reason.length > 0);
    }
  });
});

describe("evidenceLink", () => {
  const inventario = [
    { key: "1".repeat(32), relative_path: "informe.md" },
    { key: "2".repeat(32), relative_path: "evidence/notes.json" },
  ];

  it("una coincidencia exacta del inventario enlaza por su clave opaca", () => {
    assert.deepEqual(evidenceLink("evidence/notes.json", inventario), {
      kind: "file",
      fileKey: "2".repeat(32),
      relativePath: "evidence/notes.json",
    });
  });

  it("el traversal queda inerte como `path_traversal`", () => {
    assert.deepEqual(evidenceLink("../secreto", inventario), { kind: "inert", text: "../secreto", code: "path_traversal" });
    assert.equal(evidenceLink("evidence/../informe.md", inventario).code, "path_traversal");
    assert.equal(evidenceLink("evidence\\..\\informe.md", inventario).code, "path_traversal");
  });

  it("las rutas absolutas quedan inertes como `absolute_path`", () => {
    assert.deepEqual(evidenceLink("/etc/passwd", inventario), { kind: "inert", text: "/etc/passwd", code: "absolute_path" });
    assert.deepEqual(evidenceLink("C:\\x", inventario), { kind: "inert", text: "C:\\x", code: "absolute_path" });
    assert.equal(evidenceLink("\\\\servidor\\recurso", inventario).code, "absolute_path");
  });

  it("las URL quedan inertes como `url`", () => {
    assert.deepEqual(evidenceLink("https://x.invalid/a", inventario), { kind: "inert", text: "https://x.invalid/a", code: "url" });
    assert.equal(evidenceLink("javascript:alert(1)", inventario).code, "url");
    assert.equal(evidenceLink("file:evidence/notes.json", inventario).code, "url");
  });

  it("sin coincidencia exacta no se busca por nombre ni por parecido", () => {
    assert.deepEqual(evidenceLink("notes.json", inventario), { kind: "inert", text: "notes.json", code: "not_in_inventory" });
    assert.equal(evidenceLink("Evidence/notes.json", inventario).code, "not_in_inventory");
    assert.equal(evidenceLink("./evidence/notes.json", inventario).code, "not_in_inventory");
    assert.equal(evidenceLink("evidence/notes.json", []).code, "not_in_inventory");
    assert.equal(evidenceLink("evidence/notes.json", null).code, "not_in_inventory");
  });

  it("un objeto con `path` o `relative_path` se trata como la cadena", () => {
    assert.deepEqual(evidenceLink({ path: "evidence/notes.json" }, inventario), evidenceLink("evidence/notes.json", inventario));
    assert.deepEqual(evidenceLink({ relative_path: "evidence/notes.json", nota: "x" }, inventario), evidenceLink("evidence/notes.json", inventario));
    assert.equal(evidenceLink({ path: "../secreto" }, inventario).code, "path_traversal");
  });

  it("cualquier otra forma queda inerte como `unrecognized` con su JSON", () => {
    assert.deepEqual(evidenceLink({ kind: "static", details: "x" }, inventario), {
      kind: "inert",
      text: JSON.stringify({ kind: "static", details: "x" }),
      code: "unrecognized",
    });
    for (const valor of [null, 3, true, ["evidence/notes.json"], "", "   ", { path: 3 }]) {
      assert.equal(evidenceLink(valor, inventario).code, "unrecognized");
    }
  });

  it("entradas del inventario sin clave de texto nunca se enlazan", () => {
    const raro = [{ key: null, relative_path: "evidence/notes.json" }, { relative_path: "informe.md" }];
    assert.equal(evidenceLink("evidence/notes.json", raro).code, "not_in_inventory");
    assert.equal(evidenceLink("informe.md", raro).code, "not_in_inventory");
  });
});
