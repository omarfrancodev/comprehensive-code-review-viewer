import { expect, test } from "@playwright/test";

import { REVISION_SINTETICA, TRAZA_SINTETICA, openFixture } from "./support.mjs";

/**
 * Shell: tabs con activación manual, ruta local acotada, historial, layout por
 * anchos, preferencias locales y diálogo del contexto de raíz.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
const responder = (ruta, data, status = 200) =>
  ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
const conTraza = (page) => page.route("**/api/runs/*/trace", (ruta) => responder(ruta, { api_version: 1, data: TRAZA_SINTETICA }));
const pestana = (page, nombre) => page.getByRole("tab", { name: nombre, exact: true });
const busqueda = (page) => new URL(page.url()).search;

async function abrirRevision(page) {
  await page.locator(".lista-revisiones button").first().click();
  await expect(pestana(page, "Resumen")).toHaveAttribute("aria-selected", "true");
}

test.describe("tabs", () => {
  test("flechas mueven el foco sin activar; Enter/Espacio activan; Home/End", async ({ page }) => {
    await openFixture(page);
    await abrirRevision(page);
    const resumen = pestana(page, "Resumen");
    const hallazgos = pestana(page, "Hallazgos");
    const validacion = pestana(page, "Validación");
    const archivo = pestana(page, "Archivo");

    await resumen.focus();
    await page.keyboard.press("ArrowRight");
    await expect(hallazgos).toBeFocused();
    await expect(resumen).toHaveAttribute("aria-selected", "true");
    await expect(hallazgos).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Enter");
    await expect(hallazgos).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#revision")).toContainText("Confirmados (1)");
    await expect(hallazgos).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(validacion).toBeFocused();
    await expect(validacion).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press(" ");
    await expect(validacion).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#revision")).toContainText("C001");

    await page.keyboard.press("End");
    await expect(archivo).toBeFocused();
    await expect(archivo).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Home");
    await expect(resumen).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(archivo).toBeFocused();
    await expect(validacion).toHaveAttribute("aria-selected", "true");

    // Tabulación itinerante: solo la pestaña activa entra en el orden del tabulador.
    const indices = await page.getByRole("tab").evaluateAll((tabs) =>
      tabs.map((tab) => [tab.getAttribute("aria-selected"), tab.tabIndex]),
    );
    for (const [seleccionada, indice] of indices) expect(indice).toBe(seleccionada === "true" ? 0 : -1);
  });

  test("cada tab enlaza aria-controls con un tabpanel etiquetado por la pestaña activa", async ({ page }) => {
    await openFixture(page);
    await abrirRevision(page);
    await pestana(page, "Documentos").click();
    const enlaces = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((tab) => {
        const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
        return {
          id: tab.id,
          seleccionada: tab.getAttribute("aria-selected") === "true",
          rolPanel: panel?.getAttribute("role") ?? null,
          etiquetaPanel: panel?.getAttribute("aria-labelledby") ?? null,
        };
      }),
    );
    expect(enlaces).toHaveLength(7);
    for (const enlace of enlaces) {
      expect(enlace.id).not.toBe("");
      expect(enlace.rolPanel).toBe("tabpanel");
    }
    const activa = enlaces.filter((enlace) => enlace.seleccionada);
    expect(activa).toHaveLength(1);
    expect(activa[0].etiquetaPanel).toBe(activa[0].id);
    await expect(page.getByRole("tabpanel", { name: "Documentos" })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveAttribute("aria-label", /.+/);
  });
});

test.describe("ruta local", () => {
  test("?run&tab selecciona la revisión y la pestaña y elimina el fragmento", async ({ page }) => {
    await openFixture(page, { ruta: `/?run=${CLAVE}&tab=hallazgos` });
    await expect(pestana(page, "Hallazgos")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`.lista-revisiones button[data-key="${CLAVE}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#revision")).toContainText("Validación de entrada ausente");
    expect(busqueda(page)).toBe(`?run=${CLAVE}&tab=hallazgos`);
    expect(page.url()).not.toContain("#");
    expect(page.url()).not.toContain("token");
  });

  test("?run=zzz no selecciona nada y avisa", async ({ page }) => {
    // La región polite es de un solo mensaje: se registran todos los anuncios.
    await page.addInitScript(() => {
      window.__anuncios = [];
      document.addEventListener("DOMContentLoaded", () => {
        const region = document.getElementById("anunciador");
        new MutationObserver(() => window.__anuncios.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
      });
    });
    await openFixture(page, { ruta: "/?run=zzz" });
    await expect(page.locator("#revision")).toContainText("no corresponde a una revisión disponible");
    await expect(page.locator('.lista-revisiones button[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator("#anunciador")).toHaveAttribute("aria-live", "polite");
    const anuncios = await page.evaluate(() => window.__anuncios);
    expect(anuncios.filter((texto) => texto.includes("no corresponde a una revisión disponible"))).toHaveLength(1);
    expect(busqueda(page)).toBe("");
  });

  test("una clave bien formada pero ausente (404 unknown_id) avisa y no queda seleccionada", async ({ page }) => {
    await openFixture(page);
    const ausente = "b".repeat(32);
    await page.route(`**/api/runs/${ausente}`, (ruta) =>
      responder(ruta, { api_version: 1, error: { code: "unknown_id", message: "Identificador de corrida desconocido." } }, 404),
    );
    await page.goto(`/?run=${ausente}&tab=archivo#token=token-sintetico`);
    await expect(page.locator("#revision")).toContainText("no corresponde a una revisión disponible");
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.locator("#biblioteca .lista-revisiones button")).toHaveCount(1);
    await expect.poll(() => busqueda(page)).toBe("");
  });

  for (const [status, code, mensaje] of [
    [500, "read_failed", "Lectura sintética fallida del archivo."],
    [403, "session_required", "Sesión sintética caducada."],
  ]) {
    test(`un fallo ${status} ${code} al abrir por ruta conserva la URL y muestra su mensaje real`, async ({ page }) => {
      await openFixture(page);
      const clave = "c".repeat(32);
      await page.route(`**/api/runs/${clave}`, (ruta) =>
        responder(ruta, { api_version: 1, error: { code, message: mensaje } }, status),
      );
      await page.goto(`/?run=${clave}&tab=archivo#token=token-sintetico`);
      await expect(page.locator("#revision")).toContainText(mensaje);
      await expect(page.locator("#revision")).not.toContainText("no corresponde a una revisión disponible");
      await expect(page.locator("#anunciador")).not.toContainText("no corresponde a una revisión disponible");
      expect(busqueda(page)).toBe(`?run=${clave}&tab=archivo`);
      await expect(pestana(page, "Archivo")).toHaveAttribute("aria-selected", "true");
    });
  }

  test("la clave de la URL deja de estar pendiente si la selección cambia antes de resolverse", async ({ page }) => {
    await openFixture(page);
    const otra = "d".repeat(32);
    const resumenOtra = { ...REVISION_SINTETICA.summary, key: otra, scope_label: "pr 43" };
    await page.route("**/api/runs?*", (ruta) =>
      responder(ruta, { api_version: 1, data: { items: [REVISION_SINTETICA.summary, resumenOtra], total: 2, offset: 0, limit: 50, truncated: false } }),
    );
    // La primera lectura de `otra` (la de la ruta) queda retenida hasta que la
    // prueba la libera. La segunda, de un clic normal, responde 404: aunque sea
    // una corrida ausente, ya no viene de la URL y no debe vaciar la selección.
    let liberar;
    const retenida = new Promise((resolver) => { liberar = resolver; });
    let lecturas = 0;
    await page.route(`**/api/runs/${otra}`, async (ruta) => {
      lecturas += 1;
      if (lecturas === 1) {
        await retenida;
        await responder(ruta, { api_version: 1, error: { code: "read_failed", message: "Lectura retenida sintética." } }, 500);
        return;
      }
      await responder(ruta, { api_version: 1, error: { code: "unknown_id", message: "Fallo sintético tras la selección." } }, 404);
    });
    await page.goto(`/?run=${otra}#token=token-sintetico`);
    await expect.poll(() => lecturas).toBe(1);
    await page.locator(`.lista-revisiones button[data-key="${CLAVE}"]`).click();
    await expect(page.locator("#revision")).toContainText("Revisión sintética de validación");
    const tardia = page.waitForResponse((respuesta) => respuesta.url().endsWith(`/api/runs/${otra}`));
    liberar();
    await tardia;
    // La respuesta tardía de la ruta se descarta; después, un clic normal en
    // `otra` que falla no se clasifica como una ruta ausente.
    await expect(page.locator("#revision")).toContainText("Revisión sintética de validación");
    await page.locator(`.lista-revisiones button[data-key="${otra}"]`).click();
    await expect(page.locator("#revision")).toContainText("Fallo sintético tras la selección.");
    await expect(pestana(page, "Resumen")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#revision")).not.toContainText("no corresponde a una revisión disponible");
    expect(busqueda(page)).toBe(`?run=${otra}&tab=ficha`);
  });

  test("el hito seleccionado viaja en la URL con replaceState y se restaura al recargar", async ({ page }) => {
    await conTraza(page);
    await openFixture(page);
    await abrirRevision(page);
    await pestana(page, "Trazabilidad").click();
    await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E000003");
    const longitud = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Evento anterior" }).click();
    await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E000002");
    await expect.poll(() => busqueda(page)).toBe(`?run=${CLAVE}&tab=trazabilidad&event=E000002`);
    expect(await page.evaluate(() => history.length)).toBe(longitud);

    await page.reload();
    await expect(pestana(page, "Trazabilidad")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E000002");
  });
});

