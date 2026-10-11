import { expect, test } from "@playwright/test";

import { REVISION_SINTETICA, TRAZA_SINTETICA, openFixture } from "./support.mjs";

/**
 * Inspector, relaciones y evidencia (§6.3, §9, §11; RF-01). Todo con datos
 * sintéticos: una segunda revisión (`bbbb…`) se sirve solo para la navegación
 * entre corridas.
 */

const RUN_A = REVISION_SINTETICA.summary.key;
const RUN_B = "b".repeat(32);
const CR_B = "CR-2222222222222222bbbb";
const CLAVE_NOTAS = "2".repeat(32);

const responder = (datos) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ api_version: 1, data: datos, diagnostics: [] }),
});

/** Traza base con autoridad, evidencia, campos desconocidos y relaciones de todos los tipos. */
function trazaBase() {
  const traza = structuredClone(TRAZA_SINTETICA);
  const [e1, e2, e3] = traza.events;
  e1.evidence = [];
  e2.evidence = [];
  e3.authority = { kind: "coordinator", scope: "checks" };
  e3.evidence = ["evidence/notes.json"];
  e3.campo_futuro = { anidado: [1, 2], nota: "dato desconocido conservado" };
  traza.relations = [
    { event_id: "E000002", relation: "follows", raw: "E000001", target: "E000001", status: "resolved", run_key: RUN_A, file_key: null },
    { event_id: "E000003", relation: "depends_on", raw: "E000009", target: "E000009", status: "dangling", run_key: RUN_A, file_key: null },
    { event_id: "E000003", relation: "supports", raw: `${CR_B}#E000001`, target: `${CR_B}#E000001`, status: "resolved", run_key: RUN_B, file_key: null },
    { event_id: "E000003", relation: "reuses", raw: "CR-3333333333333333cccc#E000004", target: "CR-3333333333333333cccc#E000004", status: "ambiguous", run_key: null, file_key: null },
    { event_id: "E000003", relation: "verifies", raw: "F001", target: "F001", status: "resolved", run_key: RUN_A, file_key: null },
    { event_id: "E000003", relation: "verifies", raw: "C001", target: "C001", status: "resolved", run_key: RUN_A, file_key: null },
  ];
  return traza;
}

const TRAZA_B = {
  events: [
    {
      event_id: "E000001",
      sequence: 1,
      kind: "prepare",
      status: "completed",
      summary: "Hito de la revisión de destino",
      occurred_at: null,
      recorded_at: "2026-08-01T10:00:00+00:00",
      temporal_basis: "recording_fallback",
      temporal_at: "2026-08-01T10:00:00+00:00",
      provenance: { kind: "helper", source: null },
      recorder: { kind: "helper", name: "review_artifacts", provider_id: null },
      actor: { kind: "helper", name: "review_artifacts", provider_id: null },
      executor: null,
      evidence: [],
    },
    {
      event_id: "E000002",
      sequence: 2,
      kind: "discovery",
      status: "completed",
      summary: "Último hito de la revisión de destino",
      occurred_at: null,
      recorded_at: "2026-08-01T10:00:05+00:00",
      temporal_basis: "recording_fallback",
      temporal_at: "2026-08-01T10:00:05+00:00",
      provenance: { kind: "helper", source: null },
      recorder: { kind: "helper", name: "review_artifacts", provider_id: null },
      actor: { kind: "helper", name: "review_artifacts", provider_id: null },
      executor: null,
      evidence: [],
    },
  ],
  valid_prefix_length: 2,
  chain_status: "verified",
  temporal_order: ["E000001", "E000002"],
  relations: [],
  diagnostics: [],
};

const VISTA_B = (() => {
  const vista = structuredClone(REVISION_SINTETICA);
  vista.summary.key = RUN_B;
  vista.summary.source_review_id = CR_B;
  vista.summary.scope_label = "pr 77";
  vista.review.review_id = CR_B;
  return vista;
})();

/**
 * Abre la revisión A en Trazabilidad con `traza`; la revisión B se sirve
 * aparte. `peticiones` acumula las URL de la API pedidas por la página.
 */
