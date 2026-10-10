import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderFindings, renderProfile, renderValidation } from "../../src/ccr_viewer/web/views.js";
import { instalarDom } from "./dom-stub.mjs";

instalarDom();
const crearElemento = () => document.createElement("div");

const revision = (reviewOverrides = {}, viewOverrides = {}) => ({
  api_version: 1,
  compatibility: "supported",
  source_versions: { review: 7, closure: 5, trace: 1 },
  review: {
    schema_version: 7,
    review_id: "CR-1111111111111111aaaa",
    profile: "extended",
    presentation: { kind: "review", subject: "Revisión sintética" },
    scope: { mode: "pr", reference: "42", base: "main", head: "9f1c2b7" },
    verdict: "approvable_with_reservations",
    verdict_reason: "Hallazgo corregible.",
    reservations: ["El borde acepta valores fuera de rango."],
    responsible: { name: "Responsable sintética", username: "usuaria", verified: true },
    change_authors: [
      { name: "Autora sintética", username: null, verified: false, commits: ["9f1c2b7"] },
    ],
    coverage: {
      stale: true,
      adequate: false,
      verification: "same_session",
      limitations: { material: true, details: "Sin entorno real." },
      areas: [
        {
          area: "A",
          status: "partial",
          details: "Cobertura parcial",
          material: true,
          finding_ids: ["F001"],
        },
      ],
    },
    aliases: { F900: "F001" },
    checks: [],
    findings: [],
    ...reviewOverrides,
  },
  closure: { schema_version: 5, state: "complete", cleanup: "not_needed", residuals: [] },
  summary: {
    key: "a".repeat(32),
    source_review_id: "CR-1111111111111111aaaa",
    repository_label: "git.ejemplo.invalid/acme/demo",
  },
  lineage: [],
  files: [],
  diagnostics: [],
  ...viewOverrides,
});

describe("renderProfile", () => {
  it("muestra responsable y autores del cambio por separado", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision());
    const texto = nodo.textoCompleto();
    assert.match(texto, /Responsable/);
    assert.match(texto, /Autora sintética/);
    const etiquetas = [
      ...nodo.conTexto("Responsable"),
      ...nodo.conTexto("Autores del cambio"),
    ];
    assert.equal(etiquetas.length, 2, "cada rol tiene su propia etiqueta");
  });

  it("conserva el perfil original sin normalizarlo", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision({ profile: "economy", schema_version: 3 }));
    assert.match(nodo.textoCompleto(), /economy/);
    assert.doesNotMatch(nodo.textoCompleto(), /focused/);
  });

  it("no inventa un identificador de origen ausente", () => {
    const nodo = crearElemento();
    const sinIdentidad = revision({ review_id: undefined });
    renderProfile(nodo, sinIdentidad);
    assert.match(nodo.textoCompleto(), /No identificado/i);
  });

  it("muestra el veredicto de la fuente sin recalcularlo", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision());
    assert.match(nodo.textoCompleto(), /approvable_with_reservations/);
  });

  it("señala las marcas de caducidad y limitación", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision({}, { compatibility: "limited" }));
    const texto = nodo.textoCompleto();
    assert.match(texto, /caduc/i);
    assert.match(texto, /limitad/i);
  });

  it("presenta la cobertura ABCDE con su materialidad", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision());
    assert.match(nodo.textoCompleto(), /Cobertura parcial/);
  });
});

describe("renderFindings", () => {
  const conHallazgos = revision({
    findings: [
      {
        id: "F001",
        status: "confirmed",
        priority: "P1",
        blocking: false,
        title: "Validación ausente",
        location: { path: "src/demo.py", line: 42 },
        scenario: "Entrada fuera de rango.",
        impact: "Se propaga al lector interno.",
        correction: "Comparar antes de usar.",
        evidence: [{ kind: "static", details: "Flujo", check_id: null }],
      },
    ],
  });

  it("separa la prioridad en H3 y el título en H4", () => {
    const nodo = crearElemento();
    renderFindings(nodo, conHallazgos);
    const encabezados = nodo.descendientes().filter((n) => n.tagName.startsWith("H"));
    const h3 = encabezados.find((n) => n.tagName === "H3" && /F001/.test(n.textContent));
    const h4 = encabezados.find((n) => n.tagName === "H4" && /Validación ausente/.test(n.textContent));
    assert.ok(h3, "la prioridad y el ID van en un H3");
    assert.ok(h4, "el título va en un H4");
  });

  it("agrupa confirmados, no resueltos y descartados por separado", () => {
    const nodo = crearElemento();
    renderFindings(nodo, conHallazgos);
    const texto = nodo.textoCompleto();
    assert.match(texto, /Confirmados/);
    assert.match(texto, /No resueltos/);
    assert.match(texto, /Descartados/);
  });

  it("indica cuando no hay hallazgos registrados", () => {
    const nodo = crearElemento();
    renderFindings(nodo, revision());
    assert.match(nodo.textoCompleto(), /No hay hallazgos registrados/);
  });

  it("un registro ausente no inventa hallazgos", () => {
    const nodo = crearElemento();
    renderProfile(crearElemento(), revision());
    renderFindings(nodo, revision({}, { review: null }));
    assert.match(nodo.textoCompleto(), /No hay hallazgos registrados/);
  });
});

describe("renderValidation", () => {
  it("no presenta comprobaciones ausentes como un aprobado", () => {
    const nodo = crearElemento();
    renderValidation(nodo, revision());
    const texto = nodo.textoCompleto();
    assert.match(texto, /No hay comprobaciones registradas/);
    assert.doesNotMatch(texto, /todas las comprobaciones pasaron/i);
  });

  it("muestra id, estado, revisión y motivo de reutilización", () => {
    const nodo = crearElemento();
    renderValidation(
      nodo,
      revision({
        checks: [
          {
            id: "C001",
            status: "passed",
            revision: "9f1c2b7",
            evidence: "Suite: 3 pruebas, 0 fallos.",
            reused: true,
            reuse_reason: "Entradas idénticas a la ejecución anterior.",
            rerun_reason: null,
            failure_kind: null,
          },
        ],
      }),
    );
    const texto = nodo.textoCompleto();
    assert.match(texto, /C001/);
    assert.match(texto, /9f1c2b7/);
    assert.match(texto, /Entradas idénticas/);
  });

  it("distingue bloqueo y fallo con su clase", () => {
    const nodo = crearElemento();
    renderValidation(
      nodo,
      revision({
        checks: [
          {
            id: "C002",
            status: "failed",
            failure_kind: "environment",
            revision: "9f1c2b7",
            evidence: "Sin credenciales.",
            reused: false,
            reuse_reason: null,
            rerun_reason: null,
          },
        ],
      }),
    );
    const texto = nodo.textoCompleto();
    assert.match(texto, /fallida/i);
    assert.match(texto, /entorno/i);
  });
});