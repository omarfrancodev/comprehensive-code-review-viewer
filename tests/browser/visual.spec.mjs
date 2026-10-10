import { test, expect } from "@playwright/test";
import { openFixture, TRAZA_SINTETICA } from "./support.mjs";

test("navegación y texto permanecen accesibles a 375, 900 y 1440 px en ambos temas", async ({ page }, info) => {
  await openFixture(page);
  await page.route("**/api/runs/*/trace", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ api_version: 1, data: TRAZA_SINTETICA }) }));
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator(".hitos .hito")).toHaveCount(3);
  for (const width of [375, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 375) await page.getByRole("button", { name: /biblioteca/i }).click();
    for (const theme of ["light", "dark"]) {
      await page.locator("#tema").selectOption(theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole("tab", { name: "Archivo", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Controles de reproducción" })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${width}-${theme}.png`), fullPage: true });
    }
  }
});
