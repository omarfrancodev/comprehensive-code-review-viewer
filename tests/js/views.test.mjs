import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  renderArchive,
  renderFindings,
  renderHistory,
  renderProfile,
  renderRunHeader,
  renderValidation,
} from "../../src/ccr_viewer/web/views.js";
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

// --- Cabecera, Resumen, Seguimiento y Archivo (Tarea 4) --------------------

const ID_LARGO = `CR-${"0123456789abcdef".repeat(4)}zzzz`;

/** Hijos con un `data-concepto` dado: cada concepto es su propio elemento. */
const concepto = (nodo, id) =>
  nodo.descendientes().find((n) => n.getAttribute("data-concepto") === id);

/** Texto del nodo sin el contenido de los `<details>`: lo «principal» de la vista. */
function textoSinDetalles(nodo) {
  const propio = nodo._textContent ?? "";
  return propio + nodo.children.map((h) => (h.tagName === "DETAILS" ? "" : textoSinDetalles(h))).join("");
}

const detalles = (nodo) => nodo.descendientes().filter((n) => n.tagName === "DETAILS");
const botonesPor = (nodo, texto) =>
  nodo.descendientes().filter((n) => n.tagName === "BUTTON" && n.textContent === texto);

describe("renderRunHeader", () => {
  const vista = (revisionExtra = {}, resumenExtra = {}, resto = {}) =>
    revision(
      {
        presentation: { kind: "review", subject: "Revisión sintética" },
        review_id: ID_LARGO,
        checks: [
          { id: "C001", status: "passed" },
          { id: "C002", status: "failed" },
        ],
        findings: [
          { id: "F001", status: "confirmed", priority: "P1" },
          { id: "F002", status: "unresolved", priority: "P2" },
        ],
        ...revisionExtra,
      },
      {
        summary: {
          key: "a".repeat(32),
          source_review_id: ID_LARGO,
          repository_label: "git.ejemplo.invalid/acme/demo",
          repository_identity: "git.ejemplo.invalid/acme/demo",
          scope_label: "pr 42",
          scope_reference: "42",
          ...resumenExtra,
        },
        ...resto,
      },
    );

  it("muestra título, repositorio, ID completo, referencia, cierre, veredicto y conteos con su alcance", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista());
    const texto = nodo.textoCompleto();
    assert.match(texto, /Revisión sintética/);
    assert.match(texto, /git\.ejemplo\.invalid\/acme\/demo/);
    assert.ok(texto.includes(ID_LARGO), "el ID de revisión se muestra completo");
    assert.match(texto, /Referencia/);
    assert.match(concepto(nodo, "cierre").textContent, /completa/);
    assert.match(concepto(nodo, "cierre").textContent, /complete/);
    assert.match(concepto(nodo, "veredicto").textContent, /approvable_with_reservations/);
    const hallazgos = concepto(nodo, "hallazgos").textContent;
    assert.match(hallazgos, /de esta revisión/, "los conteos de hallazgos declaran su alcance");
    assert.match(hallazgos, /Confirmados 1/);
    assert.match(hallazgos, /P1 1/);
    assert.match(hallazgos, /No resueltos 1/);
    const comprobaciones = concepto(nodo, "comprobaciones").textContent;
    assert.match(comprobaciones, /declaradas en esta revisión/);
    assert.match(comprobaciones, /Superadas 1/);
    assert.match(comprobaciones, /Fallidas 1/);
  });

  it("no crea una puntuación ni un porcentaje", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista());
    assert.doesNotMatch(nodo.textoCompleto(), /puntuaci[oó]n|score|%/i);
  });

  it("separa integridad, cierre, veredicto y checks en elementos propios", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista());
    const ids = ["integridad", "cierre", "veredicto", "comprobaciones"];
    const nodos = ids.map((id) => concepto(nodo, id));
    for (const [i, n] of nodos.entries()) assert.ok(n, `falta el concepto ${ids[i]}`);
    assert.equal(new Set(nodos).size, 4, "cuatro elementos distintos");
    for (const a of nodos) {
      for (const b of nodos) {
        if (a !== b) assert.ok(!a.descendientes().includes(b), "ningún concepto contiene a otro");
      }
    }
    // La integridad no afirma un resultado: se verifica bajo demanda en Archivo.
    assert.match(concepto(nodo, "integridad").textContent, /bajo demanda/);
    assert.doesNotMatch(concepto(nodo, "integridad").textContent, /verified|verificada\b/);
    assert.doesNotMatch(concepto(nodo, "veredicto").textContent, /complete|completa/);
  });

  it("el título cae al alcance declarado sin presentación y no inventa nada", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({ presentation: undefined }));
    const h2 = nodo.descendientes().find((n) => n.tagName === "H2");
    assert.equal(h2.textContent, "PR #42");
  });

  it("un ID de origen ausente queda como no identificado y no ofrece copiarlo", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({ review_id: undefined }, { source_review_id: null }));
    assert.match(nodo.textoCompleto(), /No identificado/);
    assert.equal(botonesPor(nodo, "Copiar ID").length, 0);
  });

  it("copiar ID entrega el valor completo y avisa en una región de estado", async () => {
    const copiados = [];
    const nodo = crearElemento();
    renderRunHeader(nodo, vista(), { onCopy: (texto) => copiados.push(texto) });
    const [boton] = botonesPor(nodo, "Copiar ID");
    assert.ok(boton, "hay un botón «Copiar ID»");
    await Promise.all(boton.dispatch("click"));
    assert.deepEqual(copiados, [ID_LARGO]);
    const estado = nodo.descendientes().find((n) => n.getAttribute("role") === "status");
    assert.match(estado.textContent, /copiado/i);
  });

  it("un portapapeles que falla no rompe la cabecera y deja el ID seleccionable", async () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista(), { onCopy: () => { throw new Error("denegado"); } });
    const [boton] = botonesPor(nodo, "Copiar ID");
    await Promise.all(boton.dispatch("click"));
    const estado = nodo.descendientes().find((n) => n.getAttribute("role") === "status");
    assert.match(estado.textContent, /No se pudo copiar/);
    assert.ok(nodo.textoCompleto().includes(ID_LARGO));
  });

  it("sin registro final no inventa conteos", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({}, {}, { review: null }));
    assert.match(concepto(nodo, "hallazgos").textContent, /No hay hallazgos declarados/);
    assert.match(concepto(nodo, "comprobaciones").textContent, /Sin comprobaciones declaradas/);
  });

  it("escribe los textos de la fuente como texto, no como marcado", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({ presentation: { kind: "review", subject: "<img src=x onerror=alert(1)>" } }));
    assert.ok(nodo.textoCompleto().includes("<img src=x onerror=alert(1)>"));
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "IMG").length, 0);
  });

  it("una vista ausente vacía la cabecera sin lanzar", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista());
    renderRunHeader(nodo, null);
    assert.equal(nodo.children.length, 0);
  });
});