async function abrirTraza(page, traza = trazaBase(), { inventario = null } = {}) {
  const peticiones = [];
  page.on("request", (peticion) => {
    if (peticion.url().includes("/api/")) peticiones.push(peticion.url());
  });
  await page.route("**/api/runs/*/trace", (ruta) =>
    ruta.fulfill(responder(ruta.request().url().includes(RUN_B) ? TRAZA_B : (typeof traza === "function" ? traza() : traza))),
  );
  await openFixture(page);
  // Rutas propias tras las del soporte: Playwright prioriza la última registrada.
  await page.route(`**/api/runs/${RUN_B}`, (ruta) => ruta.fulfill(responder(VISTA_B)));
  if (inventario) await page.route("**/api/runs/*/files", inventario);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();
  return peticiones;
}

const inspector = (page) => page.locator('#inspector [data-part="inspector"]');
const tarjetaActual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');
const campo = (page, nombre) => inspector(page).locator(`[data-campo="${nombre}"]`);
const relaciones = (page) => inspector(page).locator('details[data-part="relations"]');
const evidencia = (page) => inspector(page).locator('details[data-part="evidence"]');

async function seleccionar(page, id) {
  await page.locator(`[data-part="timeline"] button[data-event-id="${id}"]`).click();
  await expect(inspector(page)).toHaveAttribute("data-event-id", id);
}

async function abrirRelaciones(page) {
  await relaciones(page).locator("summary").click();
  await expect(relaciones(page)).toHaveAttribute("open", "");
}

