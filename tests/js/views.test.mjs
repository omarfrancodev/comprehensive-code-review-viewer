import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterFindings,
  renderArchive,
  renderDocuments,
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

  it("muestra el repositorio declarado, no la identidad normalizada solo para comparar", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({}, {
      repository_label: "https://git.ejemplo.invalid/acme/demo.git",
      repository_identity: "git.ejemplo.invalid/acme/demo",
    }));
    const repositorio = nodo.descendientes().find((n) => n.className === "encabezado-repositorio");
    assert.equal(repositorio.textContent, "Repositorio: https://git.ejemplo.invalid/acme/demo.git");
  });

  it("sin repositorio declarado recurre a la identidad", () => {
    const nodo = crearElemento();
    renderRunHeader(nodo, vista({}, { repository_label: null, repository_identity: "git.ejemplo.invalid/acme/demo" }));
    const repositorio = nodo.descendientes().find((n) => n.className === "encabezado-repositorio");
    assert.equal(repositorio.textContent, "Repositorio: git.ejemplo.invalid/acme/demo");
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

  it("muestra el repositorio declarado (con esquema y «.git»), no la identidad normalizada", () => {
    const nodo = crearElemento();
    const vista = revision();
    vista.summary = {
      ...vista.summary,
      repository_label: "https://git.ejemplo.invalid/acme/demo.git",
      repository_identity: "git.ejemplo.invalid/acme/demo",
    };
    renderProfile(nodo, vista);
    const fila = nodo.descendientes().find((n) => n.tagName === "DIV" && n.children[0]?.tagName === "DT" && n.children[0].textContent === "Repositorio");
    assert.ok(fila, "el Resumen tiene el campo Repositorio");
    assert.equal(fila.children[1].textContent, "https://git.ejemplo.invalid/acme/demo.git");
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

  it("verified de responsable y autores solo se traduce si es true o false", () => {
    const conVerified = (verified) => {
      const nodo = crearElemento();
      renderProfile(
        nodo,
        revision({
          responsible: { name: "Responsable sintética", username: "usuaria", verified },
          change_authors: [{ name: "Autora sintética", username: null, verified, commits: ["9f1c2b7"] }],
        }),
      );
      return nodo.textoCompleto();
    };
    assert.match(conVerified(true), /Cuenta verificada por la fuente\./);
    assert.match(conVerified(true), /· cuenta verificada/);
    assert.match(conVerified(false), /Identidad declarada, no verificada\./);
    assert.match(conVerified(false), /· identidad no verificada/);
    for (const verified of ["unknown", null, 0, "false", {}]) {
      const texto = conVerified(verified);
      const original = JSON.stringify(verified);
      assert.doesNotMatch(texto, /cuenta verificada|no verificada/i, `${original} no es una declaración de la fuente`);
      assert.equal(texto.match(/estado desconocido/g)?.length, 2, `${original}: responsable y autora en estado desconocido`);
      assert.ok(texto.includes(original), `${original} conserva su valor original`);
    }
    // Ausente: la fuente no declara nada; tampoco se le atribuye una negativa.
    const sinDato = crearElemento();
    renderProfile(sinDato, revision({ responsible: { name: "Responsable sintética" }, change_authors: [{ name: "Autora" }] }));
    assert.doesNotMatch(sinDato.textoCompleto(), /cuenta verificada|no verificada/i);
    assert.equal(sinDato.textoCompleto().match(/verificación no declarada/gi)?.length, 2);
  });

  it("stale, adequate y material solo activan sus marcas con un booleano declarado", () => {
    for (const valor of ["unknown", null, 0, "false", {}]) {
      const nodo = crearElemento();
      renderProfile(
        nodo,
        revision({
          coverage: {
            stale: valor,
            adequate: valor,
            verification: "same_session",
            areas: [{ area: "A", status: "partial", details: "Parcial", material: valor }],
          },
        }),
      );
      const texto = nodo.textoCompleto();
      const original = JSON.stringify(valor);
      assert.doesNotMatch(texto, /Revisión caducada|Cobertura insuficiente/, `${original} no activa marcas`);
      assert.doesNotMatch(texto, /(^|\s)material(\s|$)/, `${original} no marca el área como material`);
      assert.equal(texto.match(/estado desconocido/g)?.length, 3, `${original}: tres valores en estado desconocido`);
      assert.ok(texto.includes(original), `${original} conserva su valor original`);
    }
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

  it("un previous_finding_id mal formado se conserva y no se presenta como ausente", () => {
    const sinId = /sin ID declarado/;
    const numerico = crearElemento();
    renderHistory(numerico, revision({ rereview: [{ ...entrada, previous_finding_id: 7 }] }), () => {});
    const h3 = numerico.descendientes().find((n) => n.tagName === "H3");
    assert.equal(h3.textContent, "7");
    assert.doesNotMatch(numerico.textoCompleto(), sinId);

    const objetoId = crearElemento();
    renderHistory(objetoId, revision({ rereview: [{ ...entrada, previous_finding_id: { x: 1 } }] }), () => {});
    const textoObjeto = objetoId.textoCompleto();
    assert.match(textoObjeto, /"x": 1/);
    assert.match(textoObjeto, /ID del hallazgo anterior/);
    assert.doesNotMatch(textoObjeto, sinId);

    const booleano = crearElemento();
    renderHistory(booleano, revision({ rereview: [{ ...entrada, previous_finding_id: false }] }), () => {});
    assert.match(booleano.textoCompleto(), /false/);
    assert.doesNotMatch(booleano.textoCompleto(), sinId);
  });

  it("un previous_finding_id realmente ausente sí se declara sin ID", () => {
    for (const previous_finding_id of [undefined, null, ""]) {
      const nodo = crearElemento();
      renderHistory(nodo, revision({ rereview: [{ ...entrada, previous_finding_id }] }), () => {});
      assert.match(nodo.textoCompleto(), /sin ID declarado/);
    }
  });

  it("otros campos conocidos con un tipo inesperado no se pierden", () => {
    const nodo = crearElemento();
    renderHistory(
      nodo,
      revision({
        rereview: [{
          status: "new",
          previous_title: { idioma: "es" },
          previous_review_id: 12,
          previous_reference: ["a", "b"],
          previous_url: false,
          check_ids: "C001",
          details: { nota: "x" },
        }],
      }),
      () => {},
    );
    const texto = nodo.textoCompleto();
    for (const esperado of ['"idioma": "es"', "12", '"a"', "false", "C001", '"nota": "x"']) {
      assert.ok(texto.includes(esperado), `falta ${esperado}`);
    }
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

  it("verified de una revisión anterior solo se traduce si es true o false", () => {
    const conVerified = (verified) => {
      const nodo = crearElemento();
      renderHistory(
        nodo,
        revision({ previous_reviews: [{ review_id: "CR-0000000000000000bbbb", reference: "archivo/anterior", verified }] }),
        () => {},
      );
      return nodo;
    };
    assert.match(textoSinDetalles(conVerified(true)), /· verificada por la fuente/);
    assert.match(textoSinDetalles(conVerified(false)), /no verificada por la fuente/);
    for (const verified of ["unknown", null, 0, "false", {}]) {
      const nodo = conVerified(verified);
      const principal = textoSinDetalles(nodo);
      const original = JSON.stringify(verified);
      assert.doesNotMatch(principal, /verificada por la fuente/, `${original} no es una declaración de la fuente`);
      assert.match(principal, /estado desconocido/, `${original} se presenta como desconocido`);
      assert.ok(principal.includes(original), `${original} conserva su valor original`);
      const json = detalles(nodo).find((n) => /CR-0000000000000000bbbb/.test(n.textContent));
      assert.ok(json, `${original}: el JSON de la entrada queda accesible`);
      assert.match(json.textContent, /"verified"/);
    }
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

// --- Hallazgos, Validación y Documentos (Tarea 5) --------------------------

const porAtributo = (nodo, nombre, valor) =>
  nodo.descendientes().find((n) => n.getAttribute(nombre) === valor);
const conClase = (nodo, clase) =>
  nodo.descendientes().filter((n) => n.className.split(/\s+/).includes(clase));
const botones = (nodo) => nodo.descendientes().filter((n) => n.tagName === "BUTTON");
const filasHallazgo = (nodo) => conClase(nodo, "fila-hallazgo");
/** Fila de un hallazgo por su ID: la lista se ordena por grupos de estado. */
const filaDe = (nodo, id) => {
  const fila = filasHallazgo(nodo).find((f) => f.descendientes().some((n) => n.className === "fila-id" && n.textContent === id));
  assert.ok(fila, `no hay fila para ${id}`);
  return fila;
};
const filasComprobacion = (nodo) => conClase(nodo, "fila-comprobacion");
const detalle = (nodo) => nodo.descendientes().find((n) => n.getAttribute("data-detalle") !== null);
const conteo = (nodo) => nodo.descendientes().find((n) => n.getAttribute("data-conteo") !== null).textContent;
const elegir = (nodo, filtro, valor) => {
  const control = porAtributo(nodo, "data-filtro", filtro);
  assert.ok(control, `falta el filtro ${filtro}`);
  control.value = valor;
  control.dispatch(control.tagName === "INPUT" ? "input" : "change");
};
const sinAccion = () => {};

const HALLAZGOS = [
  {
    id: "F001", status: "confirmed", priority: "P1", blocking: false, title: "Validación ausente",
    location: { path: "src/demo/handler.py", line: 42 },
    scenario: "Entrada fuera de rango.", impact: "Se propaga al lector interno.", correction: "Comparar antes de usar.",
    evidence: [{ kind: "static", details: "Flujo estático", check_id: null }],
  },
  {
    id: "F002", status: "unresolved", priority: "P2", title: "Carrera en la caché",
    location: { path: "src/demo/cache.py", line: 7 },
    scenario: "Dos hilos escriben.", impact: "Lectura rota.", correction: "Bloquear la escritura.",
    evidence: [{ kind: "executed", details: "Reproducida.", check_id: "C001" }],
  },
  { id: "F003", status: "rejected", priority: "P9", title: "Estilo del módulo", location: { path: "src/demo/estilo.py" } },
  { id: "F004", status: "confirmed", priority: "P2", title: "Fuga de recurso", location: { path: "src/demo/io.py", section: "cierre" } },
];

describe("filterFindings", () => {
  it("sin filtros conserva todos los hallazgos y su orden", () => {
    assert.deepEqual(filterFindings(HALLAZGOS, {}).map((h) => h.id), ["F001", "F002", "F003", "F004"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { status: "", priority: "", text: "  " }).map((h) => h.id), ["F001", "F002", "F003", "F004"]);
  });

  it("filtra por estado original", () => {
    assert.deepEqual(filterFindings(HALLAZGOS, { status: "confirmed" }).map((h) => h.id), ["F001", "F004"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { status: "rejected" }).map((h) => h.id), ["F003"]);
  });

  it("filtra por prioridad y conserva una prioridad desconocida con su valor original", () => {
    assert.deepEqual(filterFindings(HALLAZGOS, { priority: "P2" }).map((h) => h.id), ["F002", "F004"]);
    const [desconocido, ...otros] = filterFindings(HALLAZGOS, { priority: "P9" });
    assert.equal(desconocido.id, "F003");
    assert.equal(desconocido.priority, "P9", "el valor no se normaliza");
    assert.equal(otros.length, 0);
  });

  it("filtra por texto sin distinguir mayúsculas en ID, título, ubicación y descripción", () => {
    assert.deepEqual(filterFindings(HALLAZGOS, { text: "CACHÉ" }).map((h) => h.id), ["F002"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { text: "f004" }).map((h) => h.id), ["F004"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { text: "src/demo/io" }).map((h) => h.id), ["F004"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { text: "hilos" }).map((h) => h.id), ["F002"]);
  });

  it("combina los criterios y no muta la lista", () => {
    const copia = structuredClone(HALLAZGOS);
    assert.deepEqual(filterFindings(HALLAZGOS, { status: "confirmed", priority: "P2", text: "fuga" }).map((h) => h.id), ["F004"]);
    assert.deepEqual(filterFindings(HALLAZGOS, { status: "rejected", priority: "P1" }), []);
    assert.deepEqual(HALLAZGOS, copia);
  });

  it("ignora entradas que no son objetos y valores de tipo inesperado sin lanzar", () => {
    const rara = [null, "texto", 7, { id: "F010", status: 3, priority: { x: 1 }, title: ["a"], location: "src" }, { id: "F011", status: "confirmed" }];
    assert.deepEqual(filterFindings(rara, {}).map((h) => h.id), ["F010", "F011"]);
    assert.deepEqual(filterFindings(rara, { status: "confirmed" }).map((h) => h.id), ["F011"]);
    assert.deepEqual(filterFindings(rara, { text: "F010" }).map((h) => h.id), ["F010"]);
    assert.deepEqual(filterFindings(undefined, { status: "confirmed" }), []);
  });
});

describe("Hallazgos: maestro-detalle", () => {
  const vista = (findings = HALLAZGOS, extra = {}) =>
    revision({
      findings,
      checks: [{ id: "C001", status: "passed", command: "pytest -q", revision: "9f1c2b7", evidence: "3 pruebas." }],
      aliases: { F900: "F001" },
      ...extra,
    });

  it("cada fila muestra ID, prioridad, estado original y ubicación", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    assert.equal(filasHallazgo(nodo).length, 4);
    const texto = filaDe(nodo, "F001").textContent;
    for (const esperado of ["F001", "P1", "confirmed", "src/demo/handler.py", "línea 42", "Validación ausente"]) {
      assert.ok(texto.includes(esperado), `la fila no muestra ${esperado}`);
    }
    assert.match(filaDe(nodo, "F004").textContent, /sección cierre/);
  });

  it("agrupa por estado con su recuento, incluidos los grupos vacíos", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    const grupos = conClase(nodo, "grupo-titulo").map((n) => n.textContent);
    assert.deepEqual(grupos, ["Confirmados (2)", "No resueltos (1)", "Descartados (1)"]);
    const sinConfirmados = crearElemento();
    renderFindings(sinConfirmados, vista(HALLAZGOS.filter((h) => h.status !== "confirmed")), sinAccion);
    assert.deepEqual(
      conClase(sinConfirmados, "grupo-titulo").map((n) => n.textContent),
      ["Confirmados (0)", "No resueltos (1)", "Descartados (1)"],
    );
    const raro = crearElemento();
    renderFindings(raro, vista([{ id: "F020", status: "estado_futuro", priority: "P1" }]), sinAccion);
    assert.ok(conClase(raro, "grupo-titulo").some((n) => n.textContent === "Otros estados (1)"));
  });

  it("el conteo respeta el filtro y declara el total", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    assert.match(conteo(nodo), /4 de 4/);
    elegir(nodo, "estado", "confirmed");
    assert.match(conteo(nodo), /2 de 4/);
    assert.equal(filasHallazgo(nodo).length, 2);
    elegir(nodo, "prioridad", "P2");
    assert.match(conteo(nodo), /1 de 4/);
    assert.equal(filasHallazgo(nodo).length, 1);
    assert.match(filasHallazgo(nodo)[0].textContent, /F004/);
    elegir(nodo, "texto", "inexistente");
    assert.match(conteo(nodo), /0 de 4/);
    assert.match(nodo.textoCompleto(), /Ningún hallazgo coincide/);
  });

  it("la prioridad desconocida se ofrece y se muestra con su valor original", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    const opciones = porAtributo(nodo, "data-filtro", "prioridad").children.map((o) => o.getAttribute("value"));
    assert.ok(opciones.includes("P9"), "P9 aparece entre las prioridades filtrables");
    elegir(nodo, "prioridad", "P9");
    assert.equal(filasHallazgo(nodo).length, 1);
    assert.match(filasHallazgo(nodo)[0].textContent, /P9/);
    filasHallazgo(nodo)[0].dispatch("click");
    assert.match(detalle(nodo).textContent, /P9/);
  });

  it("un estado desconocido no oculta el hallazgo y conserva su valor", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista([{ id: "F020", status: "estado_futuro", priority: "P1", title: "Raro" }]), sinAccion);
    assert.equal(filasHallazgo(nodo).length, 1);
    assert.match(filasHallazgo(nodo)[0].textContent, /estado_futuro/);
    elegir(nodo, "estado", "estado_futuro");
    assert.equal(filasHallazgo(nodo).length, 1);
  });

  it("seleccionar una fila abre su detalle con escenario, impacto, corrección y evidencia", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    assert.match(detalle(nodo).textContent, /F001/, "el primero queda seleccionado");
    filaDe(nodo, "F002").dispatch("click");
    const texto = detalle(nodo).textContent;
    for (const esperado of ["F002", "Carrera en la caché", "Dos hilos escriben.", "Lectura rota.", "Bloquear la escritura.", "Reproducida.", "unresolved"]) {
      assert.ok(texto.includes(esperado), `el detalle no muestra ${esperado}`);
    }
    assert.equal(filaDe(nodo, "F002").getAttribute("aria-pressed"), "true");
    assert.equal(filaDe(nodo, "F001").getAttribute("aria-pressed"), "false");
  });

  it("la referencia a una comprobación declarada navega a Validación; una ausente es texto", () => {
    const acciones = [];
    const nodo = crearElemento();
    renderFindings(nodo, vista(), (accion) => acciones.push(accion));
    filaDe(nodo, "F002").dispatch("click");
    const [ir] = botones(detalle(nodo)).filter((b) => /C001/.test(b.textContent));
    assert.ok(ir, "hay un botón hacia C001");
    ir.dispatch("click");
    assert.deepEqual(acciones.at(-1), { type: "openTarget", tab: "validacion", id: "C001" });

    const huerfana = crearElemento();
    renderFindings(huerfana, vista([{ id: "F030", status: "confirmed", priority: "P1", evidence: [{ kind: "executed", details: "x", check_id: "C404" }] }]), sinAccion);
    assert.ok(detalle(huerfana).textContent.includes("C404"));
    assert.equal(botones(detalle(huerfana)).filter((b) => /C404/.test(b.textContent)).length, 0);
    assert.match(detalle(huerfana).textContent, /no declarada/i);
  });

  it("consume el destino: selecciona el hallazgo, lo resalta y limpia el destino", () => {
    const acciones = [];
    const nodo = crearElemento();
    renderFindings(nodo, vista(), (accion) => acciones.push(accion), { target: { tab: "hallazgos", id: "F004" } });
    assert.match(detalle(nodo).textContent, /F004/);
    assert.equal(detalle(nodo).getAttribute("data-resaltado"), "true");
    assert.deepEqual(acciones, [{ type: "clearTarget" }]);
  });

  it("un destino que no existe avisa sin cambiar la selección", () => {
    const acciones = [];
    const nodo = crearElemento();
    renderFindings(nodo, vista(), (accion) => acciones.push(accion), { target: { tab: "hallazgos", id: "F999" } });
    assert.match(nodo.textoCompleto(), /F999/);
    assert.match(detalle(nodo).textContent, /F001/);
    assert.deepEqual(acciones, [{ type: "clearTarget" }]);
  });

  it("escribe títulos, ubicaciones y evidencia hostiles como texto", () => {
    const nodo = crearElemento();
    renderFindings(
      nodo,
      vista([{
        id: "F<b>1", status: "confirmed", priority: "P1",
        title: "<img src=x onerror=alert(1)>",
        location: { path: "../../etc/passwd", url: "javascript:alert(1)" },
        scenario: "<script>window.__pwned = true</script>",
        evidence: [{ kind: "static", details: "<iframe src=//x></iframe>", check_id: null }],
      }]),
      sinAccion,
    );
    const texto = nodo.textoCompleto();
    for (const literal of ["<img src=x onerror=alert(1)>", "../../etc/passwd", "javascript:alert(1)", "<script>window.__pwned = true</script>", "<iframe src=//x></iframe>"]) {
      assert.ok(texto.includes(literal), `falta el literal ${literal}`);
    }
    const prohibidos = nodo.descendientes().filter((n) => ["IMG", "SCRIPT", "IFRAME", "A"].includes(n.tagName));
    assert.equal(prohibidos.length, 0);
  });

  it("tolera hallazgos y evidencias mal formados y conserva los campos desconocidos", () => {
    const nodo = crearElemento();
    renderFindings(
      nodo,
      vista([null, "texto", { id: "F040", status: "confirmed", priority: "P1", evidence: [null, "cadena", { kind: 3 }], campo_futuro: { a: 1 } }]),
      sinAccion,
    );
    assert.equal(filasHallazgo(nodo).length, 1);
    const original = detalles(nodo).find((n) => /campo_futuro/.test(n.textContent));
    assert.ok(original, "un details conserva el campo desconocido");
    assert.match(original.textContent, /"a": 1/);
    assert.doesNotMatch(textoSinDetalles(nodo), /campo_futuro/);
  });

  it("una prioridad ausente no se inventa", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista([{ id: "F050", status: "confirmed", title: "Sin prioridad" }]), sinAccion);
    assert.match(filasHallazgo(nodo)[0].textContent, /Sin prioridad declarada/);
    assert.doesNotMatch(filasHallazgo(nodo)[0].textContent, /P[0-3]/);
  });

  it("conserva filtros y selección al redibujar la misma revisión con su memoria", () => {
    const memoria = {};
    const primero = crearElemento();
    renderFindings(primero, vista(), sinAccion, { memoria });
    elegir(primero, "estado", "confirmed");
    filaDe(primero, "F004").dispatch("click");

    const segundo = crearElemento();
    renderFindings(segundo, vista(), sinAccion, { memoria });
    assert.match(conteo(segundo), /2 de 4/);
    assert.equal(porAtributo(segundo, "data-filtro", "estado").value, "confirmed");
    assert.match(detalle(segundo).textContent, /F004/);

    // Otra revisión (memoria nueva) empieza sin filtros y con el primer hallazgo.
    const otra = crearElemento();
    renderFindings(otra, vista(), sinAccion, { memoria: {} });
    assert.match(conteo(otra), /4 de 4/);
    assert.match(detalle(otra).textContent, /F001/);
  });

  it("si el hallazgo recordado ya no existe, vuelve al primero sin lanzar", () => {
    const memoria = { hallazgos: { id: "F777", filtros: { status: "estado_que_ya_no_existe", priority: "", text: "" } } };
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion, { memoria });
    assert.match(detalle(nodo).textContent, /F001/);
    assert.match(nodo.textoCompleto(), /Ningún hallazgo coincide|Mostrando/);
  });

  it("lista aliases y áreas de cobertura que citan el hallazgo", () => {
    const nodo = crearElemento();
    renderFindings(nodo, vista(), sinAccion);
    const texto = detalle(nodo).textContent;
    assert.match(texto, /F900/, "alias declarado hacia F001");
    assert.match(texto, /Área A/, "área de cobertura que lo cita");
  });
});

