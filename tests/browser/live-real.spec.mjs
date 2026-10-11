import { expect, test } from "@playwright/test";

import { fixtureOperation, inventory, startFixtureServer } from "./server.mjs";

/**
 * LV-03 con el servidor Python real (§8, §8.1, §12): ninguna ruta de la API se
 * intercepta. El archivo sintético lo cambia el productor de prueba
 * (`fixtureOperation`), nunca el visor; el colector del servidor sondea cada
 * 2 s, así que las esperas son de varios segundos.
 *
 * La reconexión se simula cortando el canal SSE desde el cliente: una
 * envoltura de prueba (solo vía `addInitScript`) cierra la `EventSource`
 * nativa —el servidor da de baja al suscriptor— y después abre otra contra el
 * mismo servidor. La aplicación ve la caída (`error`) y la reapertura (`open`)
 * igual que con un corte real.
 */

const ETIQUETA_ACTIVO = "Último hito activo · revisión en procesamiento";
const ESPERA_SONDEO = { timeout: 20_000 };

const tarjetas = (page) => page.locator('[data-part="cards"] li[data-event-id]');
const tarjeta = (page, id) => page.locator(`[data-part="cards"] li[data-event-id="${id}"]`);
const actual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');
const enVivo = (page) => page.getByRole("button", { name: "En Vivo", exact: true });
const motivo = (page) => page.locator('[data-part="live-reason"]');
const contador = (page) => page.locator('[data-part="pending-count"]');
const cargas = (page) => page.locator('[data-part="cards"] [data-part="source-loader"]');
const disponibilidad = (page) => page.locator('[data-part="live"]');

/** IDs de las tarjetas montadas, en orden. */
const idsDeTarjetas = (page) => tarjetas(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.eventId));

/** Envoltura de `EventSource` que permite cortar y reabrir el canal real. */
async function instalarCanalCortable(page) {
  await page.addInitScript(() => {
    const Nativa = window.EventSource;
    const control = { fuentes: [], aperturas: 0 };
    class FuenteCortable extends EventTarget {
      constructor(url, opciones) {
        super();
        this.url = String(url);
        this.opciones = opciones;
        this.onopen = null;
        this.onerror = null;
        this.readyState = 0;
        this.cerrada = false;
        control.fuentes.push(this);
        this.abrir();
      }
      abrir() {
        const nativa = new Nativa(this.url, this.opciones);
        this.nativa = nativa;
        control.aperturas += 1;
        nativa.onopen = (evento) => {
          this.readyState = 1;
          this.onopen?.(evento);
        };
        nativa.onerror = (evento) => {
          this.readyState = nativa.readyState;
          this.onerror?.(evento);
        };
        nativa.addEventListener("notice", (evento) => {
          this.dispatchEvent(new MessageEvent("notice", { data: evento.data, lastEventId: evento.lastEventId }));
        });
      }
      cortar() {
        this.nativa?.close();
        this.nativa = null;
        this.readyState = 0;
        this.onerror?.(new Event("error"));
      }
      close() {
        this.cerrada = true;
        this.readyState = 2;
        this.nativa?.close();
      }
    }
    window.EventSource = FuenteCortable;
    window.__canal = {
      cortar() {
        for (const fuente of control.fuentes) if (!fuente.cerrada) fuente.cortar();
      },
      reabrir() {
        for (const fuente of control.fuentes) if (!fuente.cerrada && !fuente.nativa) fuente.abrir();
      },
      get aperturas() {
        return control.aperturas;
      },
    };
  });
}

/** Abre la única corrida del archivo en Trazabilidad y espera la lectura coherente inicial. */
async function abrirTrazabilidad(page, servidor) {
  await page.goto(servidor.url);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();
  await expect(disponibilidad(page)).not.toHaveAttribute("data-availability", "verifying", { timeout: 10_000 });
  await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "connected", { timeout: 10_000 });
}

