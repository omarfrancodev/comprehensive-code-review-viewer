import { test, expect } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { REVISION_SINTETICA, TRAZA_SINTETICA, installFakeEventSource, openFixture } from "./support.mjs";

/**
 * VS-01 (§3, §12): matriz de anchos × temas × densidades y capturas de los
 * estados que exigen inspección visual. Las capturas van a `test-results/`
 * (ignorado por Git) y se revisan a mano; las aserciones cubren lo medible:
 * sin scroll horizontal de página, controles principales visibles y objetivos
 * táctiles de al menos 24×24 CSS px.
 *
 * Los avisos llegan por una `EventSource` falsa que se mantiene abierta: el
 * canal sintético por omisión se cierra y reconecta cada pocos segundos y
 * haría parpadear la banda «Datos no actualizados» en las capturas.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
// 320 px equivale a 1280 px con zoom 400 %; 640 px, a zoom 200 %.
const ANCHOS = [320, 375, 640, 768, 1024, 1440, 1920];
const TEMAS = ["light", "dark"];
const DENSIDADES = ["comfortable", "compact"];

const sobre = (data) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data, diagnostics: [] }) });

function vistaCon(estado) {
  const vista = structuredClone(REVISION_SINTETICA);
  vista.closure = { ...vista.closure, state: estado };
  return vista;
}

/** Sin scroll horizontal de página: el documento nunca es más ancho que la ventana. */
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/**
 * Controles interactivos pintados con menos de 24×24 CSS px. Se excluyen los
 * enlaces dentro de un párrafo de texto (excepción «en línea» de WCAG 2.5.8) y
 * los nodos solo para lectores de pantalla.
 */
function objetivosPequenos() {
  const pequenos = [];
  let revisados = 0;
  const selector = 'button, select, input:not([type="hidden"]), [role="tab"], summary, a[href], [tabindex="0"]';
  for (const nodo of document.querySelectorAll(selector)) {
    if (nodo.closest(".solo-lectores, [hidden], dialog:not([open])")) continue;
    const estilo = getComputedStyle(nodo);
    if (estilo.visibility === "hidden" || estilo.display === "none") continue;
    const caja = nodo.getBoundingClientRect();
    if (caja.width === 0 && caja.height === 0) continue;
    if (nodo.matches("a.saltar") && caja.bottom < 0) continue;
    if (nodo.tagName === "A" && nodo.closest("p, li") && nodo.parentElement.textContent.trim() !== nodo.textContent.trim()) continue;
    revisados += 1;
    if (caja.width < 23.5 || caja.height < 23.5) {
      const nombre = (nodo.getAttribute("aria-label") ?? nodo.textContent ?? "").trim().slice(0, 30);
      pequenos.push(`${nodo.tagName.toLowerCase()}.${String(nodo.className).split(" ")[0]} «${nombre}» ${caja.width.toFixed(0)}×${caja.height.toFixed(0)}`);
    }
  }
  return { revisados, pequenos };
}

async function fijarDensidad(page, densidad) {
  await page.getByRole("button", { name: "Preferencias" }).click();
  const dialogo = page.getByRole("dialog", { name: "Preferencias" });
  await dialogo.getByLabel("Densidad").selectOption(densidad);
  await page.keyboard.press("Escape");
  await expect(dialogo).toHaveCount(0);
  // La densidad cómoda es la de omisión: sin atributo.
  if (densidad === "compact") await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  else await expect(page.locator("html")).not.toHaveAttribute("data-density", "compact");
}

async function fijarTema(page, tema) {
  await page.locator("#tema").selectOption(tema);
  if (tema === "system") await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  else await expect(page.locator("html")).toHaveAttribute("data-theme", tema);
}

/** En una columna (< 800 px) la biblioteca es un desplegable: se pliega para ver la revisión. */
async function mostrarRevision(page) {
  const conmutador = page.locator("#abrir-biblioteca");
  if (await conmutador.isVisible() && (await conmutador.getAttribute("aria-expanded")) === "true" && await page.locator("#volver-revision").isVisible()) {
    await page.locator("#volver-revision").click();
  }
}

/**
 * Abre la revisión sintética en Trazabilidad. `cierre`: estado del cierre;
 * `traza`: respuesta de `/trace` o `null` para un fallo de lectura.
 */
async function abrir(page, { cierre = "complete", traza = TRAZA_SINTETICA, library = null, reloj = false } = {}) {
  await installFakeEventSource(page);
  if (reloj) await page.clock.install();
  await page.route("**/api/runs/*/trace", (ruta) => (traza === null
    ? ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ api_version: 1, error: { code: "read_failed", message: "Lectura sintética fallida de la traza." } }) })
    : ruta.fulfill(sobre(traza))));
  await openFixture(page, {
    ruta: library ? "/" : `/?run=${CLAVE}&tab=trazabilidad`,
    library,
    // Con una revisión en la ruta, la biblioteca nace plegada en una columna.
    esperar: Boolean(library),
    onRun: (ruta) => ruta.fulfill(sobre(vistaCon(cierre))),
  });
  if (library) return;
  await expect(page.locator("#cabecera-revision h2")).toBeVisible({ timeout: 15_000 });
  if (traza !== null) {
    await expect(page.locator("[data-explorer]")).toBeVisible();
    await expect(page.locator('[data-part="live"]')).not.toHaveAttribute("data-availability", "verifying", { timeout: 8000 });
  }
}