describe("Validación: lista y detalle", () => {
  const CHECKS = [
    { id: "C001", status: "passed", command: "python -m unittest", revision: "9f1c2b7", evidence: "3 pruebas, 0 fallos.", reused: false },
    { id: "C002", status: "failed", failure_kind: "environment", command: "<script>alert(1)</script>", revision: "9f1c2b7", evidence: "", reused: false },
    { id: "C003", status: "not_run", command: "npm test", reused: false },
  ];
  const vista = (checks = CHECKS, findings = HALLAZGOS) => revision({ checks, findings });

  it("el comando se escribe como texto inerte", () => {
    const nodo = crearElemento();
    renderValidation(nodo, vista(), sinAccion, { target: { tab: "validacion", id: "C002" } });
    assert.ok(nodo.textoCompleto().includes("<script>alert(1)</script>"));
    assert.equal(nodo.descendientes().filter((n) => n.tagName === "SCRIPT").length, 0);
  });

  it("un check sin salida muestra «Sin salida registrada»", () => {
    const nodo = crearElemento();
    renderValidation(nodo, vista(), sinAccion, { target: { tab: "validacion", id: "C002" } });
    assert.match(detalle(nodo).textContent, /Sin salida registrada/);
    const otro = crearElemento();
    renderValidation(otro, vista(), sinAccion);
    assert.doesNotMatch(detalle(otro).textContent, /Sin salida registrada/, "C001 sí declara salida");
    assert.match(detalle(otro).textContent, /3 pruebas, 0 fallos\./);
  });

  it("cada fila muestra ID, estado original y revisión", () => {
    const nodo = crearElemento();
    renderValidation(nodo, vista(), sinAccion);
    const filas = filasComprobacion(nodo);
    assert.equal(filas.length, 3);
    assert.match(filas[0].textContent, /C001/);
    assert.match(filas[0].textContent, /passed/);
    assert.match(filas[1].textContent, /failed/);
    assert.match(filas[1].textContent, /9f1c2b7/);
  });

  it("consume el destino: selecciona y resalta el check y limpia el destino", () => {
    const acciones = [];
    const nodo = crearElemento();
    renderValidation(nodo, vista(), (a) => acciones.push(a), { target: { tab: "validacion", id: "C003" } });
    assert.match(detalle(nodo).textContent, /C003/);
    assert.equal(detalle(nodo).getAttribute("data-resaltado"), "true");
    assert.deepEqual(acciones, [{ type: "clearTarget" }]);
  });

  it("el check lista los hallazgos que lo citan y navega a ellos", () => {
    const acciones = [];
    const nodo = crearElemento();
    renderValidation(nodo, vista(), (a) => acciones.push(a));
    // C001 es citado por F002 (evidence[].check_id).
    const [abrir] = botones(detalle(nodo)).filter((b) => /F002/.test(b.textContent));
    assert.ok(abrir, "hay un botón hacia F002");
    abrir.dispatch("click");
    assert.deepEqual(acciones, [{ type: "openTarget", tab: "hallazgos", id: "F002" }]);
    // Un check que nadie cita lo declara.
    filasComprobacion(nodo)[2].dispatch("click");
    assert.match(detalle(nodo).textContent, /Ningún hallazgo cita esta comprobación/);
  });

  it("no ofrece ejecutar ni reejecutar comprobaciones", () => {
    const nodo = crearElemento();
    renderValidation(nodo, vista(), sinAccion);
    for (const fila of filasComprobacion(nodo)) fila.dispatch("click");
    // Las filas solo seleccionan; ningún otro botón puede ejecutar nada.
    const acciones = botones(nodo)
      .filter((b) => !b.className.split(/\s+/).includes("fila-comprobacion"))
      .map((b) => b.textContent)
      .join(" | ");
    assert.doesNotMatch(acciones, /ejecut|run|iniciar|lanzar/i);
  });

  it("conserva el estado original, la reutilización y los campos desconocidos", () => {
    const nodo = crearElemento();
    renderValidation(
      nodo,
      vista([{ id: "C010", status: "estado_futuro", reused: true, reuse_reason: "Entradas idénticas.", revision: "abc", command: "x", evidence: "ok", campo_futuro: 1 }]),
      sinAccion,
    );
    const texto = nodo.textoCompleto();
    assert.match(texto, /estado_futuro/);
    assert.match(texto, /Entradas idénticas\./);
    assert.match(texto, /campo_futuro/);
  });

  it("conserva la comprobación elegida al redibujar con la misma memoria", () => {
    const memoria = {};
    const primero = crearElemento();
    renderValidation(primero, vista(), sinAccion, { memoria });
    filasComprobacion(primero)[2].dispatch("click");
    const segundo = crearElemento();
    renderValidation(segundo, vista(), sinAccion, { memoria });
    assert.match(detalle(segundo).textContent, /C003/);
    const otra = crearElemento();
    renderValidation(otra, vista(), sinAccion, { memoria: {} });
    assert.match(detalle(otra).textContent, /C001/);
  });

  it("tolera checks mal formados", () => {
    const nodo = crearElemento();
    renderValidation(nodo, vista([null, "texto", { id: "C020", status: "passed", command: { a: 1 } }]), sinAccion);
    assert.equal(filasComprobacion(nodo).length, 1);
    assert.match(detalle(nodo).textContent, /"a": 1/);
  });
});

