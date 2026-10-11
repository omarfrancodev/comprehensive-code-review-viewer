import { expect, test } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { TRAZA_SINTETICA, openFixture } from "./support.mjs";

/**
 * Explorador de trazabilidad: franja de actores, timeline por ventanas,
 * controles, búsqueda, tarjetas en secuencia e inspector mínimo (TR-01, TR-02).
 */

const responder = (traza) => (ruta) =>
  ruta.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ api_version: 1, data: traza, diagnostics: [] }),
  });

async function abrirTraza(page, traza = TRAZA_SINTETICA) {
  await page.route("**/api/runs/*/trace", responder(traza));
  await openFixture(page);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();
}

const tarjetas = (page) => page.locator('[data-part="cards"] li[data-event-id]');
const marcadores = (page) => page.locator('[data-part="timeline"] button[data-event-id]');
const actores = (page) => page.locator('[data-part="actors"] button[data-actor-key]');
const tarjetaActual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');
const marcadorActual = (page) => page.locator('[data-part="timeline"] button[aria-current="true"]');
const inspector = (page) => page.locator('#inspector [data-part="inspector"]');
const busqueda = (page) => page.getByRole("searchbox", { name: "Buscar hitos" });

/** El mismo ID seleccionado en timeline, tarjetas e inspector. */
async function esperarSeleccion(page, id) {
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", id);
  await expect(marcadorActual(page)).toHaveAttribute("data-event-id", id);
  await expect(inspector(page)).toHaveAttribute("data-event-id", id);
  await expect(inspector(page).locator("h2")).toHaveText(id);
}