test("historial: Atrás restaura la pestaña anterior sin reproducir", async ({ page }) => {
  await conTraza(page);
  await openFixture(page);
  await abrirRevision(page);
  await pestana(page, "Trazabilidad").click();
  await expect(page.locator('[data-part="cards"] li[data-event-id]')).toHaveCount(3);
  await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E000003");
  await pestana(page, "Hallazgos").click();
  await expect.poll(() => busqueda(page)).toBe(`?run=${CLAVE}&tab=hallazgos`);

  await page.goBack();
  await expect(pestana(page, "Trazabilidad")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-part="cards"] li[data-event-id]')).toHaveCount(3);
  expect(busqueda(page)).toBe(`?run=${CLAVE}&tab=trazabilidad`);
  // Sin reproducción automática: la selección no avanza ni retrocede sola.
  await page.waitForTimeout(1200);
  await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E000003");

  await page.goBack();
  await expect(pestana(page, "Resumen")).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator('.lista-revisiones button[aria-pressed="true"]')).toHaveCount(0);
  await page.goForward();
  await expect(pestana(page, "Resumen")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`.lista-revisiones button[data-key="${CLAVE}"]`)).toHaveAttribute("aria-pressed", "true");
});

test("layout: sin scroll horizontal a 1440, 1024, 768 y 375 px", async ({ page }) => {
  await openFixture(page);
  await abrirRevision(page);
  const anchoBiblioteca = () => page.locator("#panel-biblioteca").evaluate((nodo) => nodo.getBoundingClientRect().width);
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `sin desborde a ${width}px`).toBe(true);
    if (width === 1440) {
      const ancho = await anchoBiblioteca();
      expect(ancho).toBeGreaterThanOrEqual(280);
      expect(ancho).toBeLessThanOrEqual(320);
    }
    if (width === 1024) expect(Math.round(await anchoBiblioteca())).toBe(240);
  }
});