test.describe("inspector del hito", () => {
  test("muestra ID, secuencia, tipo, estado, resumen, identidades diferenciadas, procedencia, autoridad y tiempo", async ({ page }) => {
    await abrirTraza(page);
    await expect(inspector(page).locator("h2")).toHaveText("E000003");
    await expect(campo(page, "secuencia")).toContainText("3");
    await expect(campo(page, "tipo")).toContainText("check");
    await expect(campo(page, "estado")).toContainText("passed");
    await expect(inspector(page)).toContainText("Comprobación sintética superada");
    // Actor, registrador y ejecutor son filas distintas con su propia identidad.
    await expect(campo(page, "actor")).toContainText("Actor");
    await expect(campo(page, "actor")).toContainText("coordinator");
    await expect(campo(page, "actor")).not.toContainText("review_artifacts");
    await expect(campo(page, "registrador")).toContainText("Registrador");
    await expect(campo(page, "registrador")).toContainText("review_artifacts");
    await expect(campo(page, "ejecutor")).toContainText("Ejecutor");
    await expect(campo(page, "ejecutor")).toContainText("ejecutor-1");
    await expect(campo(page, "procedencia")).toContainText("tool");
    await expect(campo(page, "procedencia")).toContainText("review_runner:evidence/run.json");
    await expect(campo(page, "autoridad")).toContainText("coordinator");
    await expect(campo(page, "autoridad")).toContainText("checks");

    // Base temporal, hora local, UTC y original visibles sin depender de `title`.
    const tiempo = inspector(page).locator('[data-part="inspector-time"]');
    await expect(tiempo.locator('[data-tiempo="base"]')).toContainText("ocurrencia observada");
    await expect(tiempo.locator('[data-tiempo="local"]')).toBeVisible();
    await expect(tiempo.locator('[data-tiempo="local"]')).not.toBeEmpty();
    await expect(tiempo.locator('[data-tiempo="utc"]')).toBeVisible();
    await expect(tiempo.locator('[data-tiempo="utc"]')).toContainText("2026-09-01T11:00:00.000Z");
    await expect(tiempo.locator('[data-tiempo="original"]')).toBeVisible();
    await expect(tiempo.locator('[data-tiempo="original"]')).toContainText("2026-09-01T11:00:00+00:00");
    await expect(tiempo.locator('[data-tiempo="registro"]')).toContainText("2026-09-01T12:00:12+00:00");
  });

  test("el JSON original está en un <details> y conserva los campos desconocidos", async ({ page }) => {
    await abrirTraza(page);
    const json = inspector(page).locator('details[data-part="original-json"]');
    await expect(json).toHaveCount(1);
    await expect(json).not.toHaveAttribute("open", "");
    await json.locator("summary").click();
    const pre = json.locator("pre");
    await expect(pre).toBeVisible();
    await expect(pre).toContainText("campo_futuro");
    await expect(pre).toContainText("dato desconocido conservado");
    const texto = await pre.textContent();
    expect(JSON.parse(texto)).toEqual(trazaBase().events[2]);
  });

  test("copiar usa el valor completo", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "permisos de portapapeles solo en Chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const traza = trazaBase();
    const largo = `${"Resumen extenso del hito sintético. ".repeat(50)}Fin.`;
    traza.events[2].summary = largo;
    await abrirTraza(page, traza);
    await inspector(page).getByRole("button", { name: "Copiar resumen", exact: true }).click();
    await expect(inspector(page).locator('[data-part="copy-status"]')).toContainText("copiado");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(largo);
    await inspector(page).getByRole("button", { name: "Copiar JSON", exact: true }).click();
    // El portapapeles del sistema puede convertir los saltos de línea (CRLF en Windows).
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText().then((t) => t.replace(/\r\n/g, "\n"))))
      .toBe(JSON.stringify(traza.events[2], null, 2));
    await inspector(page).getByRole("button", { name: "Copiar ID", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("E000003");
  });

  test("si el portapapeles rechaza, se avisa sin lanzar", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denegado")) },
      });
    });
    const errores = [];
    page.on("pageerror", (error) => errores.push(error.message));
    await abrirTraza(page);
    await inspector(page).getByRole("button", { name: "Copiar resumen", exact: true }).click();
    await expect(inspector(page).locator('[data-part="copy-status"]')).toContainText("No se pudo copiar");
    await expect(inspector(page)).toContainText("Comprobación sintética superada");
    expect(errores).toEqual([]);
  });

  test("el inspector transiciona 160–180 ms en el nodo que cambia con la selección", async ({ page }) => {
    await abrirTraza(page);
    const resultado = await page.evaluate(() => {
      document.querySelector('[data-part="timeline"] button[data-event-id="E000001"]').click();
      const cuerpo = document.querySelector('#inspector [data-part="inspector-body"]');
      const estilo = getComputedStyle(cuerpo);
      return {
        duracion: estilo.transitionDuration,
        transiciones: cuerpo.getAnimations().filter((a) => a.constructor.name === "CSSTransition").length,
      };
    });
    const segundos = Number.parseFloat(resultado.duracion.split(",")[0]);
    expect(segundos).toBeGreaterThanOrEqual(0.16);
    expect(segundos).toBeLessThanOrEqual(0.18);
    expect(resultado.transiciones).toBeGreaterThan(0);
  });

  test("el orden temporal declarado es un dato en un detalle, no una lista paralela", async ({ page }) => {
    await abrirTraza(page);
    const orden = page.locator('#inspector details[data-part="temporal-order"]');
    await expect(orden).toHaveCount(1);
    await expect(orden.locator("summary")).toHaveText(/Orden temporal declarado por la fuente/);
    await expect(orden).not.toHaveAttribute("open", "");
    await orden.locator("summary").click();
    await expect(orden).toContainText("E000003 → E000002 → E000001");
    await expect(page.locator(".orden-temporal")).toHaveCount(0);
    await expect(page.locator("#inspector li").filter({ hasText: /^\s*E\d{6}\s*$/ })).toHaveCount(0);
  });
});

