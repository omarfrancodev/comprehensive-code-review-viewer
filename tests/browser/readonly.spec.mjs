import { expect, test } from "@playwright/test";

import { fixtureOperation, inventory, startFixtureServer } from "./server.mjs";

/**
 * RO-01 (§12, AGENTS.md): abrir, reproducir, seguir En Vivo, validar y leer
 * documentos con el servidor real no cambia bytes, SHA-256, tamaños ni mtimes
 * de ningún archivo de la raíz sintética. La huella cubre la raíz completa
 * (no solo la corrida), así que un archivo nuevo también se detectaría.
 */

let servidor = null;

test.afterEach(() => {
  servidor?.stop();
  servidor = null;
});

/** Recorre Trazabilidad: reinicia, reproduce, pausa, selecciona y abre el JSON original. */
async function reproducir(page) {
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();
  await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
  await page.getByRole("button", { name: "Reproducir", exact: true }).click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await page.getByRole("button", { name: "Ir al último", exact: true }).click();
  await page.getByRole("searchbox", { name: "Buscar hitos" }).fill("E000001");
  await page.getByRole("searchbox", { name: "Buscar hitos" }).press("Enter");
  await page.locator('#inspector details[data-part="original-json"] summary').click();
  await page.getByRole("searchbox", { name: "Buscar hitos" }).fill("");
}

/** «Verificar integridad» en Archivo y espera su resultado. */
async function verificar(page) {
  await page.getByRole("tab", { name: "Archivo", exact: true }).click();
  await page.getByRole("button", { name: "Verificar integridad" }).click();
  await expect(page.locator("#revision")).toContainText("Integridad:", { timeout: 15_000 });
}

test("RO-01: revisión cerrada — abrir, recorrer todas las vistas, reproducir y verificar no cambian la raíz", async ({ page }) => {
  servidor = await startFixtureServer("final_v7");
  const antes = inventory(servidor.raiz);
  expect(Object.keys(antes).length).toBeGreaterThan(4);

  await page.goto(servidor.url);
  await page.locator(".lista-revisiones button").first().click();
  for (const nombre of ["Resumen", "Hallazgos", "Validación", "Seguimiento"]) {
    await page.getByRole("tab", { name: nombre, exact: true }).click();
    await expect(page.getByRole("tab", { name: nombre, exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator(".documento-texto h1")).toHaveText("Informe de revision sintetica");
  for (const boton of await page.locator("#revision button[data-file-key]").all()) await boton.click();
  await reproducir(page);
  await verificar(page);
  await verificar(page);
  // El colector sigue sondeando durante varios ciclos sin escribir nada.
  await page.waitForTimeout(4500);
  await page.reload();
  await page.waitForSelector("#biblioteca .lista-revisiones button, #biblioteca [data-estado]", { timeout: 15_000 });

  expect(inventory(servidor.raiz)).toEqual(antes);
});

test("RO-01: revisión en procesamiento — seguir En Vivo durante cambios del productor y verificar no tocan nada que el productor no escribió", async ({ page }) => {
  servidor = await startFixtureServer("processing_archive_v5");
  const antes = inventory(servidor.raiz);

  await page.goto(servidor.url);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator('[data-part="live"]')).not.toHaveAttribute("data-availability", "verifying", { timeout: 10_000 });
  await page.getByRole("button", { name: "En Vivo", exact: true }).click();
  await page.waitForTimeout(4500);
  // Seguir y abrir, sin cambios del productor, no escribe nada.
  expect(inventory(servidor.raiz)).toEqual(antes);

  // El único que escribe es el productor de prueba; la huella se toma justo
  // después de su escritura y debe sobrevivir intacta a la lectura del visor.
  fixtureOperation(servidor.run, "add_check");
  const trasProductor = inventory(servidor.raiz);
  await expect(page.locator('[data-part="cards"] li[data-event-id]')).toHaveCount(3, { timeout: 20_000 });
  await reproducir(page);
  await verificar(page);
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await page.waitForTimeout(4500);

  expect(inventory(servidor.raiz)).toEqual(trasProductor);
});