test.describe("explorador de trazabilidad", () => {
  test("tarjetas en secuencia, actores solo en franja", async ({ page }) => {
    const traza = trazaSintetica(7, { actors: 3 });
    // El orden de llegada no es el de secuencia: las tarjetas siguen `sequence`.
    traza.events = [...traza.events].reverse();
    await abrirTraza(page, traza);
    const ids = await tarjetas(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.eventId));
    expect(ids).toEqual(["E000001", "E000002", "E000003", "E000004", "E000005", "E000006", "E000007"]);
    await expect(actores(page)).toHaveCount(3);
    // Sin encabezados por actor ni accesos de actor dentro de la lista.
    await expect(page.locator('[data-part="cards"] :is(h1, h2, h3, h4, h5, h6)')).toHaveCount(0);
    await expect(page.locator('[data-part="cards"] [data-actor-key]')).toHaveCount(0);
    // Ni orden temporal aparte ni una segunda lista de todos los IDs.
    await expect(page.locator(".orden-temporal")).toHaveCount(0);
    await expect(page.locator("[data-explorer] li").filter({ hasText: /^\s*E\d{6}\s*$/ })).toHaveCount(0);
    await expect(page.locator("[data-explorer] :is(ol, ul)")).toHaveCount(2);
  });

  test("TR-01: actor, punto y tarjeta convergen en el mismo ID e inspector", async ({ page }) => {
    await abrirTraza(page);
    await esperarSeleccion(page, "E000003");

    await actores(page).filter({ hasText: "coordinator" }).click();
    await esperarSeleccion(page, "E000002");

    await page.locator('[data-part="timeline"] button[data-event-id="E000001"]').click();
    await esperarSeleccion(page, "E000001");

    await page.locator('[data-part="cards"] li[data-event-id="E000003"] button').first().click();
    await esperarSeleccion(page, "E000003");

    // Pulsar un actor durante el recorrido lo pausa y selecciona su primer hito.
    await page.getByRole("button", { name: "Reiniciar" }).click();
    await page.getByRole("button", { name: "Reproducir" }).click();
    await expect(page.getByRole("button", { name: "Pausar" })).toBeVisible();
    await actores(page).filter({ hasText: "coordinator" }).click();
    await expect(page.getByRole("button", { name: "Reproducir" })).toBeVisible();
    await esperarSeleccion(page, "E000002");

    // Entre los resultados de la búsqueda actual.
    await busqueda(page).fill("E000003");
    await actores(page).filter({ hasText: "coordinator" }).click();
    await esperarSeleccion(page, "E000003");

    // Sin coincidencias se explica y la lista no se filtra por actor.
    await busqueda(page).fill("E000001");
    await actores(page).filter({ hasText: "coordinator" }).click();
    await expect(page.locator('[data-part="actors-notice"]')).toContainText("Ningún hito de coordinator · coordinator coincide");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(tarjetas(page).first()).toHaveAttribute("data-event-id", "E000001");
  });

  test("seleccionar no roba el foco ni lo lleva al inspector", async ({ page }) => {
    await abrirTraza(page);
    await page.locator('[data-part="timeline"] button[data-event-id="E000001"]').click();
    await esperarSeleccion(page, "E000001");
    expect(await page.evaluate(() => document.activeElement?.dataset.eventId)).toBe("E000001");
    expect(await page.evaluate(() => document.activeElement?.closest("[data-part]")?.dataset.part)).toBe("timeline");

    await page.locator('[data-part="cards"] li[data-event-id="E000002"] button').first().click();
    await esperarSeleccion(page, "E000002");
    expect(await page.evaluate(() => document.activeElement?.closest("li")?.dataset.eventId)).toBe("E000002");
    expect(await page.evaluate(() => document.getElementById("inspector").contains(document.activeElement))).toBe(false);
  });

  test("0 eventos: mensaje propio sin tarjetas ni marcadores", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(0));
    await expect(page.locator("[data-explorer]")).toContainText("no conserva hitos registrados");
    await expect(tarjetas(page)).toHaveCount(0);
    await expect(marcadores(page)).toHaveCount(0);
    await expect(inspector(page)).toContainText("Sin hito seleccionado");
  });

  test("1 evento: una tarjeta y un marcador", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(1));
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(marcadores(page)).toHaveCount(1);
    await esperarSeleccion(page, "E000001");
  });

  test("50 hitos: 50 marcadores sin controles de ventana", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(50));
    await expect(marcadores(page)).toHaveCount(50);
    await expect(tarjetas(page)).toHaveCount(50);
    await expect(page.getByRole("button", { name: "Siguiente ventana" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ventana anterior" })).toHaveCount(0);
  });

  test("51 hitos: «1–50 de 51», «Siguiente ventana» y cambio de ventana al seleccionar", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(51));
    // La ventana inicial es la del último hito seleccionado.
    await expect(page.locator('[data-part="timeline"]')).toContainText("51–51 de 51");
    await expect(marcadores(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Ventana anterior" }).click();
    await expect(page.locator('[data-part="timeline"]')).toContainText("1–50 de 51");
    await expect(marcadores(page)).toHaveCount(50);
    await expect(page.getByRole("button", { name: "Siguiente ventana" })).toBeVisible();
    await expect(tarjetas(page)).toHaveCount(50);

    // Seleccionar E000051 cambia a su ventana.
    await page.getByRole("button", { name: "Ir al último" }).click();
    await expect(page.locator('[data-part="timeline"]')).toContainText("51–51 de 51");
    await esperarSeleccion(page, "E000051");
  });

  test("TR-02: 10 000 hitos y 60 actores con render acotado", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(10_000, { actors: 60 }));
    await esperarSeleccion(page, "E010000");
    expect(await marcadores(page).count()).toBeLessThanOrEqual(50);
    expect(await tarjetas(page).count()).toBeLessThanOrEqual(50);

    const deslizador = page.getByRole("slider", { name: "Posición del recorrido" });
    await deslizador.focus();
    await page.keyboard.press("Home");
    await esperarSeleccion(page, "E000001");
    await page.keyboard.press("End");
    await esperarSeleccion(page, "E010000");
    expect(await marcadores(page).count()).toBeLessThanOrEqual(50);

    await busqueda(page).fill("E009999");
    await expect(page.locator('[data-part="search"]')).toContainText("1 coincidencia");
    await busqueda(page).press("Enter");
    await esperarSeleccion(page, "E009999");
    expect(await tarjetas(page).count()).toBeLessThanOrEqual(50);

    await expect(actores(page)).toHaveCount(8);
    await page.getByRole("button", { name: /Ver todos los actores/ }).click();
    const dialogo = page.getByRole("dialog", { name: /Actores/ });
    await expect(dialogo.locator("button[data-actor-key]")).toHaveCount(50);
    await dialogo.getByRole("button", { name: "Página siguiente de actores" }).click();
    await expect(dialogo.locator("button[data-actor-key]")).toHaveCount(10);
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);
  });

  test("las bases temporales se distinguen sin depender del color", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(3, { basis: "mixed" }));
    const bases = await marcadores(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.basis));
    expect(bases).toEqual(["observed_occurrence", "recording_fallback", "sequence_fallback"]);
    const formas = await marcadores(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.shape));
    expect(new Set(formas).size).toBe(3);
    await expect(page.locator('[data-part="timeline"] button[data-event-id="E000003"]')).toHaveAccessibleName(/sin hora/);
    await expect(page.locator('[data-part="timeline"] button[data-event-id="E000002"]')).toHaveAccessibleName(/respaldo de registro/);
  });

  test("la cadena y las bases se rotulan sin fabricar duración", async ({ page }) => {
    await abrirTraza(page);
    await expect(page.locator('[data-part="chain"]')).toContainText("cadena verificada");
    await expect(page.locator('[data-part="chain"]')).toContainText("Prefijo aceptado: 3 hitos");
    const explorador = page.locator("[data-explorer]");
    await expect(explorador).toContainText("ocurrencia observada");
    await expect(explorador).toContainText("respaldo de registro");
    expect(await explorador.textContent()).not.toMatch(/\d+\s*(ms|segundos|minutos)\s*de ejecución/i);
    const hora = page.locator('[data-part="cards"] time').first();
    await expect(hora).toHaveAttribute("datetime", /2026-/);
    await expect(hora).toHaveAttribute("title", /UTC.*Origen:/);
  });

  test("la búsqueda puede ocultar la selección sin perderla", async ({ page }) => {
    await abrirTraza(page);
    await esperarSeleccion(page, "E000003");
    await busqueda(page).fill("E000001");
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(marcadorActual(page)).toHaveAttribute("data-event-id", "E000003");
    const mostrar = page.getByRole("button", { name: "Mostrar hito seleccionado" });
    await expect(mostrar).toBeVisible();
    await mostrar.click();
    await expect(busqueda(page)).toHaveValue("");
    await expect(tarjetas(page)).toHaveCount(3);
    await esperarSeleccion(page, "E000003");
    await expect(page.getByRole("button", { name: "Mostrar hito seleccionado" })).toHaveCount(0);
  });

  for (const [estado, etiqueta] of [
    ["limited", "cadena con limitaciones"],
    ["failed", "cadena no verificada"],
    ["updating", "cadena en actualización"],
  ]) {
    test(`una cadena ${estado} nunca se rotula verificada y muestra diagnósticos`, async ({ page }) => {
      const traza = trazaSintetica(3, { chain: estado });
      traza.valid_prefix_length = 2;
      traza.diagnostics = [{ code: "trace.limited", message: "Línea 3 sin encadenar con el prefijo aceptado." }];
      await abrirTraza(page, traza);
      await expect(page.locator('[data-part="chain"]')).toContainText(etiqueta);
      await expect(page.locator('[data-part="chain"]')).toHaveAttribute("data-chain-status", estado);
      await expect(page.locator('[data-part="diagnostics"]')).toBeVisible();
      await expect(page.locator('[data-part="diagnostics"]')).toContainText("Línea 3 sin encadenar con el prefijo aceptado.");
      expect(await page.locator("#revision").textContent()).not.toContain("cadena verificada");
    });
  }

  test("un actor ausente es «Actor no declarado», nunca el registrador", async ({ page }) => {
    const traza = structuredClone(TRAZA_SINTETICA);
    traza.events[0].actor = null;
    traza.relations = [];
    await abrirTraza(page, traza);
    await expect(actores(page).first()).toContainText("Actor no declarado");
    await expect(page.locator('[data-part="actors"]')).not.toContainText("review_artifacts");
    await expect(page.locator('[data-part="cards"] li[data-event-id="E000001"]')).toContainText("Actor no declarado");
    await page.locator('[data-part="timeline"] button[data-event-id="E000001"]').click();
    await expect(inspector(page)).toContainText("Actor no declarado");
    await expect(inspector(page)).toContainText("Registrador");
    await expect(inspector(page)).toContainText("review_artifacts");
    await expect(inspector(page)).toContainText("Este hito no declara relaciones.");
  });

  test("el inspector distingue actor, registrador y ejecutor y muestra relaciones colgantes", async ({ page }) => {
    await abrirTraza(page);
    await expect(inspector(page)).toContainText("Actor");
    await expect(inspector(page)).toContainText("Registrador");
    await expect(inspector(page)).toContainText("review_artifacts");
    await expect(inspector(page)).toContainText("ejecutor-1");
    const colgante = inspector(page).locator('[data-relation-status="dangling"]');
    await expect(colgante).toHaveCount(1);
    await expect(colgante).toContainText("E000009");
  });

  test("teclado: pasos acotados, último, velocidad, deslizador y actores", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(20, { actors: 10 }));
    await esperarSeleccion(page, "E000020");
    await page.getByRole("button", { name: "Evento anterior" }).focus();
    await page.keyboard.press("Enter");
    await esperarSeleccion(page, "E000019");
    await page.getByRole("slider", { name: "Posición del recorrido" }).focus();
    await page.keyboard.press("Home");
    await esperarSeleccion(page, "E000001");
    // Más pasos atrás no salen del inicio.
    await page.getByRole("button", { name: "Evento anterior" }).focus();
    await page.keyboard.press("Enter");
    await esperarSeleccion(page, "E000001");
    await page.getByRole("button", { name: "Evento siguiente" }).focus();
    await page.keyboard.press("Space");
    await esperarSeleccion(page, "E000002");
    await page.getByRole("button", { name: "Ir al último" }).focus();
    await page.keyboard.press("Enter");
    await esperarSeleccion(page, "E000020");
    await page.getByRole("slider", { name: "Posición del recorrido" }).focus();
    await page.keyboard.press("ArrowLeft");
    await esperarSeleccion(page, "E000019");

    const velocidad = page.getByRole("combobox", { name: "Velocidad" });
    expect(await velocidad.locator("option").evaluateAll((nodos) => nodos.map((n) => n.value))).toEqual(["0.5", "1", "2", "4"]);
    await expect(velocidad).toHaveValue("1");
    await velocidad.focus();
    await page.keyboard.press("ArrowDown");
    await expect(velocidad).toHaveValue("2");

    // La franja sigue al actor del hito seleccionado: E000019 es de agente-8 (accesos 9–10).
    await expect(actores(page)).toHaveCount(2);
    await expect(page.locator('[data-part="actors"] button[aria-current="true"]')).toContainText("agente-8");
    await page.getByRole("slider", { name: "Posición del recorrido" }).focus();
    await page.keyboard.press("Home");
    await esperarSeleccion(page, "E000001");
    // Los diez actores son alcanzables con el teclado: 8 en la franja y el resto al avanzar.
    await expect(actores(page)).toHaveCount(8);
    const siguientes = page.getByRole("button", { name: "Actores siguientes" });
    await siguientes.focus();
    await page.keyboard.press("Enter");
    await expect(actores(page)).toHaveCount(2);
    await expect(actores(page).last()).toContainText("agente-9");
    await actores(page).last().focus();
    await page.keyboard.press("Enter");
    await esperarSeleccion(page, "E000010");
    await page.getByRole("button", { name: "Actores anteriores" }).focus();
    await page.keyboard.press("Enter");
    await expect(actores(page)).toHaveCount(8);
  });

  test("controles con nombre accesible y tarjeta completa", async ({ page }) => {
    await abrirTraza(page);
    for (const nombre of ["Reiniciar", "Evento anterior", "Reproducir", "Evento siguiente", "Ir al último", "Mostrar tarjeta completa", "Seguir recorrido"]) {
      await expect(page.getByRole("button", { name: nombre, exact: true })).toHaveCount(1);
    }
    await expect(page.getByRole("combobox", { name: "Velocidad" })).toHaveCount(1);
    // Al cargar todo está presentado y completo: sin autoplay.
    for (const estado of await tarjetas(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.state))) expect(estado).toBe("complete");
    await page.getByRole("button", { name: "Reiniciar" }).click();
    await esperarSeleccion(page, "E000001");
    await expect(tarjetas(page).nth(0)).toHaveAttribute("data-state", "revealing");
    await expect(tarjetas(page).nth(1)).toHaveAttribute("data-state", "received");
    await page.getByRole("button", { name: "Mostrar tarjeta completa" }).click();
    await expect(tarjetas(page).nth(0)).toHaveAttribute("data-state", "complete");
    await expect(page.getByRole("button", { name: "Reproducir" })).toBeVisible();
  });

  /** Pulsa un botón por su texto sin moverle el foco (`click()` del DOM no enfoca). */
  const pulsarSinFoco = (page, texto) =>
    page.evaluate((t) => [...document.querySelectorAll("[data-explorer] button")].find((b) => b.textContent === t).click(), texto);
  const regionDelFoco = (page) =>
    page.evaluate(() => (document.activeElement === document.body ? "body" : document.activeElement?.closest("[data-part]")?.dataset.part ?? null));

  test("el recorrido que cruza de ventana no retira el foco de un marcador", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(60));
    await page.getByRole("button", { name: "Ventana anterior" }).click();
    await page.locator('[data-part="timeline"] button[data-event-id="E000050"]').click();
    await esperarSeleccion(page, "E000050");
    expect(await page.evaluate(() => document.activeElement?.dataset.eventId)).toBe("E000050");
    await pulsarSinFoco(page, "Reproducir");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000051", { timeout: 6000 });
    await pulsarSinFoco(page, "Pausar");
    expect(await regionDelFoco(page)).toBe("timeline");
    expect(await page.evaluate(() => document.activeElement?.dataset.eventId)).toBe("E000050");

    // Una selección explícita sigue llevando el timeline a la ventana del hito.
    await page.getByRole("button", { name: "Ir al último" }).click();
    await expect(page.locator('[data-part="timeline"]')).toContainText("51–60 de 60");
    await esperarSeleccion(page, "E000060");
  });

  test("el recorrido que cruza de página no retira el foco de una tarjeta", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(60));
    await page.getByRole("button", { name: "Tarjetas anteriores" }).click();
    await page.locator('[data-part="cards"] li[data-event-id="E000050"] button').first().click();
    await esperarSeleccion(page, "E000050");
    await pulsarSinFoco(page, "Reproducir");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000051", { timeout: 6000 });
    await pulsarSinFoco(page, "Pausar");
    expect(await regionDelFoco(page)).toBe("cards");
    expect(await page.evaluate(() => document.activeElement?.closest("li")?.dataset.eventId)).toBe("E000050");
  });

  test("el recorrido que cambia de actor no retira el foco de la franja", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(20, { actors: 10 }));
    await page.getByRole("slider", { name: "Posición del recorrido" }).focus();
    await page.keyboard.press("Home");
    // agente-7 es el último acceso de la primera ventana; su primer hito es E000008.
    await actores(page).filter({ hasText: "agente-7" }).click();
    await esperarSeleccion(page, "E000008");
    await pulsarSinFoco(page, "Reproducir");
    // E000009 es de agente-8, que está en la segunda ventana de la franja.
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000009", { timeout: 6000 });
    await pulsarSinFoco(page, "Pausar");
    expect(await regionDelFoco(page)).toBe("actors");
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("agente-7");
  });

  test("con movimiento reducido las tarjetas quedan completas", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirTraza(page);
    await expect(tarjetas(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Reiniciar" }).click();
    await esperarSeleccion(page, "E000001");
    await expect(tarjetas(page).nth(0)).toHaveAttribute("data-state", "complete");
  });
});