test("navegación y texto permanecen accesibles a 375, 768, 900, 1024 y 1440 px en todos los temas", async ({ page }, info) => {
  await abrir(page);
  await expect(page.locator('[data-part="cards"] li[data-event-id]')).toHaveCount(3);
  for (const width of [375, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width === 375) {
      // En una columna la biblioteca es un desplegable que no desborda la página.
      await page.getByRole("button", { name: /biblioteca/i }).click();
      await expect(page.locator("#biblioteca")).toBeVisible();
    }
    for (const theme of ["system", "light", "dark"]) {
      await fijarTema(page, theme);
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

test("VS-01: matriz 320–1920 px × claro/oscuro × cómoda/compacta sin desborde, con controles visibles y objetivos ≥ 24×24", async ({ page }, info) => {
  test.setTimeout(180_000);
  await abrir(page, { cierre: "processing", traza: trazaSintetica(60, { actors: 12, chain: "updating" }) });
  await page.getByRole("button", { name: "En Vivo", exact: true }).click();
  const fallos = [];
  for (const densidad of DENSIDADES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fijarDensidad(page, densidad);
    for (const tema of TEMAS) {
      await fijarTema(page, tema);
      for (const ancho of ANCHOS) {
        const caso = `${ancho}px ${tema} ${densidad}`;
        await page.setViewportSize({ width: ancho, height: 900 });
        await mostrarRevision(page);
        if (!(await sinDesborde(page))) fallos.push(`${caso}: scroll horizontal de página`);
        for (const [nombre, control] of [
          ["pestaña Trazabilidad", page.getByRole("tab", { name: "Trazabilidad" })],
          ["pestaña Archivo", page.getByRole("tab", { name: "Archivo", exact: true })],
          ["controles", page.getByRole("group", { name: "Controles de reproducción" })],
          ["En Vivo", page.getByRole("button", { name: "En Vivo", exact: true })],
          ["buscador", page.getByRole("searchbox", { name: "Buscar hitos" })],
          ["timeline", page.getByRole("group", { name: "Secuencia global de hitos" })],
          ["tema", page.locator("#tema")],
          ["preferencias", page.getByRole("button", { name: "Preferencias" })],
          ["biblioteca", page.locator("#abrir-biblioteca")],
        ]) {
          if (nombre === "biblioteca" && ancho >= 800) continue;
          if (!(await control.isVisible())) fallos.push(`${caso}: ${nombre} no visible`);
        }
        // Ningún control principal cortado por el borde derecho de la ventana.
        // Un control dentro de un contenedor con desplazamiento horizontal propio
        // (p. ej. la pista del timeline) es alcanzable desplazándolo: no cuenta.
        const cortados = await page.evaluate(() => [...document.querySelectorAll(".cabecera button, .cabecera select, [role=tab], [data-part=controls] button, [data-part=controls] select, [data-part=live] button, [data-part=search] input")]
          .filter((n) => n.getClientRects().length > 0 && !n.closest("[hidden]"))
          .filter((n) => {
            for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
              if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) return false;
            }
            const caja = n.getBoundingClientRect();
            return caja.right > innerWidth + 1 || caja.left < -1;
          })
          .map((n) => (n.getAttribute("aria-label") ?? n.textContent).trim().slice(0, 24)));
        for (const nombre of cortados) fallos.push(`${caso}: control cortado «${nombre}»`);
        const objetivos = await page.evaluate(objetivosPequenos);
        // La medida no es vacía: timeline, controles, tarjetas, cabecera e inspector.
        expect(objetivos.revisados, caso).toBeGreaterThan(40);
        for (const pequeno of objetivos.pequenos) fallos.push(`${caso}: objetivo pequeño ${pequeno}`);
        await page.screenshot({ path: info.outputPath(`matriz-${ancho}-${tema}-${densidad}.png`), fullPage: true });
        if (ancho < 800) {
          // La biblioteca desplegable tampoco desborda.
          await page.locator("#abrir-biblioteca").click();
          await expect(page.locator("#biblioteca")).toBeVisible();
          if (!(await sinDesborde(page))) fallos.push(`${caso}: la biblioteca desplegada desborda`);
          for (const pequeno of (await page.evaluate(objetivosPequenos)).pequenos) fallos.push(`${caso} (biblioteca): objetivo pequeño ${pequeno}`);
          await page.locator("#volver-revision").click();
        }
      }
    }
  }
  expect([...new Set(fallos)]).toEqual([]);
});

test.describe("VS-01: capturas de estados para inspección visual", () => {
  for (const tema of TEMAS) {
    for (const ancho of [375, 1440]) {
      const caso = `${ancho}-${tema}`;

      test(`último hito con carga (processing, En Vivo) · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { cierre: "processing", traza: { ...TRAZA_SINTETICA, chain_status: "updating" } });
        await fijarTema(page, tema);
        await mostrarRevision(page);
        await page.getByRole("button", { name: "En Vivo", exact: true }).click();
        const ultima = page.locator('[data-part="cards"] li[data-event-id="E000003"]');
        await expect(ultima).toHaveAttribute("data-active-source", "true");
        await expect(ultima.locator('[data-part="source-loader"]')).toContainText("Último hito activo · revisión en procesamiento");
        await expect(ultima.locator('[data-part="source-loader"]')).toBeVisible();
        expect(await sinDesborde(page)).toBe(true);
        await ultima.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`carga-ultimo-${caso}.png`), fullPage: true });
        await ultima.screenshot({ path: info.outputPath(`carga-ultimo-tarjeta-${caso}.png`) });
      });

      test(`dos etapas del revelado (~25 % y ~55 %) · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { reloj: true });
        await page.clock.pauseAt(new Date(Date.now() + 60_000));
        await fijarTema(page, tema);
        await mostrarRevision(page);
        await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
        const primera = page.locator('[data-part="cards"] li[data-event-id="E000001"]');
        await expect(primera).toHaveAttribute("data-state", "revealing");
        await page.getByRole("button", { name: "Reproducir", exact: true }).click();
        const etapa = (nombre) => primera.evaluate((li, p) => Number.parseFloat(li.style.getPropertyValue(p)), `--etapa-${nombre}`);
        // 1800 ms a 1×: ~25 % = 450 ms, ~55 % = 990 ms.
        await page.clock.runFor(450);
        expect(await etapa("estructura")).toBeGreaterThan(0.9);
        expect(await etapa("contenido")).toBeLessThan(0.3);
        expect(await etapa("acciones")).toBe(0);
        await primera.scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`revelado-25-${caso}.png`), fullPage: true });
        await primera.screenshot({ path: info.outputPath(`revelado-25-tarjeta-${caso}.png`) });
        await page.clock.runFor(540);
        const contenido = await etapa("contenido");
        expect(contenido).toBeGreaterThan(0.3);
        expect(contenido).toBeLessThan(0.9);
        expect(await etapa("cabecera")).toBe(1);
        await page.screenshot({ path: info.outputPath(`revelado-55-${caso}.png`), fullPage: true });
        await primera.screenshot({ path: info.outputPath(`revelado-55-tarjeta-${caso}.png`) });
        expect(await sinDesborde(page)).toBe(true);
      });

      test(`vacíos: sin hitos en processing y biblioteca vacía · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { cierre: "processing", traza: { events: [], valid_prefix_length: 0, chain_status: "updating", relations: [], diagnostics: [] } });
        await fijarTema(page, tema);
        await mostrarRevision(page);
        await expect(page.locator('[data-part="empty"]')).toHaveText("Esperando el primer registro");
        expect(await sinDesborde(page)).toBe(true);
        await page.screenshot({ path: info.outputPath(`vacio-traza-${caso}.png`), fullPage: true });
      });

      test(`biblioteca vacía · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { library: { items: [], total: 0 } });
        await fijarTema(page, tema);
        await expect(page.locator('#biblioteca [data-estado="vacia"]')).toBeVisible();
        expect(await sinDesborde(page)).toBe(true);
        await page.screenshot({ path: info.outputPath(`vacio-biblioteca-${caso}.png`), fullPage: true });
      });

      test(`error de lectura de la traza · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { traza: null });
        await fijarTema(page, tema);
        await mostrarRevision(page);
        await expect(page.locator("#revision .estado--error")).toContainText("No se pudo leer la trazabilidad");
        expect(await sinDesborde(page)).toBe(true);
        await page.screenshot({ path: info.outputPath(`error-traza-${caso}.png`), fullPage: true });
      });

      test(`revisión cerrada (complete) · ${caso}`, async ({ page }, info) => {
        await page.setViewportSize({ width: ancho, height: 900 });
        await abrir(page, { cierre: "complete" });
        await fijarTema(page, tema);
        await mostrarRevision(page);
        await expect(page.getByRole("button", { name: "En Vivo", exact: true })).toBeDisabled();
        await expect(page.locator('[data-part="live-reason"]')).toContainText("no está en procesamiento");
        await expect(page.locator('[data-part="source-loader"]')).toHaveCount(0);
        expect(await sinDesborde(page)).toBe(true);
        await page.screenshot({ path: info.outputPath(`cerrada-${caso}.png`), fullPage: true });
      });
    }
  }
});
