import { expect, test } from "@playwright/test";

import { TRAZA_SINTETICA, openFixture } from "./support.mjs";

test.describe("trazabilidad y reproducción", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/runs/*/trace", (ruta) =>
      ruta.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ api_version: 1, data: TRAZA_SINTETICA, diagnostics: [] }),
      }),
    );
    await openFixture(page);
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
  });

  test("muestra la cadena y el número de eventos verificados", async ({ page }) => {
    await expect(page.locator("#revision")).toContainText("cadena verificada");
    await expect(page.locator("#revision")).toContainText("3 evento(s) verificado(s)");
  });

  test("conserva el orden canónico y muestra el temporal aparte", async ({ page }) => {
    const canonico = page.locator(".seccion--hitos .hitos .hito");
    await expect(canonico).toHaveCount(3);
    await expect(canonico.nth(0)).toContainText("E000001");
    await expect(canonico.nth(2)).toContainText("E000003");

    const temporal = page.locator(".orden-temporal li");
    await expect(temporal).toHaveCount(3);
    await expect(temporal.nth(0)).toHaveText("E000003");
  });

  test("etiqueta la base de cada tiempo sin fabricar duración", async ({ page }) => {
    const trazabilidad = page.locator("#revision");
    await expect(trazabilidad).toContainText("ocurrencia observada");
    await expect(trazabilidad).toContainText("respaldo de registro");
    // Ningún texto presenta un tiempo calculado por diferencia.
    expect(await trazabilidad.textContent()).not.toMatch(/\d+\s*(ms|segundos|minutos)\s*de ejecución/i);
  });

  test("distingue registrador, actor y ejecutor", async ({ page }) => {
    const hito = page.locator(".hito").first();
    await expect(hito).toContainText("Registrador");
    await expect(hito).toContainText("review_artifacts");
    await expect(hito).toContainText("Actor");
  });

  test("las relaciones no resueltas se marcan como limitación", async ({ page }) => {
    await expect(page.locator("#revision")).toContainText("Relaciones declaradas");
    await expect(page.locator(".relacion--dangling")).toHaveCount(1);
    await expect(page.locator(".relacion--dangling")).toContainText("E000009");
  });

  test("el teclado avanza y retrocede sin salir de los límites", async ({ page }) => {
    // En vivo la selección arranca en el último hito; un paso atrás va a E000002.
    await page.getByRole("button", { name: "Evento anterior" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".hito--seleccionado")).toContainText("E000002");

    await page.getByRole("button", { name: "Evento anterior" }).click();
    await expect(page.locator(".hito--seleccionado")).toContainText("E000001");

    // Más pasos atrás no salen del inicio.
    await page.getByRole("button", { name: "Evento anterior" }).click();
    await expect(page.locator(".hito--seleccionado")).toContainText("E000001");

    await page.getByRole("button", { name: "Evento siguiente" }).click();
    await expect(page.locator(".hito--seleccionado")).toContainText("E000002");
  });

  test("ofrece sólo las velocidades permitidas", async ({ page }) => {
    // La traza se carga de forma asíncrona: se espera a que existan los controles.
    await page.locator("select.control").waitFor();
    const opciones = await page
      .locator("select.control option")
      .evaluateAll((nodos) => nodos.map((n) => n.value));
    expect(opciones).toEqual(["0.5", "1", "2", "4"]);
  });

  test("con movimiento reducido la reproducción no anima", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
    await expect(page.locator(".hitos .hito")).toHaveCount(3);
  });

  test("una traza vacía lo dice sin fingir un grafo completo", async ({ page }) => {
    await page.route("**/api/runs/*/trace", (ruta) =>
      ruta.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          api_version: 1,
          data: {
            events: [],
            valid_prefix_length: 0,
            chain_status: "limited",
            temporal_order: [],
            relations: [],
            diagnostics: [],
          },
        }),
      }),
    );
    await page.reload();
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
    await expect(page.locator("#revision")).toContainText("no conserva hitos registrados");
    await expect(page.locator(".hitos")).toHaveCount(0);
  });
});