describe("Resumen (renderProfile)", () => {
  it("conserva el asunto y el ID de origen como identidad, sin repetir el encabezado de la cabecera", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision());
    const texto = nodo.textoCompleto();
    assert.match(texto, /Revisión sintética/);
    assert.match(texto, /CR-1111111111111111aaaa/);
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "HEADER").length, 0);
  });

  it("separa Responsable y Autores del cambio en etiquetas propias", () => {
    const nodo = crearElemento();
    renderProfile(nodo, revision());
    assert.equal(nodo.conTexto("Responsable").length, 1);
    assert.equal(nodo.conTexto("Autores del cambio").length, 1);
  });

  it("muestra los campos desconocidos en un details sin reinterpretarlos", () => {
    const nodo = crearElemento();
    renderProfile(
      nodo,
      revision({
        campo_futuro: { estado: "desconocido" },
        coverage: { stale: false, adequate: true, flag_futuro: true, verification: "independent", areas: [] },
      }),
    );
    const originales = detalles(nodo).find((n) => /campo_futuro/.test(n.textContent));
    assert.ok(originales, "hay un details con el campo desconocido");
    assert.match(originales.textContent, /"estado": "desconocido"/);
    assert.match(originales.textContent, /coverage\.flag_futuro/);
    assert.match(originales.textContent, /true/);
    // El flag desconocido no activa ninguna marca ni aparece fuera del details.
    const principal = textoSinDetalles(nodo);
    assert.doesNotMatch(principal, /campo_futuro|flag_futuro/);
    assert.doesNotMatch(principal, /caduc/i);
  });

  it("no crea el details cuando no hay campos sin presentación propia", () => {
    const nodo = crearElemento();
    const sinExtras = revision();
    renderProfile(nodo, sinExtras);
    assert.equal(detalles(nodo).length, 0);
  });
});