let servidor = null;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__violacionesCsp = [];
    document.addEventListener("securitypolicyviolation", (evento) => {
      window.__violacionesCsp.push(`${evento.violatedDirective} ${evento.blockedURI}`);
    });
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__violacionesCsp ?? []).catch(() => [])).toEqual([]);
  servidor?.stop();
  servidor = null;
});

test("LV-03: add_check llega por SSE como tarjeta nueva y la carga se mueve a ella; el cierre real deshabilita En Vivo y retira la carga", async ({ page }) => {
  servidor = await startFixtureServer("processing_archive_v5");
  await abrirTrazabilidad(page, servidor);
  await expect(tarjetas(page)).toHaveCount(2);
  await expect(enVivo(page)).toBeEnabled();
  await expect(motivo(page)).toBeHidden();
  // Antes de activar: la carga ya está en el último aceptado por secuencia.
  await expect(tarjeta(page, "E000002")).toHaveAttribute("data-active-source", "true");
  await enVivo(page).click();
  await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");

  fixtureOperation(servidor.run, "add_check");
  await expect(tarjetas(page)).toHaveCount(3, ESPERA_SONDEO);
  await expect(tarjeta(page, "E000003")).toContainText("Comprobación sintética ejecutada");
  // En seguimiento la nueva se selecciona y la carga pasa a ella.
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
  await expect(tarjeta(page, "E000003")).toHaveAttribute("data-active-source", "true");
  await expect(tarjeta(page, "E000003").locator('[data-part="source-loader"]')).toContainText(ETIQUETA_ACTIVO);
  await expect(tarjeta(page, "E000002")).not.toHaveAttribute("data-active-source", "true");
  await expect(cargas(page)).toHaveCount(1);
  await expect(page.locator('[data-part="timeline"] button[data-event-id="E000003"]')).toHaveAttribute("data-active-source", "true");
  expect(await idsDeTarjetas(page)).toEqual(["E000001", "E000002", "E000003"]);
  // La corrida abierta declara su cadena «en actualización» sin que eso sea
  // una transición de instantánea: En Vivo sigue habilitado y sin banda.
  await expect(page.locator('[data-part="chain"]')).toHaveAttribute("data-chain-status", "updating");
  await expect(page.locator('[data-part="source-notice"]')).toBeHidden();

  // Ráfaga del productor entre dos sondeos: ambas llegan una vez y solo la
  // última queda seleccionada con la carga.
  fixtureOperation(servidor.run, "add_check");
  fixtureOperation(servidor.run, "add_check");
  await expect(tarjetas(page)).toHaveCount(5, ESPERA_SONDEO);
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000005");
  await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");
  // Como mucho una tarjeta se revela: la de E000005, nunca la anterior.
  expect(await page.locator('[data-part="cards"] li[data-state="revealing"]:not([data-event-id="E000005"])').count()).toBe(0);
  await expect(tarjeta(page, "E000005")).toHaveAttribute("data-active-source", "true");
  await expect(cargas(page)).toHaveCount(1);

  fixtureOperation(servidor.run, "retained_then_closed");
  await expect(enVivo(page)).toBeDisabled(ESPERA_SONDEO);
  await expect(motivo(page)).toContainText("no está en procesamiento");
  await expect(page.locator('[data-active-source="true"]')).toHaveCount(0);
  await expect(page.locator('[data-part="source-loader"]')).toHaveCount(0);
  // El hito de cierre llega como cualquier otro, una sola vez.
  await expect(tarjetas(page)).toHaveCount(6);
  expect(await idsDeTarjetas(page)).toEqual(["E000001", "E000002", "E000003", "E000004", "E000005", "E000006"]);
  await expect(page.locator('[data-part="cards"] li[data-state="revealing"]')).toHaveCount(0);
  await expect(page.locator("#biblioteca")).toContainText("cerrada", ESPERA_SONDEO);
  // El cierre no inicia una reproducción automática.
  await expect(page.getByRole("button", { name: "Reproducir", exact: true })).toBeVisible();
});

