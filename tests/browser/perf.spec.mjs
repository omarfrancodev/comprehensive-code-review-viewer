import { readFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";

import { expect, test } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { REVISION_SINTETICA, installFakeEventSource, openFixture } from "./support.mjs";

/**
 * Ensayo de LABORATORIO (§12), no una medición de INP de usuarios reales.
 *
 * Modelo de 10 000 eventos ya cargado (Chromium). Tras un calentamiento se
 * hacen 30 interacciones reales de Playwright, alternando: seleccionar un
 * punto del timeline, buscar (una entrada nueva en el buscador) y «Evento
 * siguiente». Cada duración va desde el `timeStamp` del evento de entrada en
 * la página hasta el segundo `requestAnimationFrame` posterior (el fotograma
 * ya pintado con la actualización), medido con `performance.now()` en la
 * página. La carga inicial y la latencia de la API se miden y se imprimen
 * aparte; no entran en el percentil.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
const TOTAL = 10_000;
const CALENTAMIENTO = 6;
const INTERACCIONES = 30;

const percentil = (valores, p) => {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
};

test("laboratorio: p95 < 200 ms de interacción a actualización visible con 10 000 eventos", async ({ page, browserName, browser }) => {
  test.skip(browserName !== "chromium", "ensayo de laboratorio documentado solo en Chromium");
  test.setTimeout(120_000);

  const traza = trazaSintetica(TOTAL, { actors: 60 });
  const cuerpo = JSON.stringify({ api_version: 1, data: traza, diagnostics: [] });
  await installFakeEventSource(page);
  await page.addInitScript(() => {
    // Instrumentación solo de prueba: una muestra por entrada del usuario.
    window.__muestras = [];
    window.__medir = false;
    const registrar = (evento) => {
      if (!window.__medir || !evento.isTrusted) return;
      const inicio = evento.timeStamp;
      const tipo = evento.type;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.__muestras.push({ tipo, ms: performance.now() - inicio });
      }));
    };
    for (const tipo of ["click", "input"]) document.addEventListener(tipo, registrar, { capture: true });
  });
  await page.route("**/api/runs/*/trace", (ruta) => ruta.fulfill({ status: 200, contentType: "application/json", body: cuerpo }));

  const inicioCarga = Date.now();
  await openFixture(page, { ruta: `/?run=${CLAVE}&tab=trazabilidad` });
  await expect(page.locator('[data-part="cards"] li[aria-current="true"]')).toHaveAttribute("data-event-id", "E010000", { timeout: 30_000 });
  const cargaInicialMs = Date.now() - inicioCarga;
  const api = await page.evaluate(() => {
    const traza = performance.getEntriesByType("resource").find((e) => e.name.endsWith("/trace"));
    return traza ? { duracion: traza.duration, bytes: traza.transferSize || traza.decodedBodySize } : null;
  });
  // Render acotado: nunca más de 50 tarjetas ni 50 marcadores montados.
  expect(await page.locator('[data-part="cards"] li[data-event-id]').count()).toBeLessThanOrEqual(50);
  expect(await page.locator('[data-part="timeline"] button[data-event-id]').count()).toBeLessThanOrEqual(50);

  const marcadores = page.locator('[data-part="timeline"] button[data-event-id]');
  const buscador = page.getByRole("searchbox", { name: "Buscar hitos" });
  const siguiente = page.getByRole("button", { name: "Evento siguiente", exact: true });
  // El inspector refleja la selección aunque la búsqueda oculte su tarjeta.
  const actual = page.locator('#inspector [data-part="inspector"]');

  /** Una interacción por turno; cada una comprueba su resultado visible. */
  async function interaccion(i) {
    const turno = i % 3;
    if (turno === 0) {
      const n = await marcadores.count();
      const boton = marcadores.nth((i * 7) % n);
      const id = await boton.getAttribute("data-event-id");
      await boton.click();
      await expect(actual).toHaveAttribute("data-event-id", id);
    } else if (turno === 1) {
      // Consulta distinta cada vez: recorre el modelo completo (10 000 eventos).
      const consulta = i % 2 === 0 ? `agente-${i % 60}` : `Evento sintético ${(i * 331) % TOTAL + 1}`;
      await buscador.fill(consulta);
      await expect(page.locator('[data-part="search"] .busqueda-estado')).toContainText("coincidencia");
    } else {
      const antes = await actual.getAttribute("data-event-id");
      await siguiente.click();
      await expect(actual).not.toHaveAttribute("data-event-id", antes);
    }
  }

  // Calentamiento: JIT, estilos y cachés de la página.
  await page.locator('[data-part="timeline"] button[data-event-id]').first().click();
  for (let i = 0; i < CALENTAMIENTO; i += 1) await interaccion(i);

  await page.evaluate(() => {
    window.__muestras = [];
    window.__medir = true;
  });
  for (let i = 0; i < INTERACCIONES; i += 1) await interaccion(i);
  await page.waitForTimeout(200);
  const muestras = await page.evaluate(() => {
    window.__medir = false;
    return window.__muestras;
  });
  const valores = muestras.map((m) => m.ms);
  expect(valores.length).toBe(INTERACCIONES);

  const procesador = cpus();
  const entorno = {
    cpu: procesador[0]?.model?.trim() ?? "desconocida",
    nucleos: procesador.length,
    memoriaGiB: Math.round(totalmem() / 2 ** 30),
    plataforma: `${process.platform} ${process.arch}`,
    node: process.version,
    playwright: JSON.parse(readFileSync(new URL("../../node_modules/@playwright/test/package.json", import.meta.url), "utf8")).version,
    navegador: `${browserName} ${browser.version()}`,
    userAgent: await page.evaluate(() => navigator.userAgent),
    nucleosNavegador: await page.evaluate(() => navigator.hardwareConcurrency),
  };
  const porTipo = {};
  for (const m of muestras) (porTipo[m.tipo] ??= []).push(m.ms);
  const resumen = {
    ensayo: "laboratorio (no INP)",
    eventos: TOTAL,
    muestras: valores.length,
    p50: Number(percentil(valores, 50).toFixed(1)),
    p95: Number(percentil(valores, 95).toFixed(1)),
    max: Number(Math.max(...valores).toFixed(1)),
    porTipo: Object.fromEntries(Object.entries(porTipo).map(([tipo, v]) => [tipo, {
      n: v.length,
      p50: Number(percentil(v, 50).toFixed(1)),
      p95: Number(percentil(v, 95).toFixed(1)),
      max: Number(Math.max(...v).toFixed(1)),
    }])),
    separado: { cargaInicialMs, apiTraza: api },
    entorno,
  };
  console.log(`[perf] ${JSON.stringify(resumen, null, 2)}`);
  test.info().annotations.push({ type: "perf", description: JSON.stringify(resumen) });
  expect(resumen.p95).toBeLessThan(200);
});