test("layout: a 375 px la biblioteca es un desplegable con retorno a la revisión", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openFixture(page);
  const conmutador = page.getByRole("button", { name: "Biblioteca", exact: true });
  await expect(page.locator("#biblioteca")).toBeVisible();
  await page.locator(".lista-revisiones button").first().click();
  await expect(page.locator("#biblioteca")).toBeHidden();
  await expect(conmutador).toHaveAttribute("aria-expanded", "false");
  await expect(pestana(page, "Resumen")).toBeFocused();

  await conmutador.click();
  await expect(conmutador).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#biblioteca")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Volver a la revisión" }).click();
  await expect(page.locator("#biblioteca")).toBeHidden();
  await expect(pestana(page, "Resumen")).toBeFocused();
});

test("preferencias: tema, densidad y movimiento persisten con una única clave", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator("#tema option")).toHaveText(["Sistema", "Claro", "Oscuro"]);
  expect(await page.locator("#tema option").evaluateAll((o) => o.map((n) => n.value))).toEqual(["system", "light", "dark"]);
  await page.locator("#tema").selectOption("dark");
  await page.getByRole("button", { name: "Preferencias" }).click();
  const dialogo = page.getByRole("dialog", { name: "Preferencias" });
  await dialogo.getByLabel("Densidad").selectOption("compact");
  await dialogo.getByLabel("Movimiento").selectOption("reduce");
  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);

  await page.reload();
  await page.waitForSelector("#biblioteca .lista-revisiones button");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-density", "compact");
  await expect(html).toHaveAttribute("data-motion", "reduce");
  await expect(page.locator("#tema")).toHaveValue("dark");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["ccr-viewer:prefs"]);

  await page.getByRole("button", { name: "Preferencias" }).click();
  await expect(page.getByLabel("Densidad")).toHaveValue("compact");
  await expect(page.getByLabel("Movimiento")).toHaveValue("reduce");
});

test("localStorage bloqueado: la app arranca con valores por defecto", async ({ page }) => {
  const errores = [];
  page.on("pageerror", (error) => errores.push(error.message));
  await page.addInitScript(() => {
    const bloqueado = () => { throw new DOMException("almacenamiento bloqueado", "SecurityError"); };
    Storage.prototype.getItem = bloqueado;
    Storage.prototype.setItem = bloqueado;
  });
  await openFixture(page);
  const html = page.locator("html");
  await expect(page.locator("#tema")).toHaveValue("system");
  await expect(html).not.toHaveAttribute("data-theme", /.*/);
  await expect(html).not.toHaveAttribute("data-density", /.*/);
  await expect(html).not.toHaveAttribute("data-motion", /.*/);
  await page.locator("#tema").selectOption("light");
  await expect(html).toHaveAttribute("data-theme", "light");
  await abrirRevision(page);
  expect(errores).toEqual([]);
});

test("contexto de raíz: diálogo con la ruta completa, Escape y retorno del foco", async ({ page }) => {
  await openFixture(page);
  const boton = page.locator("#raiz");
  await expect(boton).toContainText("sintetico");
  await boton.click();
  const dialogo = page.getByRole("dialog", { name: "Contexto de raíz" });
  await expect(dialogo).toBeVisible();
  expect(await dialogo.evaluate((nodo) => nodo.tagName)).toBe("DIALOG");
  await expect(dialogo).toContainText("C:/archivo/sintetico");
  await expect(dialogo).toContainText("explicit");
  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);
  await expect(boton).toBeFocused();
});
