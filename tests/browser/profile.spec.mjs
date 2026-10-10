import { expect, test } from "@playwright/test";

import { openFixture } from "./support.mjs";

test.describe("ficha, hallazgos y validación", () => {
  test.beforeEach(async ({ page }) => {
    await openFixture(page);
  });

  test("muestra la raíz configurada y la biblioteca", async ({ page }) => {
    await expect(page.locator("#raiz")).toContainText("C:/archivo/sintetico");
    await expect(page.locator("#biblioteca")).toContainText("pr 42");
    await expect(page.locator("#biblioteca")).toContainText("cerrada");
  });

  test("la ficha conserva los valores de la fuente", async ({ page }) => {
    await page.locator(".lista-revisiones button").first().click();
    const ficha = page.locator("#revision");
    await expect(ficha.locator("header.revision-encabezado h2")).toHaveText("Revisión sintética de validación");
    await expect(ficha).toContainText("CR-1111111111111111aaaa");
    await expect(ficha).toContainText("approvable_with_reservations");
    await expect(ficha).toContainText("extended");
  });

  test("responsable y autores del cambio aparecen por separado", async ({ page }) => {
    await page.locator(".lista-revisiones button").first().click();
    await expect(page.locator("#revision")).toContainText("Responsable");
    await expect(page.locator("#revision")).toContainText("Autora sintética");
  });

  test("los hallazgos separan prioridad, título y estado", async ({ page }) => {
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Hallazgos" }).click();
    const hallazgos = page.locator("#revision");
    await expect(hallazgos.locator("h3").first()).toContainText("P1 · F001");
    await expect(hallazgos.locator("h4").first()).toHaveText("Validación de entrada ausente");
    await expect(hallazgos).toContainText("Confirmados (1)");
    await expect(hallazgos).toContainText("No resueltos (0)");
  });

  test("la validación no convierte ausencia en aprobado", async ({ page }) => {
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Validación" }).click();
    await expect(page.locator("#revision")).toContainText("C001");
    await expect(page.locator("#revision")).toContainText("9f1c2b7");
    await expect(page.locator("#revision")).toContainText("Superadas: 1");
  });

  test("la selección se puede cambiar con el teclado", async ({ page }) => {
    const boton = page.locator(".lista-revisiones button").first();
    await boton.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#revision header.revision-encabezado h2")).toHaveText("Revisión sintética de validación");
  });

  test("funciona a 375 px y a 900 px de ancho", async ({ page }) => {
    for (const ancho of [375, 900]) {
      await page.setViewportSize({ width: ancho, height: 800 });
      await page.locator(".lista-revisiones button").first().click();
      await expect(page.locator("#revision header.revision-encabezado h2")).toBeVisible();
      const desborde = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(desborde, `sin desbordamiento horizontal a ${ancho} px`).toBeLessThanOrEqual(1);
    }
  });

  test("no hay desbordamiento horizontal en la ficha", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.locator(".lista-revisiones button").first().click();
    await expect(page.locator("#revision")).toBeVisible();
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });
});