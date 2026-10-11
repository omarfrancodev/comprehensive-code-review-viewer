import { expect, test } from "@playwright/test";

import { startFixtureServer } from "./server.mjs";

/**
 * SC-01 (§9, §12, AGENTS.md) con el servidor real: sesión, CSP y rutas son las
 * del producto. Solo la traza se intercepta para inyectar valores hostiles en
 * los campos que vienen del archivo (resumen, actor, tipo, estado, evidencia,
 * relaciones y campos desconocidos). Durante el revelado y en el inspector
 * todo queda como texto inerte.
 */

const XSS_IMG = "<img src=x onerror=window.__pwned=1>";
const XSS_SCRIPT = "<script>window.__pwned=1</script>";

function trazaHostil(runKey) {
  const base = {
    occurred_at: null,
    recorded_at: "2026-09-01T12:00:00+00:00",
    temporal_basis: "recording_fallback",
    temporal_at: "2026-09-01T12:00:00+00:00",
    recorder: { kind: "helper", name: "review_artifacts", provider_id: null },
    executor: null,
    authority: null,
    relations: [],
  };
  return {
    events: [
      {
        ...base,
        event_id: "E000001",
        sequence: 1,
        kind: "<svg onload=window.__pwned=1>",
        status: "<iframe src=javascript:alert(1)>",
        summary: XSS_IMG,
        actor: { kind: "agent", name: XSS_SCRIPT, provider_id: "<b onmouseover=window.__pwned=1>p</b>" },
        provenance: { kind: "tool", source: "javascript:alert(1)" },
        evidence: ["javascript:alert(1)", "../secreto", "/etc/passwd", { kind: "static", details: XSS_IMG }],
        campo_desconocido: { html: XSS_SCRIPT, ruta: "../../etc/passwd", lista: [1, "<i>dos</i>"] },
      },
      {
        ...base,
        event_id: "E000002",
        sequence: 2,
        kind: "discovery",
        status: "completed",
        summary: "[enlace](javascript:alert(1)) **negrita** <a href=\"javascript:alert(1)\">a</a>",
        actor: { kind: XSS_SCRIPT, name: null, provider_id: null },
        provenance: { kind: "helper", source: "../secreto" },
        evidence: [],
        executor: { name: XSS_IMG, provider_id: null },
      },
      {
        ...base,
        event_id: "E000003",
        sequence: 3,
        kind: "check",
        status: "passed",
        summary: "Hito final con relaciones hostiles",
        actor: { kind: "coordinator", name: "coordinator", provider_id: null },
        provenance: { kind: "helper", source: null },
        evidence: [],
      },
    ],
    valid_prefix_length: 3,
    chain_status: "verified",
    temporal_order: ["E000001", "E000002", "E000003"],
    relations: [
      { event_id: "E000003", relation: "depends_on", raw: "javascript:alert(1)", target: "javascript:alert(1)", status: "unresolved", run_key: null, file_key: null },
      { event_id: "E000003", relation: "reuses", raw: "../secreto", target: "../secreto", status: "dangling", run_key: runKey, file_key: null },
      { event_id: "E000003", relation: "supports", raw: XSS_IMG, target: XSS_IMG, status: "resolved", run_key: runKey, file_key: null },
      { event_id: "E000003", relation: "follows", raw: "E000002", target: "E000002", status: "resolved", run_key: runKey, file_key: null },
    ],
    diagnostics: [{ code: "trace.hostil", severity: "warning", message: XSS_IMG }],
    campo_futuro_de_traza: { nota: XSS_SCRIPT },
  };
}

