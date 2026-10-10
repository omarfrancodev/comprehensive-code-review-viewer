import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  actorKey,
  actorLabel,
  basisLabel,
  basisShape,
  formatInstant,
  labelRuns,
  runTitle,
} from "../../src/ccr_viewer/web/present.js";

describe("runTitle", () => {
  it("reconoce PR por modo y referencia numérica", () => {
    assert.deepEqual(runTitle({ scope_label: "pr 42", scope_reference: "42" }), { label: "PR #42", kind: "pr" });
  });

  it("reconoce MR por modo y marcador", () => {
    assert.deepEqual(runTitle({ scope_label: "mr !7", scope_reference: "!7" }), { label: "MR !7", kind: "mr" });
  });

  it("reconoce PR y MR por URL", () => {
    assert.deepEqual(
      runTitle({ scope_reference: "https://git.ejemplo.invalid/acme/demo/pull/9" }),
      { label: "PR #9", kind: "pr" },
    );
    assert.deepEqual(
      runTitle({ scope_reference: "https://git.ejemplo.invalid/acme/demo/-/merge_requests/12" }),
      { label: "MR !12", kind: "mr" },
    );
  });

  it("reconoce por marcador sin modo", () => {
    assert.deepEqual(runTitle({ scope_reference: "#5" }), { label: "PR #5", kind: "pr" });
    assert.deepEqual(runTitle({ scope_reference: "!5" }), { label: "MR !5", kind: "mr" });
  });

  it("conserva la etiqueta de otros alcances", () => {
    assert.deepEqual(
      runTitle({ scope_label: "branch feature/x", scope_reference: "feature/x" }),
      { label: "branch feature/x", kind: "scope" },
    );
  });

  it("sin alcance usa los primeros 8 caracteres de la clave", () => {
    assert.deepEqual(
      runTitle({ key: "aaaaaaaabbbbbbbbccccccccdddddddd" }),
      { label: "Revisión aaaaaaaa", kind: "key" },
    );
  });

  it("una URL no reconocible nunca produce un título humano inventado", () => {
    const url = "https://git.ejemplo.invalid/acme/demo/commit/abc123";
    const titulo = runTitle({ scope_reference: url, key: "aaaaaaaabbbbbbbb" });
    assert.equal(titulo.kind, "reference");
    assert.equal(titulo.label, url);
    assert.doesNotMatch(titulo.label, /^(PR|MR) /);
  });

  it("un número sin modo ni marcador no se presenta como PR", () => {
    assert.deepEqual(runTitle({ scope_reference: "42" }), { label: "42", kind: "reference" });
  });
});

describe("labelRuns", () => {
  const fila = (key, extra = {}) => ({ key, scope_label: "pr 42", scope_reference: "42", ...extra });

  it("distingue duplicados con el ID de origen", () => {
    const mapa = labelRuns([
      fila("aaaaaaaa11111111", { source_review_id: "rev-A" }),
      fila("bbbbbbbb22222222", { source_review_id: "rev-B" }),
    ]);
    assert.deepEqual(mapa.get("aaaaaaaa11111111"), { label: "PR #42", hint: "rev-A" });
    assert.deepEqual(mapa.get("bbbbbbbb22222222"), { label: "PR #42", hint: "rev-B" });
  });

  it("sin ID de origen usa los 8 primeros caracteres de la clave", () => {
    const mapa = labelRuns([fila("aaaaaaaa11111111"), fila("bbbbbbbb22222222", { source_review_id: null })]);
    assert.equal(mapa.get("aaaaaaaa11111111").hint, "aaaaaaaa");
    assert.equal(mapa.get("bbbbbbbb22222222").hint, "bbbbbbbb");
  });

  it("una etiqueta única no lleva pista", () => {
    const mapa = labelRuns([
      fila("aaaaaaaa11111111"),
      { key: "cccccccc33333333", scope_label: "pr 43", scope_reference: "43" },
    ]);
    assert.deepEqual(mapa.get("aaaaaaaa11111111"), { label: "PR #42", hint: null });
    assert.deepEqual(mapa.get("cccccccc33333333"), { label: "PR #43", hint: null });
  });
});

describe("actores", () => {
  it("distingue el mismo nombre con distinto tipo", () => {
    assert.notEqual(actorKey({ kind: "agent", name: "a1" }), actorKey({ kind: "human", name: "a1" }));
  });

  it("es estable para la misma identidad", () => {
    assert.equal(
      actorKey({ kind: "agent", name: "a1", provider_id: "p" }),
      actorKey({ provider_id: "p", name: "a1", kind: "agent", extra: 1 }),
    );
  });

  it("identidad ausente", () => {
    assert.equal(actorKey(null), "∅");
    assert.equal(actorKey(undefined), "∅");
    assert.equal(actorKey({}), "∅");
    assert.equal(actorLabel(null), "Actor no declarado");
    assert.equal(actorLabel({}), "Actor no declarado");
  });

  it("etiqueta con tipo y nombre", () => {
    assert.equal(actorLabel({ kind: "agent", name: "a1", provider_id: "p" }), "agent · a1");
    assert.equal(actorLabel({ name: "a1" }), "a1");
  });
});

describe("formatInstant", () => {
  it("normaliza a UTC y conserva el original", () => {
    const original = "2026-09-01T12:00:05+00:00";
    const r = formatInstant(original);
    assert.equal(r.utc, "2026-09-01T12:00:05.000Z");
    assert.equal(r.original, original);
    assert.equal(typeof r.local, "string");
  });

  it("convierte desplazamientos a UTC", () => {
    assert.equal(formatInstant("2026-09-01T12:00:05-05:00").utc, "2026-09-01T17:00:05.000Z");
  });

  it("acepta microsegundos de Python", () => {
    assert.equal(formatInstant("2026-09-01T12:00:05.123456+00:00").utc, "2026-09-01T12:00:05.123Z");
  });

  it("un valor inválido conserva solo el original", () => {
    assert.deepEqual(formatInstant("ayer por la tarde"), { local: null, utc: null, original: "ayer por la tarde" });
    assert.deepEqual(formatInstant("12"), { local: null, utc: null, original: "12" });
  });

  it("un instante sin desplazamiento no se interpreta en zona local", () => {
    assert.deepEqual(
      formatInstant("2026-09-01T12:00:05"),
      { local: null, utc: null, original: "2026-09-01T12:00:05" },
    );
  });

  it("ausente", () => {
    assert.deepEqual(formatInstant(null), { local: null, utc: null, original: null });
    assert.deepEqual(formatInstant(undefined), { local: null, utc: null, original: null });
  });
});

describe("base temporal", () => {
  it("etiqueta en español", () => {
    assert.equal(basisLabel("observed_occurrence"), "ocurrencia observada");
    assert.equal(basisLabel("recording_fallback"), "respaldo de registro");
    assert.equal(basisLabel("sequence_fallback"), "respaldo de secuencia");
  });

  it("un valor desconocido se muestra como llegó", () => {
    assert.equal(basisLabel("otra_base"), "otra_base");
  });

  it("forma por base", () => {
    assert.equal(basisShape("observed_occurrence"), "circle");
    assert.equal(basisShape("recording_fallback"), "diamond");
    assert.equal(basisShape("sequence_fallback"), "hollow");
  });
});