describe("Documentos: informe ausente, inventario vacío y lectura fallida", () => {
  const vistaDocs = () => revision();
  const ARCHIVO = { key: "2".repeat(32), name: "notes.json", relative_path: "evidence/notes.json", media_kind: "json", bytes: 5000, available: true };
  const apiCon = (archivos, preview = async () => ({ text: "{}", media_kind: "json", truncated: false, total_bytes: 2 })) => ({
    getFiles: async () => archivos,
    getPreview: preview,
  });

  it("tres situaciones producen tres mensajes distintos", async () => {
    const sinInforme = crearElemento();
    await renderDocuments(sinInforme, vistaDocs(), apiCon([ARCHIVO]));
    const vacio = crearElemento();
    await renderDocuments(vacio, vistaDocs(), apiCon([]));
    const fallida = crearElemento();
    await renderDocuments(fallida, vistaDocs(), { getFiles: async () => { throw new Error("lectura rota"); }, getPreview: async () => ({}) });

    const a = sinInforme.textoCompleto();
    const b = vacio.textoCompleto();
    const c = fallida.textoCompleto();
    assert.match(a, /no conserva un informe Markdown/);
    assert.match(b, /inventario está vacío/);
    assert.match(c, /No se pudo leer el inventario: lectura rota/);
    // Cada mensaje es exclusivo de su situación.
    assert.doesNotMatch(a, /inventario está vacío|No se pudo leer/);
    assert.doesNotMatch(b, /no conserva un informe Markdown|No se pudo leer/);
    assert.doesNotMatch(c, /no conserva un informe Markdown|inventario está vacío/);
  });

  it("con informe ausente el inventario sigue seleccionable", async () => {
    const nodo = crearElemento();
    await renderDocuments(nodo, vistaDocs(), apiCon([ARCHIVO]));
    const filas = conClase(nodo, "fila-archivo");
    assert.equal(filas.length, 1);
    assert.match(filas[0].textContent, /evidence\/notes\.json/);
    assert.match(filas[0].textContent, /json/);
  });

  it("la lectura fallida ofrece «Reintentar» y se recupera", async () => {
    let intentos = 0;
    const api = {
      getFiles: async () => {
        intentos += 1;
        if (intentos === 1) throw new Error("lectura rota");
        return [ARCHIVO];
      },
      getPreview: async () => ({ text: "{}", media_kind: "json", truncated: false, total_bytes: 2 }),
    };
    const nodo = crearElemento();
    await renderDocuments(nodo, vistaDocs(), api);
    const [reintentar] = botones(nodo).filter((b) => b.textContent === "Reintentar");
    assert.ok(reintentar);
    await Promise.all(reintentar.dispatch("click"));
    assert.equal(intentos, 2);
    assert.equal(conClase(nodo, "fila-archivo").length, 1);
    assert.doesNotMatch(nodo.textoCompleto(), /No se pudo leer el inventario/);
  });

  it("la vista previa muestra ruta, formato y aviso de truncamiento", async () => {
    const nodo = crearElemento();
    await renderDocuments(nodo, vistaDocs(), apiCon([ARCHIVO], async () => ({ text: "{\"a\": 1}", media_kind: "json", truncated: true, total_bytes: 5000 })));
    await Promise.all(conClase(nodo, "fila-archivo")[0].dispatch("click"));
    const vistaPrevia = porAtributo(nodo, "data-vista-previa", "true");
    assert.ok(vistaPrevia);
    const texto = vistaPrevia.textContent;
    assert.match(texto, /evidence\/notes\.json/);
    assert.match(texto, /json/);
    assert.match(texto, /truncada/i);
    assert.match(texto, /5000 bytes/);
    assert.match(texto, /"a": 1/);
    assert.equal(conClase(nodo, "fila-archivo").length, 1, "el inventario se conserva");
  });

  it("un fallo de la vista previa conserva el inventario y ofrece «Reintentar»", async () => {
    let fallar = true;
    const otro = { ...ARCHIVO, key: "3".repeat(32), name: "otro.txt", relative_path: "otro.txt", media_kind: "text" };
    const nodo = crearElemento();
    await renderDocuments(nodo, vistaDocs(), apiCon([ARCHIVO, otro], async () => {
      if (fallar) throw new Error("archivo ilegible");
      return { text: "contenido", media_kind: "text", truncated: false, total_bytes: 9 };
    }));
    await Promise.all(conClase(nodo, "fila-archivo")[1].dispatch("click"));
    assert.match(nodo.textoCompleto(), /No se pudo leer: archivo ilegible/);
    assert.equal(conClase(nodo, "fila-archivo").length, 2);
    assert.equal(conClase(nodo, "fila-archivo")[1].getAttribute("aria-pressed"), "true");
    fallar = false;
    const [reintentar] = botones(nodo).filter((b) => b.textContent === "Reintentar");
    await Promise.all(reintentar.dispatch("click"));
    assert.match(nodo.textoCompleto(), /contenido/);
    assert.doesNotMatch(nodo.textoCompleto(), /archivo ilegible/);
  });

  it("restaura el archivo elegido al redibujar con la misma memoria", async () => {
    const otro = { ...ARCHIVO, key: "3".repeat(32), name: "otro.txt", relative_path: "otro.txt", media_kind: "text", bytes: 9 };
    const pedidos = [];
    const api = apiCon([ARCHIVO, otro], async (_run, clave) => {
      pedidos.push(clave);
      return { text: clave === otro.key ? "texto de otro" : "{}", media_kind: "text", truncated: false, total_bytes: 9 };
    });
    const memoria = {};
    const primero = crearElemento();
    await renderDocuments(primero, vistaDocs(), api, { memoria });
    await Promise.all(conClase(primero, "fila-archivo")[1].dispatch("click"));
    const segundo = crearElemento();
    await renderDocuments(segundo, vistaDocs(), api, { memoria });
    assert.match(segundo.textoCompleto(), /texto de otro/);
    assert.equal(conClase(segundo, "fila-archivo")[1].getAttribute("aria-pressed"), "true");
    assert.equal(pedidos.at(-1), otro.key);
  });

  it("los nombres y rutas hostiles se muestran como texto", async () => {
    const hostil = { key: "4".repeat(32), name: "<img src=x>.txt", relative_path: "<script>x</script>/../a.txt", media_kind: "text", bytes: 1, available: true };
    const nodo = crearElemento();
    await renderDocuments(nodo, vistaDocs(), apiCon([hostil]));
    assert.ok(nodo.textoCompleto().includes("<script>x</script>/../a.txt"));
    assert.equal(nodo.descendientes().filter((n) => ["IMG", "SCRIPT"].includes(n.tagName)).length, 0);
  });
});