/** Nodos activos que nunca deberían crearse desde datos del archivo. */
function nodosPeligrosos() {
  const atributosOn = [];
  for (const nodo of document.querySelectorAll("*")) {
    for (const atributo of nodo.attributes) {
      if (atributo.name.toLowerCase().startsWith("on")) atributosOn.push(`${nodo.tagName}[${atributo.name}]`);
    }
  }
  return {
    img: document.querySelectorAll("img, iframe, object, embed, frame").length,
    scripts: [...document.querySelectorAll("script")].map((s) => s.getAttribute("src")),
    svgDeDatos: document.querySelectorAll("svg:not(.icono)").length,
    enlacesJs: [...document.querySelectorAll("a[href]")].filter((a) => !/^(#|\/|http:\/\/127\.0\.0\.1)/.test(a.getAttribute("href"))).length,
    atributosOn,
    pwned: window.__pwned,
  };
}

let servidor = null;

test.beforeAll(async () => {
  servidor = await startFixtureServer("final_v7");
});

test.afterAll(() => {
  servidor?.stop();
});

test("SC-01: resumen, actor, evidencia, relaciones y metadata hostiles quedan inertes durante el revelado y en el inspector", async ({ page }) => {
  await page.addInitScript(() => {
    window.__violacionesCsp = [];
    document.addEventListener("securitypolicyviolation", (evento) => {
      window.__violacionesCsp.push(`${evento.violatedDirective} ${evento.blockedURI}`);
    });
  });
  const peticiones = [];
  page.on("request", (peticion) => peticiones.push(peticion.url()));
  const dialogos = [];
  page.on("dialog", (dialogo) => {
    dialogos.push(dialogo.message());
    void dialogo.dismiss();
  });

  const documento = await page.goto(servidor.url);
  // La política del documento es la del producto: sin `unsafe-inline`.
  const csp = documento.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");

  await page.waitForSelector("#biblioteca .lista-revisiones button", { timeout: 20_000 });
  const clave = await page.locator(".lista-revisiones button").first().getAttribute("data-key");
  const traza = trazaHostil(clave);
  await page.route("**/api/runs/*/trace", (ruta) =>
    ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: traza, diagnostics: [] }) }),
  );
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();

  // Revelado a 0.5×: E000001 se presenta con su resumen hostil.
  await page.getByLabel("Velocidad").selectOption("0.5");
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  const primera = page.locator('[data-part="cards"] li[data-event-id="E000001"]');
  await expect(primera).toHaveAttribute("data-state", "revealing");
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  for (let i = 0; i < 4; i += 1) {
    await page.waitForTimeout(400);
    // Seguimos dentro del revelado de E000001 (3600 ms a 0.5×).
    await expect(page.locator('[data-part="cards"] li[data-state="revealing"]')).toHaveAttribute("data-event-id", "E000001", { timeout: 100 });
    const peligro = await page.evaluate(nodosPeligrosos);
    expect(peligro.pwned).toBeUndefined();
    expect(peligro.img).toBe(0);
    expect(peligro.scripts).toEqual(["/assets/app.js"]);
    expect(peligro.svgDeDatos).toBe(0);
    expect(peligro.enlacesJs).toBe(0);
    expect(peligro.atributosOn).toEqual([]);
  }
  // El texto se ve literal, no interpretado.
  await expect(primera.locator('[data-part="content"]')).toHaveText(XSS_IMG);
  await expect(primera).toContainText("<svg onload=window.__pwned=1>");
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.getByRole("button", { name: "Mostrar tarjeta completa" }).click().catch(() => {});

  // Inspector de E000001: actor, evidencia y metadata desconocida.
  await page.locator('[data-part="timeline"] button[data-event-id="E000001"]').click();
  const inspector = page.locator('#inspector [data-part="inspector"]');
  await expect(inspector).toHaveAttribute("data-event-id", "E000001");
  await expect(inspector).toContainText(XSS_IMG);
  await expect(inspector.locator('[data-campo="actor"]')).toContainText(XSS_SCRIPT);
  await expect(inspector.locator('[data-campo="procedencia"]')).toContainText("javascript:alert(1)");
  const evidencia = inspector.locator('details[data-part="evidence"]');
  await evidencia.locator("summary").click();
  await expect(evidencia.locator("li[data-evidence-code]")).toHaveCount(4);
  expect(await evidencia.locator("li[data-evidence-code]").evaluateAll((n) => n.map((li) => li.dataset.evidenceCode)))
    .toEqual(["url", "path_traversal", "absolute_path", "unrecognized"]);
  await expect(evidencia.locator("a, button")).toHaveCount(0);
  const json = inspector.locator('details[data-part="original-json"]');
  await json.locator("summary").click();
  const original = JSON.parse(await json.locator("pre").textContent());
  expect(original).toEqual(traza.events[0]);

  // E000002: Markdown y HTML en el resumen no se interpretan; actor sin nombre.
  await page.locator('[data-part="timeline"] button[data-event-id="E000002"]').click();
  await expect(inspector).toHaveAttribute("data-event-id", "E000002");
  await expect(inspector).toContainText("[enlace](javascript:alert(1)) **negrita**");
  await expect(page.locator("#revision strong, #inspector strong").filter({ hasText: "negrita" })).toHaveCount(0);

  // E000003: relaciones hostiles sin navegación; solo E000002 navega.
  await page.locator('[data-part="timeline"] button[data-event-id="E000003"]').click();
  const relaciones = inspector.locator('details[data-part="relations"]');
  await relaciones.locator("summary").click();
  await expect(relaciones).toContainText("javascript:alert(1)");
  await expect(relaciones).toContainText("../secreto");
  await expect(relaciones).toContainText(XSS_IMG);
  await expect(relaciones.locator("a")).toHaveCount(0);
  const botones = await relaciones.locator("button").allTextContents();
  expect(botones.map((t) => t.trim())).toEqual(["Abrir E000002"]);
  // Los diagnósticos hostiles de la traza también son texto.
  await expect(page.locator('[data-part="diagnostics"]')).toContainText(XSS_IMG);

  const final = await page.evaluate(nodosPeligrosos);
  expect(final).toEqual({ img: 0, scripts: ["/assets/app.js"], svgDeDatos: 0, enlacesJs: 0, atributosOn: [], pwned: undefined });
  expect(dialogos).toEqual([]);
  expect(await page.evaluate(() => window.__violacionesCsp)).toEqual([]);
  // Ninguna petición sale del bucle local ni lleva rutas del archivo.
  for (const url of peticiones) {
    expect(url.startsWith("http://127.0.0.1:")).toBe(true);
    const ruta = decodeURIComponent(new URL(url).pathname);
    for (const crudo of ["secreto", "passwd", "javascript", "<", "/x"]) expect(ruta).not.toContain(crudo);
  }
});

test("SC-01: la sesión no se relaja — sin cookie la traza hostil no se sirve y la ruta no admite claves no opacas", async ({ browser }) => {
  const contexto = await browser.newContext();
  try {
    const base = servidor.url.split("#")[0];
    const sinSesion = await contexto.request.get(`${base}api/runs?offset=0&limit=50`);
    expect(sinSesion.status()).toBe(403);
    // Con sesión, una clave que no es opaca nunca llega a una ruta del archivo.
    const pagina = await contexto.newPage();
    await pagina.goto(servidor.url);
    await pagina.waitForSelector("#biblioteca .lista-revisiones button", { timeout: 20_000 });
    const respuesta = await pagina.evaluate(async () => {
      const r = await fetch("/api/runs/..%2F..%2Fsecreto/trace", { credentials: "same-origin" });
      return { estado: r.status, cuerpo: await r.text() };
    });
    expect(respuesta.estado).toBeGreaterThanOrEqual(400);
    expect(respuesta.cuerpo).not.toContain("secreto");
  } finally {
    await contexto.close();
  }
});
