import { test, expect } from "@playwright/test";
import { openFixture, REVISION_SINTETICA, TRAZA_SINTETICA } from "./support.mjs";

const respond = (route, data) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data }) });

test("metadata con objetos anidados inválidos conserva acceso al JSON original", async ({ page }) => {
  await openFixture(page);
  await page.route(`**/api/runs/${REVISION_SINTETICA.summary.key}`, route => respond(route, { ...REVISION_SINTETICA, review: { ...REVISION_SINTETICA.review, change_authors: [null], original_unknown: "dato conservado" } }));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByText("JSON original", { exact: true }).click();
  await expect(page.locator("#revision details pre")).toContainText("dato conservado");
  await expect(page.getByRole("tab", { name: "Documentos" })).toBeVisible();
});

test("la ficha conserva declaraciones y los hitos muestran hora local con detalle UTC", async ({ page }) => {
  await openFixture(page);
  await page.route(`**/api/runs/${REVISION_SINTETICA.summary.key}`, route => respond(route, { ...REVISION_SINTETICA, closure: { ...REVISION_SINTETICA.closure, skill_version: "2.9.0", harness: "claude-code", executors: [{ id: "executor-original", isolation: "worktree", dependencies: ["dependency-original"] }] } }));
  await page.route("**/api/runs/*/trace", route => respond(route, TRAZA_SINTETICA));
  await page.locator(".lista-revisiones button").first().click();
  await expect(page.locator("#revision")).toContainText("claude-code");
  await expect(page.locator("#revision")).toContainText("dependency-original");
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  const time = page.locator(".hitos time").first();
  await expect(time).toHaveAttribute("datetime", /2026-/);
  await expect(time).toHaveAttribute("title", /UTC.*Origen:/);
});

test("filtrar y limpiar solicitan una página nueva", async ({ page }) => {
  await openFixture(page);
  const queries = [];
  await page.route("**/api/runs?*", route => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query.get("q"));
    return respond(route, { items: query.has("q") ? [] : [REVISION_SINTETICA.summary], total: query.has("q") ? 0 : 1 });
  });
  await page.locator('[name="q"]').fill("ausente");
  await page.getByRole("button", { name: "Filtrar", exact: true }).click();
  await expect(page.locator("#biblioteca")).toContainText("Sin revisiones");
  expect(queries).toContain("ausente");
  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await expect(page.locator(".lista-revisiones button")).toHaveCount(1);
});

test("la página 51 es accesible sin perder la selección", async ({ page }) => {
  await openFixture(page);
  await page.route("**/api/runs?*", route => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset"));
    return respond(route, { items: [{ ...REVISION_SINTETICA.summary, scope_label: offset ? "pr 51" : "pr 42" }], total: 51, offset, limit: 50, truncated: !offset });
  });
  await page.reload();
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("button", { name: "Página siguiente" }).click();
  await expect(page.locator("#biblioteca")).toContainText("pr 51");
  await expect(page.locator("#revision")).toContainText("Revisión sintética de validación");
});

test("seguimiento conserva IDs anteriores y archivo ofrece integridad y JSON original", async ({ page }) => {
  await openFixture(page);
  const view = structuredClone(REVISION_SINTETICA);
  view.review.rereview = [{ id: "F009", status: "resolved", previous_title: "Título anterior" }];
  await page.route("**/api/runs/*", route => respond(route, view));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Seguimiento" }).click();
  await expect(page.locator("#revision")).toContainText("F009");
  await expect(page.locator("#revision")).toContainText("Título anterior");
  await page.getByRole("tab", { name: "Archivo", exact: true }).click();
  await page.getByRole("button", { name: "Verificar integridad" }).click();
  await expect(page.locator("#revision")).toContainText("verified");
  await page.getByText("JSON original", { exact: true }).click();
  await expect(page.locator("#revision details pre")).toContainText('"schema_version": 7');
});

test("un enlace Markdown local abre la preview sin abandonar la aplicación", async ({ page }) => {
  await openFixture(page);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Documentos" }).click();
  const original = page.url();
  await page.getByRole("link", { name: "notas locales" }).click();
  await expect(page.locator(".vista-previa")).toBeVisible();
  expect(page.url()).toBe(original);
});

test("autoplay mueve el hito visible y el teclado conserva controles", async ({ page }) => {
  await openFixture(page);
  await page.route("**/api/runs/*/trace", route => respond(route, TRAZA_SINTETICA));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await page.getByRole("button", { name: "▶ Reproducir", exact: true }).click();
  await expect(page.locator(".hito--seleccionado")).toContainText("E000002", { timeout: 1500 });
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  const controls = page.getByRole("group", { name: "Controles de reproducción" });
  await controls.focus();
  await page.keyboard.press("Home");
  await expect(page.locator(".hito--seleccionado")).toContainText("E000001");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".hito--seleccionado")).toContainText("E000002");
  await expect(page.getByRole("slider", { name: "Evento seleccionado" })).toHaveValue("1");
});

test("un aviso recarga la revisión final y conserva la pestaña seleccionada", async ({ page }) => {
  await page.addInitScript(() => {
    window.EventSource = class {
      addEventListener(type, callback) { if (type === "notice") window.deliverNotice = notice => callback({ data: JSON.stringify(notice) }); }
      close() {}
    };
  });
  await openFixture(page);
  const prepared = structuredClone(REVISION_SINTETICA);
  prepared.review = null;
  await page.route("**/api/runs/*", route => respond(route, prepared));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Hallazgos" }).click();
  await expect(page.locator("#revision")).toContainText("No hay hallazgos");
  await page.route("**/api/runs/*", route => respond(route, REVISION_SINTETICA));
  await page.evaluate(key => window.deliverNotice({ kind: "run_changed", run_key: key, cursor: 2 }), REVISION_SINTETICA.summary.key);
  await expect(page.locator("#revision")).toContainText("Validación de entrada ausente");
  await expect(page.getByRole("tab", { name: "Hallazgos" })).toHaveAttribute("aria-selected", "true");
});