describe("Seguimiento (renderHistory)", () => {
  const entrada = {
    status: "resolved",
    details: "Corregido en la corrida actual.",
    previous_review_id: "CR-0000000000000000bbbb",
    previous_reference: "archivo/anterior",
    previous_finding_id: "F001",
    previous_title: "Título previo sintético",
    previous_url: "https://ejemplo.invalid/mr/1",
    check_ids: ["C001", "C002"],
  };

  it("estructura una entrada con forma reconocida sin volcar su JSON", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [entrada] }), () => {});
    const texto = nodo.textoCompleto();
    for (const esperado of ["F001", "Título previo sintético", "CR-0000000000000000bbbb", "archivo/anterior", "C001", "C002", "Corregido en la corrida actual."]) {
      assert.ok(texto.includes(esperado), `falta ${esperado}`);
    }
    assert.match(texto, /Resuelto/);
    assert.match(texto, /resolved/);
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "PRE").length, 0);
    assert.equal(detalles(nodo).length, 0);
  });

  it("la URL anterior es texto inerte, nunca un enlace", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [entrada] }), () => {});
    assert.ok(nodo.textoCompleto().includes("https://ejemplo.invalid/mr/1"));
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "A").length, 0);
  });

  it("una entrada de forma desconocida conserva su JSON en un details secundario", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [{ campo_futuro: 1 }, "texto suelto", null, { status: 3, previous_finding_id: "F001" }] }), () => {});
    const todos = detalles(nodo);
    assert.equal(todos.length, 4, "una conservación por entrada no reconocida");
    assert.match(todos[0].textContent, /"campo_futuro": 1/);
    assert.match(todos[1].textContent, /"texto suelto"/);
    assert.match(todos[2].textContent, /null/);
    assert.match(todos[3].textContent, /"status": 3/);
    // Lo principal solo indica que la forma no se reconoce.
    assert.match(textoSinDetalles(nodo), /forma no reconocida/i);
  });

  it("un campo extra de una entrada reconocida se conserva aparte", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [{ ...entrada, id: "F009", campo_futuro: true }] }), () => {});
    const [extras, ...otros] = detalles(nodo);
    assert.equal(otros.length, 0);
    assert.match(extras.textContent, /"id": "F009"/);
    assert.match(extras.textContent, /campo_futuro/);
    assert.doesNotMatch(extras.textContent, /previous_finding_id/);
  });

  it("un estado desconocido conserva su valor original", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [{ ...entrada, status: "estado_futuro" }] }), () => {});
    assert.match(nodo.textoCompleto(), /estado_futuro/);
  });

  it("sin entradas declara ausencia, no una lista vacía", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: [] }), () => {});
    assert.match(nodo.textoCompleto(), /Sin entradas de re-review declaradas/);
    assert.doesNotMatch(nodo.textoCompleto(), /\[\]/);
  });

  it("un rereview que no es lista conserva su JSON", () => {
    const nodo = crearElemento();
    renderHistory(nodo, revision({ rereview: { status: "resolved" } }), () => {});
    assert.match(detalles(nodo)[0].textContent, /"status": "resolved"/);
  });

  it("conserva los aliases originales y las revisiones anteriores declaradas", () => {
    const nodo = crearElemento();
    renderHistory(
      nodo,
      revision({
        aliases: { F900: "F001" },
        previous_reviews: [{ review_id: "CR-0000000000000000bbbb", reference: "archivo/anterior", verified: true }],
      }),
      () => {},
    );
    const texto = nodo.textoCompleto();
    assert.match(texto, /F900/);
    assert.match(texto, /F001/);
    assert.match(texto, /CR-0000000000000000bbbb/);
    assert.match(texto, /archivo\/anterior/);
  });

  it("«Abrir revisión anterior» solo existe para vínculos resueltos de otra revisión", () => {
    const acciones = [];
    const otra = "b".repeat(32);
    const nodo = crearElemento();
    renderHistory(
      nodo,
      revision(
        {},
        {
          lineage: [
            { raw: "archivo/anterior", status: "resolved", run_key: otra, source: "rereview" },
            { raw: "archivo/ausente", status: "missing", run_key: null, source: "previous_reviews" },
            { raw: "https://ejemplo.invalid/x", status: "external", run_key: null, source: "rereview" },
            { raw: "../fuera", status: "outside_root", run_key: null, source: "previous_run" },
            { raw: "informe", status: "ambiguous", run_key: "a".repeat(32), candidates: ["a/informe", "b/informe"], source: "rereview" },
            { raw: "informe.md", status: "resolved", run_key: "a".repeat(32), source: "previous_run" },
          ],
        },
      ),
      (accion) => acciones.push(accion),
    );
    const botones = botonesPor(nodo, "Abrir revisión anterior");
    assert.equal(botones.length, 1, "solo el vínculo resuelto hacia otra revisión");
    botones[0].dispatch("click");
    assert.deepEqual(acciones, [{ type: "selectRun", key: otra }]);
    const texto = nodo.textoCompleto();
    for (const crudo of ["archivo/ausente", "https://ejemplo.invalid/x", "../fuera", "a/informe"]) {
      assert.ok(texto.includes(crudo), `se conserva ${crudo}`);
    }
  });
});

