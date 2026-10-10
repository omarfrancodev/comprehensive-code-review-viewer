import { test, expect } from "@playwright/test";
import { openFixture, TRAZA_SINTETICA } from "./support.mjs";

/** Sin scroll horizontal de página: el documento nunca es más ancho que la ventana. */
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("navegación y texto permanecen accesibles a 375, 768, 900, 1024 y 1440 px en todos los temas", async ({ page }, info) => {
  await openFixture(page);
  await page.route("**/api/runs/*/trace", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ api_version: 1, data: TRAZA_SINTETICA }) }));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator(".hitos .hito")).toHaveCount(3);
  for (const width of [375, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 375) {
      // En una columna la biblioteca es un desplegable que no desborda la página.
      await page.getByRole("button", { name: /biblioteca/i }).click();
      await expect(page.locator("#biblioteca")).toBeVisible();
    }
    for (const theme of ["system", "light", "dark"]) {
      await page.locator("#tema").selectOption(theme);
      if (theme === "system") await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      else await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await sinDesborde(page), `sin desborde a ${width}px (${theme})`).toBe(true);
      await expect(page.getByRole("tab", { name: "Archivo", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Controles de reproducción" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${width}-${theme}.png`), fullPage: true });
    }
    if (width === 375) {
      await page.getByRole("button", { name: "Volver a la revisión" }).click();
      await expect(page.locator("#biblioteca")).toBeHidden();
    }
  }
});
