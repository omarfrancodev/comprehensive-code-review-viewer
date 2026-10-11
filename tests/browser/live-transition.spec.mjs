import { test, expect } from "@playwright/test";
import { startFixtureServer, fixtureOperation } from "./server.mjs";

test("SSE mantiene el cursor pausado y publica el resultado sin alterar el archivo", async ({ page }) => {
  const server = await startFixtureServer("prepared_archive_v5");
  try {
    await page.goto(server.url);
    await page.locator(".lista-revisiones button").first().click();
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
    const tarjetas = page.locator('[data-part="cards"] li[data-event-id]');
    const seleccionada = page.locator('[data-part="cards"] li[aria-current="true"]');
    await expect(tarjetas).toHaveCount(1);
    // La presentación arranca en pausa: no hay autoplay que mover.
    await expect(page.getByRole("button", { name: "Reproducir", exact: true })).toBeVisible();
    const selected = await seleccionada.getAttribute("data-event-id");
    fixtureOperation(server.run, "prepare_to_discovery");
    await expect(tarjetas).toHaveCount(2, { timeout: 15000 });
    await expect(seleccionada).toHaveAttribute("data-event-id", selected);
    // El contador «N nuevos sin presentar» se acredita en la Tarea 12.
    await page.getByRole("tab", { name: "Hallazgos" }).click();
    const inventory = fixtureOperation(server.run, "retained_then_closed");
    await expect(page.locator("#revision")).toContainText("F001", { timeout: 15000 });
    await expect(page.locator("#biblioteca")).toContainText("cerrada");
    await expect(page.getByRole("tab", { name: "Hallazgos" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Archivo", exact: true }).click();
    await page.getByRole("button", { name: "Verificar integridad" }).click();
    await expect(page.locator("#revision")).toContainText("Integridad: verified");
    await page.getByRole("tab", { name: "Documentos" }).click();
    await expect(page.locator(".documento-texto h1")).toHaveText("Informe de revision sintetica");
    expect(fixtureOperation(server.run, "inventory")).toEqual(inventory);
  } finally { server.stop(); }
});