test.describe("relaciones", () => {
  test("sección expandible «Relaciones» con origen, destinos y tipo de vínculo", async ({ page }) => {
    await abrirTraza(page);
    await expect(relaciones(page)).toHaveCount(1);
    await expect(relaciones(page).locator("summary")).toHaveText(/Relaciones \(5\)/);
    await expect(relaciones(page)).not.toHaveAttribute("open", "");
    await abrirRelaciones(page);
    await expect(relaciones(page).locator('[data-part="relations-origin"]')).toContainText("E000003");
    const destinos = relaciones(page).locator('li[data-relation-direction="outgoing"]');
    await expect(destinos).toHaveCount(5);
    await expect(destinos.nth(0)).toContainText("depends_on");
    await expect(destinos.nth(0)).toContainText("E000009");
    // La relación entrante aparece en el hito de destino.
    await seleccionar(page, "E000001");
    await expect(relaciones(page)).toHaveAttribute("open", "");
    const entrante = relaciones(page).locator('li[data-relation-direction="incoming"]');
    await expect(entrante).toHaveCount(1);
    await expect(entrante).toContainText("E000002");
    await expect(entrante).toContainText("follows");
  });

  test("relación local resuelta: «Abrir E000001» selecciona ese hito sin perder el foco", async ({ page }) => {
    await abrirTraza(page);
    await seleccionar(page, "E000002");
    await abrirRelaciones(page);
    await relaciones(page).getByRole("button", { name: "Abrir E000001" }).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000001");
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    expect(new URL(page.url()).searchParams.get("event")).toBe("E000001");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });

  test("hallazgo y check locales abren su vista con el destino resaltado", async ({ page }) => {
    await abrirTraza(page);
    await abrirRelaciones(page);
    await relaciones(page).getByRole("button", { name: "Abrir F001" }).click();
    await expect(page.getByRole("tab", { name: "Hallazgos" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('#revision [data-detalle][data-resaltado="true"]')).toContainText("F001");
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await abrirRelaciones(page);
    await relaciones(page).getByRole("button", { name: "Abrir C001" }).click();
    await expect(page.getByRole("tab", { name: "Validación" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('#revision [data-detalle][data-resaltado="true"]')).toContainText("C001");
  });

  test("relación entre corridas: abrir la revisión y volver restaura corrida, pestaña e hito", async ({ page }) => {
    await abrirTraza(page);
    await abrirRelaciones(page);
    await relaciones(page).getByRole("button", { name: new RegExp(`^Abrir revisión ${CR_B}`) }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(RUN_B);
    expect(new URL(page.url()).searchParams.get("tab")).toBe("trazabilidad");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000001");
    await expect(inspector(page)).toContainText("Hito de la revisión de destino");
    // La dirección sigue limitada a `?run&tab&event`.
    expect([...new URL(page.url()).searchParams.keys()].sort()).toEqual(["event", "run", "tab"]);

    const volver = page.getByRole("button", { name: "Volver a la revisión anterior" });
    await expect(volver).toBeVisible();
    await volver.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("run")).toBe(RUN_A);
    expect(new URL(page.url()).searchParams.get("tab")).toBe("trazabilidad");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(page.getByRole("tab", { name: "Trazabilidad" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Volver a la revisión anterior" })).toHaveCount(0);
  });

  test("`dangling` y `ambiguous` conservan el valor con explicación y sin botón", async ({ page }) => {
    await abrirTraza(page);
    await abrirRelaciones(page);
    const colgante = relaciones(page).locator('[data-relation-status="dangling"]');
    await expect(colgante).toContainText("E000009");
    await expect(colgante.locator(".relacion-motivo")).not.toBeEmpty();
    await expect(colgante.locator("button, a")).toHaveCount(0);
    const ambigua = relaciones(page).locator('[data-relation-status="ambiguous"]');
    await expect(ambigua).toContainText("CR-3333333333333333cccc#E000004");
    await expect(ambigua.locator(".relacion-motivo")).not.toBeEmpty();
    await expect(ambigua.locator("button, a")).toHaveCount(0);
  });

  test("un ciclo se etiqueta con su diagnóstico y no se recorre solo", async ({ page }) => {
    const traza = trazaBase();
    traza.relations = [
      { event_id: "E000001", relation: "depends_on", raw: "E000002", target: "E000002", status: "cyclic", run_key: RUN_A, file_key: null },
      { event_id: "E000002", relation: "depends_on", raw: "E000001", target: "E000001", status: "cyclic", run_key: RUN_A, file_key: null },
    ];
    traza.diagnostics = [{ code: "relation.cyclic", severity: "warning", message: "Una relación declarada forma un ciclo." }];
    await abrirTraza(page, traza);
    await seleccionar(page, "E000002");
    await abrirRelaciones(page);
    const ciclos = relaciones(page).locator('[data-relation-status="cyclic"]');
    await expect(ciclos).toHaveCount(2);
    await expect(ciclos.first()).toContainText("Ciclo declarado");
    await expect(ciclos.first()).toContainText("relation.cyclic");
    await expect(ciclos.locator("button, a")).toHaveCount(0);
    await page.waitForTimeout(400);
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000002");
  });

  test("las acciones de la tarjeta seleccionan y despliegan la sección sin mover el foco al inspector", async ({ page }) => {
    await abrirTraza(page);
    const tarjeta = page.locator('[data-part="cards"] li[data-event-id="E000002"]');
    await expect(tarjeta.getByRole("button", { name: /^Relaciones \(1\)/ })).toHaveCount(1);
    await expect(tarjeta.getByRole("button", { name: /^Evidencia/ })).toHaveCount(0);
    // E000001 no tiene salientes pero recibe una relación; E000003 declara evidencia.
    await expect(page.locator('[data-part="cards"] li[data-event-id="E000003"]').getByRole("button", { name: /^Evidencia \(1\)/ })).toHaveCount(1);
    await tarjeta.getByRole("button", { name: /^Relaciones \(1\)/ }).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000002");
    await expect(relaciones(page)).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.getElementById("inspector").contains(document.activeElement))).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.closest("li")?.dataset.eventId)).toBe("E000002");

    await page.locator('[data-part="cards"] li[data-event-id="E000003"]').getByRole("button", { name: /^Evidencia \(1\)/ }).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(evidencia(page)).toHaveAttribute("open", "");
  });
});

test.describe("evidencia", () => {
  test("una coincidencia exacta abre Documentos y pide la vista previa por clave opaca", async ({ page }) => {
    const peticiones = await abrirTraza(page);
    await evidencia(page).locator("summary").click();
    await evidencia(page).getByRole("button", { name: /Abrir en Documentos.*evidence\/notes\.json/ }).click();
    await expect(page.getByRole("tab", { name: "Documentos" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`#revision button[data-file-key="${CLAVE_NOTAS}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => peticiones.some((url) => new URL(url).pathname === `/api/runs/${RUN_A}/files/${CLAVE_NOTAS}`)).toBe(true);
    for (const url of peticiones) {
      expect(decodeURIComponent(url)).not.toContain("notes.json");
      expect(decodeURIComponent(url)).not.toContain("evidence/");
    }
  });

  test("la evidencia hostil queda inerte con su diagnóstico", async ({ page }) => {
    const traza = trazaBase();
    traza.events[2].evidence = [
      "../secreto",
      "/etc/passwd",
      "C:\\x",
      "https://x.invalid/a",
      "javascript:alert(1)",
      "notes.json",
      { kind: "static", details: "<img src=x onerror=window.__pwned=1>" },
    ];
    const peticiones = await abrirTraza(page, traza);
    await evidencia(page).locator("summary").click();
    const items = evidencia(page).locator("li[data-evidence-code]");
    await expect(items).toHaveCount(7);
    const codigos = await items.evaluateAll((nodos) => nodos.map((n) => n.dataset.evidenceCode));
    expect(codigos).toEqual(["path_traversal", "absolute_path", "absolute_path", "url", "url", "not_in_inventory", "unrecognized"]);
    for (let i = 0; i < 7; i += 1) await expect(items.nth(i).locator(".evidencia-motivo")).not.toBeEmpty();
    await expect(evidencia(page).locator("a, button, img, script")).toHaveCount(0);
    await expect(evidencia(page)).toContainText("../secreto");
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    for (const url of peticiones) {
      for (const crudo of ["secreto", "passwd", "x.invalid", "javascript"]) expect(decodeURIComponent(url)).not.toContain(crudo);
    }
  });

  test("si el inventario falla, la evidencia queda inerte y las relaciones siguen navegando", async ({ page }) => {
    await abrirTraza(page, trazaBase(), {
      inventario: (ruta) => ruta.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ api_version: 1, error: { code: "read_failed", message: "lectura sintética fallida" } }),
      }),
    });
    await evidencia(page).locator("summary").click();
    await expect(evidencia(page)).toContainText("No se pudo leer el inventario");
    await expect(evidencia(page).locator("li[data-evidence-code]")).toHaveCount(1);
    await expect(evidencia(page).locator("button, a")).toHaveCount(0);
    await abrirRelaciones(page);
    await relaciones(page).getByRole("button", { name: "Abrir F001" }).click();
    await expect(page.getByRole("tab", { name: "Hallazgos" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("estados vacíos", () => {
  test("sin relaciones, evidencia, actor ni hora: un mensaje propio para cada caso", async ({ page }) => {
    const traza = trazaBase();
    const e1 = traza.events[0];
    e1.actor = null;
    e1.evidence = [];
    e1.temporal_basis = "sequence_fallback";
    e1.temporal_at = null;
    e1.recorded_at = null;
    traza.relations = [];
    await abrirTraza(page, traza);
    await seleccionar(page, "E000001");
    await expect(inspector(page).locator('[data-vacio="relaciones"]')).toHaveText("Este hito no declara relaciones.");
    await expect(inspector(page).locator('[data-vacio="evidencia"]')).toHaveText("Este hito no declara evidencia.");
    await expect(inspector(page).locator('[data-vacio="actor"]')).toContainText("no declara actor");
    await expect(campo(page, "actor")).toContainText("Actor no declarado");
    await expect(campo(page, "registrador")).toContainText("review_artifacts");
    await expect(inspector(page).locator('[data-vacio="tiempo"]')).toContainText("no declara hora");
    await expect(inspector(page).locator('[data-part="inspector-time"]')).toContainText("respaldo de secuencia");
    await expect(relaciones(page)).toHaveCount(0);
    await expect(evidencia(page)).toHaveCount(0);
  });
});

test.describe("recarga de la fuente (§11)", () => {
  /** Sustituye `EventSource` para entregar avisos a mano (`window.entregarAviso`). */
  async function instalarAvisos(page) {
    await page.addInitScript(() => {
      window.EventSource = class {
        addEventListener(tipo, devolucion) {
          if (tipo === "notice") window.entregarAviso = (aviso) => devolucion({ data: JSON.stringify(aviso) });
        }
        close() {}
      };
      // Portapapeles que acepta en ambos navegadores: solo importa el aviso de copia.
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.resolve() } });
    });
  }

  /**
   * Deja el inspector con estado de lectura: evidencia y JSON desplegados, un
   * aviso de copia, parte del JSON seleccionada y el foco en «Abrir en Documentos».
   */
  async function prepararLectura(page) {
    await evidencia(page).locator("summary").click();
    const abrir = evidencia(page).getByRole("button", { name: /Abrir en Documentos/ });
    await expect(abrir).toBeVisible();
    await inspector(page).getByRole("button", { name: "Copiar resumen", exact: true }).click();
    await expect(inspector(page).locator('[data-part="copy-status"]')).toContainText("copiado");
    const json = inspector(page).locator('details[data-part="original-json"]');
    await json.locator("summary").click();
    await expect(json).toHaveAttribute("open", "");
    const seleccionado = await page.evaluate(() => {
      const texto = document.querySelector('#inspector details[data-part="original-json"] pre').firstChild;
      const rango = document.createRange();
      rango.setStart(texto, 10);
      rango.setEnd(texto, 60);
      getSelection().removeAllRanges();
      getSelection().addRange(rango);
      return getSelection().toString();
    });
    // Firefox en Windows devuelve los saltos como CRLF en `toString()`.
    expect(seleccionado.replace(/\r\n/g, "\n").length).toBe(50);
    await abrir.focus();
    // Testigos: el nodo enfocado, el «comprobando» transitorio y el repintado del explorador.
    await page.evaluate(() => {
      document.activeElement.dataset.testigo = "1";
      document.querySelector('[data-part="chain"] strong').dataset.testigo = "1";
      window.__pendiente = false;
      new MutationObserver(() => {
        if (document.querySelector("#inspector [data-evidence-pending]")) window.__pendiente = true;
      }).observe(document.getElementById("inspector"), { subtree: true, childList: true, attributes: true });
    });
    return seleccionado;
  }

  async function recargar(page) {
    await page.evaluate((clave) => window.entregarAviso({ kind: "run_changed", run_key: clave, cursor: 2 }), RUN_A);
    // La cadena se repinta con cada modelo nuevo: su testigo desaparece.
    await expect(page.locator('[data-part="chain"] strong[data-testigo]')).toHaveCount(0);
    await page.evaluate(() => new Promise((listo) => requestAnimationFrame(() => setTimeout(listo, 100))));
  }

  const lectura = (page) => page.evaluate(() => ({
    accion: document.activeElement?.dataset.accion ?? null,
    mismoNodo: document.activeElement?.dataset.testigo === "1",
    seleccion: getSelection().toString(),
    jsonAbierto: document.querySelector('#inspector details[data-part="original-json"]')?.open ?? false,
    evidenciaAbierta: document.querySelector('#inspector details[data-part="evidence"]')?.open ?? false,
    estadoCopia: document.querySelector('#inspector [data-part="copy-status"]')?.textContent ?? "",
    pendiente: window.__pendiente,
  }));

  test("una recarga con los mismos datos no toca foco, JSON abierto, selección ni aviso de copia", async ({ page }) => {
    await instalarAvisos(page);
    await abrirTraza(page, () => trazaBase());
    const seleccionado = await prepararLectura(page);
    await recargar(page);
    const estado = await lectura(page);
    expect(estado).toEqual({
      accion: "evidencia-0",
      mismoNodo: true,
      seleccion: seleccionado,
      jsonAbierto: true,
      evidenciaAbierta: true,
      estadoCopia: "El resumen copiado.",
      pendiente: false,
    });
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
  });

  test("un hito nuevo no relacionado no altera la lectura del hito seleccionado", async ({ page }) => {
    await instalarAvisos(page);
    let traza = trazaBase();
    await abrirTraza(page, () => traza);
    const seleccionado = await prepararLectura(page);
    traza = trazaBase();
    traza.events.push({
      ...structuredClone(traza.events[1]),
      event_id: "E000004",
      sequence: 4,
      summary: "Hito nuevo sin relación con E000003",
      evidence: [],
    });
    traza.valid_prefix_length = 4;
    traza.temporal_order = ["E000003", "E000002", "E000001", "E000004"];
    await recargar(page);
    await expect(page.locator('[data-part="cards"] li[data-event-id="E000004"]')).toHaveCount(1);
    const estado = await lectura(page);
    expect(estado).toEqual({
      accion: "evidencia-0",
      mismoNodo: true,
      seleccion: seleccionado,
      jsonAbierto: true,
      evidenciaAbierta: true,
      estadoCopia: "El resumen copiado.",
      pendiente: false,
    });
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
  });

  test("si cambian las relaciones del hito se repinta en su sitio conservando foco, detalles y selección", async ({ page }) => {
    await instalarAvisos(page);
    let traza = trazaBase();
    await abrirTraza(page, () => traza);
    const seleccionado = await prepararLectura(page);
    traza = trazaBase();
    traza.relations.push({ event_id: "E000003", relation: "records", raw: "E000001", target: "E000001", status: "resolved", run_key: RUN_A, file_key: null });
    await recargar(page);
    await expect(relaciones(page).locator("summary")).toHaveText(/Relaciones \(6\)/);
    const estado = await lectura(page);
    // El cuerpo se repintó (nodo nuevo), pero el control, los detalles y la selección siguen.
    expect(estado.mismoNodo).toBe(false);
    expect(estado.accion).toBe("evidencia-0");
    expect(estado.seleccion).toBe(seleccionado);
    expect(estado.jsonAbierto).toBe(true);
    expect(estado.evidenciaAbierta).toBe(true);
    expect(estado.pendiente).toBe(false);
  });
});
