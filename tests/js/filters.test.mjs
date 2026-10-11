import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FILTER_KEYS,
  KINDS,
  PROFILES,
  VERDICTS,
  filterChips,
  normalizeFilters,
  sameFilters,
  suggestFromPage,
  validateFilters,
} from "../../src/ccr_viewer/web/filters.js";

const CONTRATO = JSON.parse(
  readFileSync(new URL("../../src/ccr_viewer/contracts/compatibility.json", import.meta.url), "utf8"),
).review;

describe("claves y enums del contrato", () => {
  it("las claves son las que entiende /api/runs", () => {
    assert.deepEqual(FILTER_KEYS, [
      "q", "repository", "verdict", "profile", "mode", "reference", "kind", "open", "date_from", "date_to",
    ]);
  });

  it("VERDICTS y KINDS coinciden con compatibility.json", () => {
    assert.deepEqual([...VERDICTS], CONTRATO.verdicts);
    assert.deepEqual([...KINDS], CONTRATO.presentation_kinds);
  });

  it("PROFILES es la unión de review.profiles.* del contrato", () => {
    const union = new Set(Object.values(CONTRATO.profiles).flat());
    assert.deepEqual(new Set(PROFILES), union);
    assert.equal(PROFILES.length, union.size, "sin repetidos");
  });
});

describe("normalizeFilters", () => {
  it("recorta y descarta vacíos", () => {
    assert.deepEqual(normalizeFilters({ q: "  a ", verdict: "" }), { q: "a" });
  });

  it("conserva valores desconocidos sin reinterpretarlos", () => {
    assert.deepEqual(normalizeFilters({ verdict: "valor_futuro", mode: " mr ", open: "false" }), {
      verdict: "valor_futuro",
      mode: "mr",
      open: "false",
    });
  });

  it("descarta claves ajenas y valores que no son texto", () => {
    assert.deepEqual(normalizeFilters({ q: "x", otro: "y", profile: { a: 1 }, kind: null }), { q: "x" });
    assert.deepEqual(normalizeFilters(null), {});
    assert.deepEqual(normalizeFilters(undefined), {});
  });

  it("no hereda claves del prototipo", () => {
    const heredado = Object.create({ q: "heredado" });
    assert.deepEqual(normalizeFilters(heredado), {});
  });
});

describe("sameFilters", () => {
  it("compara por contenido normalizado", () => {
    assert.equal(sameFilters({ q: " a " }, { q: "a", verdict: "" }), true);
    assert.equal(sameFilters({ q: "a" }, { q: "b" }), false);
    assert.equal(sameFilters({}, { q: "a" }), false);
  });
});

describe("validateFilters", () => {
  it("sin fechas es válido", () => {
    assert.deepEqual(validateFilters({ q: "x" }), { ok: true, errors: {} });
  });

  it("«desde» posterior a «hasta» falla con error en date_from", () => {
    const resultado = validateFilters({ date_from: "2026-09-02", date_to: "2026-09-01" });
    assert.equal(resultado.ok, false);
    assert.match(resultado.errors.date_from, /posterior/);
    assert.equal(resultado.errors.date_to, undefined);
  });

  it("fechas iguales o en orden son válidas", () => {
    assert.equal(validateFilters({ date_from: "2026-09-01", date_to: "2026-09-01" }).ok, true);
    assert.equal(validateFilters({ date_from: "2026-08-31", date_to: "2026-09-01" }).ok, true);
  });

  it("formato inválido o fecha imposible produce error en su campo", () => {
    const formato = validateFilters({ date_from: "01/09/2026", date_to: "2026-9-1" });
    assert.equal(formato.ok, false);
    assert.ok(formato.errors.date_from);
    assert.ok(formato.errors.date_to);
    const imposible = validateFilters({ date_to: "2026-02-30" });
    assert.equal(imposible.ok, false);
    assert.ok(imposible.errors.date_to);
  });
});

describe("filterChips", () => {
  it("open=true se etiqueta «Abiertas»", () => {
    assert.deepEqual(filterChips({ open: "true" }), [{ key: "open", label: "Abiertas", value: "true" }]);
  });

  it("open=false se etiqueta «Cerradas»", () => {
    assert.equal(filterChips({ open: "false" })[0].label, "Cerradas");
  });

  it("sigue el orden de las claves y conserva el valor original", () => {
    const chips = filterChips({ date_to: "2026-09-30", verdict: "otro_valor", q: "x", repository: "git/a" });
    assert.deepEqual(chips.map((chip) => chip.key), ["q", "repository", "verdict", "date_to"]);
    assert.equal(chips.find((chip) => chip.key === "verdict").value, "otro_valor");
  });

  it("sin filtros no hay chips", () => {
    assert.deepEqual(filterChips({}), []);
  });
});

describe("suggestFromPage", () => {
  const items = [
    { repository_identity: "git/a", scope_label: "pr 42", scope_reference: "42" },
    { repository_identity: "git/a", scope_label: "pr 43", scope_reference: "" },
    { repository_identity: "", scope_label: "mr 7", scope_reference: null },
    { repository_identity: "git/b", scope_label: "", scope_reference: "7" },
    null,
  ];

  it("deduplica y excluye vacíos", () => {
    assert.deepEqual(suggestFromPage(items, "repository"), ["git/a", "git/b"]);
    assert.deepEqual(suggestFromPage(items, "reference"), ["42", "7"]);
  });

  it("modo es la primera palabra del alcance declarado", () => {
    assert.deepEqual(suggestFromPage(items, "mode"), ["pr", "mr"]);
  });

  it("campo desconocido o página inválida no sugiere nada", () => {
    assert.deepEqual(suggestFromPage(items, "verdict"), []);
    assert.deepEqual(suggestFromPage(null, "repository"), []);
  });
});
