import { test, expect } from "@playwright/test";
import { openFixture } from "./support.mjs";

test("el código y la alternativa de imágenes conservan el texto del informe", async ({ page }) => {
  await openFixture(page);
  await page.route("**/api/runs/*/files/*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: { text: '## Código\n\n```html\n<div data-value="a&b">texto</div>\n```\n\n![diagrama sintético](https://ejemplo.invalid/image.png)', truncated: false, total_bytes: 130 } }) }));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator(".documento-texto code")).toHaveText('<div data-value="a&b">texto</div>\n');
  await expect(page.locator(".documento-texto")).toContainText("diagrama sintético");
  await expect(page.locator(".documento-texto img")).toHaveCount(0);
});

test("un inventario con nombres y rutas hostiles se muestra como texto y no navega", async ({ page }) => {
  await openFixture(page);
  const archivos = [
    { key: "5".repeat(32), name: "<img src=x onerror=\"window.__pwned = true\">.md", relative_path: "../../etc/<script>window.__pwned = true</script>.md", media_kind: "markdown", bytes: 10, available: true },
    { key: "6".repeat(32), name: "javascript:alert(1)", relative_path: "javascript:alert(1)", media_kind: "text", bytes: 5, available: true },
  ];
  await page.route("**/api/runs/*/files", (ruta) =>
    ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: archivos }) }),
  );
  await page.route("**/api/runs/*/files/*", (ruta) =>
    ruta.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ api_version: 1, data: { text: "# Título\n\n<script>window.__pwned = true</script>", media_kind: "markdown", truncated: false, total_bytes: 10 } }),
    }),
  );
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Documentos" }).click();
  const inventario = page.locator("#revision .fila-archivo");
  await expect(inventario).toHaveCount(2);
  await expect(inventario.first()).toContainText("../../etc/<script>window.__pwned = true</script>.md");
  await expect(inventario.nth(1)).toContainText("javascript:alert(1)");
  await inventario.nth(1).click();
  await expect(page.locator("#revision [data-vista-previa]")).toContainText("javascript:alert(1)");
  for (const etiqueta of ["script", "img", "iframe", "a"]) {
    await expect(page.locator("#revision").locator(etiqueta)).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__pwned ?? false)).toBe(false);
});