test("LV-03: transient_retention (retaining con intención pendiente) no habilita En Vivo ni consuma nada", async ({ page }) => {
  servidor = await startFixtureServer("processing_archive_v5");
  await abrirTrazabilidad(page, servidor);
  await expect(enVivo(page)).toBeEnabled();
  const huella = fixtureOperation(servidor.run, "transient_retention");
  const raizTrasProductor = inventory(servidor.raiz);
  // El servidor conserva la última instantánea coherente mientras la
  // transición está pendiente; dos ciclos de sondeo no presentan nada nuevo.
  await page.waitForTimeout(5000);
  await expect(tarjetas(page)).toHaveCount(2);
  // Una lectura nueva (volver a Trazabilidad) ve la transición: el cierre
  // parcial no habilita En Vivo.
  await page.getByRole("tab", { name: "Archivo", exact: true }).click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(enVivo(page)).toBeDisabled(ESPERA_SONDEO);
  await expect(motivo(page)).toHaveText("Archivo en actualización");
  await expect(page.locator('[data-part="source-notice"]')).toContainText("Archivo en actualización");
  await expect(tarjetas(page)).toHaveCount(2);
  // Nada consumado ni recuperado: la intención sigue pendiente y ningún archivo cambió.
  await page.waitForTimeout(2500);
  expect(fixtureOperation(servidor.run, "inventory")).toEqual(huella);
  expect(inventory(servidor.raiz)).toEqual(raizTrasProductor);
  expect(Object.keys(huella)).not.toContain("evidence/pendiente.json");
});

test("LV-03: cerrar y reabrir el canal SSE recarga una vez y no repite eventos ni nuevos", async ({ page }) => {
  await instalarCanalCortable(page);
  servidor = await startFixtureServer("processing_archive_v5");
  await abrirTrazabilidad(page, servidor);
  await enVivo(page).click();
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reanudar En Vivo", exact: true })).toBeVisible();

  // Corte: la aplicación lo ve y el productor sigue escribiendo.
  await page.evaluate(() => window.__canal.cortar());
  await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "disconnected");
  await expect(page.locator('[data-part="source-notice"]')).toContainText("Datos no actualizados");
  await expect(tarjeta(page, "E000002").locator('[data-part="source-loader"]')).toHaveAttribute("data-loader", "static");
  fixtureOperation(servidor.run, "add_check");
  await page.waitForTimeout(3000);
  await expect(tarjetas(page)).toHaveCount(2);

  // Reapertura: se recarga antes de contar nuevos; E000003 cuenta una vez.
  await page.evaluate(() => window.__canal.reabrir());
  await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "connected");
  await expect(tarjetas(page)).toHaveCount(3, ESPERA_SONDEO);
  await expect(contador(page)).toHaveText("1 nuevo sin presentar");
  await expect(page.locator('[data-part="source-notice"]')).toBeHidden();
  await expect(tarjeta(page, "E000003").locator('[data-part="source-loader"]')).toHaveAttribute("data-loader", "active");

  // Segundo corte sin cambios en la fuente: nada se repite.
  await page.evaluate(() => window.__canal.cortar());
  await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "disconnected");
  await page.evaluate(() => window.__canal.reabrir());
  await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "connected");
  await page.waitForTimeout(5000);
  expect(await idsDeTarjetas(page)).toEqual(["E000001", "E000002", "E000003"]);
  await expect(contador(page)).toHaveText("1 nuevo sin presentar");
  expect(await page.evaluate(() => window.__canal.aperturas)).toBe(3);

  // «Reanudar En Vivo» reconoce la cola una sola vez.
  await page.getByRole("button", { name: "Reanudar En Vivo", exact: true }).click();
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
  await expect(contador(page)).toBeHidden();
});