describe("Archivo (renderArchive)", () => {
  const vistaArchivo = (cierre = {}, resto = {}) =>
    revision({}, { closure: { schema_version: 5, state: "complete", cleanup: "not_needed", residuals: [], ...cierre }, ...resto });

  it("una lista de residuos vacía se expresa como ausencia, no como []", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo());
    const principal = textoSinDetalles(nodo);
    assert.match(principal, /Sin residuos declarados/);
    assert.doesNotMatch(principal, /\[\]/);
  });

  it("lista los residuos declarados tal como llegan", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo({ residuals: ["tmp/worktree-1", { path: "tmp/x" }] }));
    const principal = textoSinDetalles(nodo);
    assert.match(principal, /tmp\/worktree-1/);
    assert.match(principal, /"path": "tmp\/x"/);
    assert.doesNotMatch(principal, /Sin residuos declarados/);
  });

  it("muestra el cierre y la limpieza con estados legibles y el valor original", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo({ state: "processing", cleanup: "pending" }));
    const texto = textoSinDetalles(nodo);
    assert.match(texto, /en procesamiento/);
    assert.match(texto, /processing/);
    assert.match(texto, /pendiente/);
    assert.match(texto, /pending/);
  });

  it("un estado de cierre desconocido conserva el valor de la fuente", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo({ state: "future_state" }));
    assert.match(textoSinDetalles(nodo), /future_state/);
  });

  it("agrupa los diagnósticos por gravedad: error, aviso, informativo y desconocida", () => {
    const nodo = crearElemento();
    renderArchive(
      nodo,
      vistaArchivo(
        {},
        {
          diagnostics: [
            { code: "info.uno", severity: "info", message: "Informativo uno.", source: null },
            { code: "warn.uno", severity: "warning", message: "Aviso uno.", source: "review.json" },
            { code: "error.uno", severity: "error", message: "Error uno.", source: "cierre.json" },
            { code: "warn.dos", severity: "warning", message: "Aviso dos.", source: null },
            { code: "raro.uno", severity: "grave", message: "Gravedad original.", source: null },
          ],
        },
      ),
    );
    const grupos = nodo.descendientes().filter((n) => n.getAttribute("data-gravedad") !== null);
    assert.deepEqual(grupos.map((g) => g.getAttribute("data-gravedad")), ["error", "warning", "info", "grave"]);
    assert.match(grupos[0].textContent, /error\.uno/);
    assert.match(grupos[1].textContent, /warn\.uno/);
    assert.match(grupos[1].textContent, /warn\.dos/);
    assert.doesNotMatch(grupos[1].textContent, /error\.uno|info\.uno/);
    assert.match(grupos[3].textContent, /Gravedad original\./);
  });

  it("sin diagnósticos declara ausencia", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo());
    assert.match(textoSinDetalles(nodo), /Sin diagnósticos/);
  });

  it("conserva el JSON original en un details desplegable", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo());
    const [original] = detalles(nodo).filter((n) => /JSON original/.test(n.textContent));
    assert.ok(original);
    assert.match(original.textContent, /"schema_version": 7/);
    assert.match(original.textContent, /"residuals": \[\]/);
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "SUMMARY" && n.textContent === "JSON original").length, 1);
  });

  it("abrir la vista no verifica nada; la verificación es explícita y su resultado está en role=status", async () => {
    let llamadas = [];
    const validate = async (clave) => {
      llamadas.push(clave);
      return { status: "verified", checks: [{ name: "hashes", status: "passed", detail: "3 de 3" }], diagnostics: [] };
    };
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo(), { validate });
    assert.deepEqual(llamadas, [], "renderizar no ejecuta la verificación");
    const [boton] = botonesPor(nodo, "Verificar integridad");
    const region = nodo.descendientes().find((n) => n.getAttribute("role") === "status");
    assert.ok(boton && region);
    const antes = textoSinDetalles(nodo).replace(region.textContent, "");
    await Promise.all(boton.dispatch("click"));
    assert.deepEqual(llamadas, ["a".repeat(32)]);
    assert.match(region.textContent, /Integridad: verified/);
    assert.match(region.textContent, /hashes · passed · 3 de 3/);
    assert.match(region.textContent, /veredicto de la fuente/i);
    // Nada fuera de la región cambia: el veredicto y el cierre se conservan.
    assert.equal(textoSinDetalles(nodo).replace(region.textContent, ""), antes);
  });

  it("un fallo de verificación se explica en la región de estado y reactiva el botón", async () => {
    const validate = async () => { throw new Error("Lectura inestable."); };
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo(), { validate });
    const [boton] = botonesPor(nodo, "Verificar integridad");
    const region = nodo.descendientes().find((n) => n.getAttribute("role") === "status");
    await Promise.all(boton.dispatch("click"));
    assert.match(region.textContent, /Lectura inestable\./);
    assert.notEqual(boton.getAttribute("disabled"), "");
    assert.ok(!boton.disabled);
  });

  it("sin registro final conserva el cierre y declara la ausencia", () => {
    const nodo = crearElemento();
    renderArchive(nodo, vistaArchivo({}, { review: null }));
    assert.match(nodo.textoCompleto(), /"review": null/);
  });
});
