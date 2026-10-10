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
