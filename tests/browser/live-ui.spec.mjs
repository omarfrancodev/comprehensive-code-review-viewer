import { expect, test } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { REVISION_SINTETICA, TRAZA_SINTETICA, installFakeEventSource, openFixture } from "./support.mjs";

/**
 * En Vivo integrado (§8, §8.1, §8.2, §11): disponibilidad por cierre, último
 * hito activo, cola de lectura, cierre en pausa, desconexión y sesión caducada.
 *
 * Los avisos llegan por una `EventSource` falsa (`installFakeEventSource`) y la
 * vista y la traza se sirven desde un objeto mutable (`fuente`) que cada prueba
 * cambia antes de avisar. Las pruebas de revelado detienen el reloj de la
 * página: la agrupación de avisos (100 ms) y el revelado solo avanzan con `runFor`.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
const ETIQUETA_ACTIVO = "Último hito activo · revisión en procesamiento";
const SIN_CONEXION = "Último estado conocido: processing · sin conexión";
const SESION = "La sesión caducó; relanza el visor local";

const sobre = (data) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ api_version: 1, data, diagnostics: [] }),
});

/** Revisión sintética con `closure.state` dado (`null`: cierre ausente). */
function vistaCon(estado, cambios = {}) {
  const vista = structuredClone(REVISION_SINTETICA);
  vista.closure = estado === null ? null : { ...vista.closure, state: estado };
  return Object.assign(vista, cambios);
}

function hito(n, cambios = {}) {
  return {
    event_id: `E${String(n).padStart(6, "0")}`,
    sequence: n,
    kind: "agent",
    status: "completed",
    summary: `Hito vivo ${n}`,
    occurred_at: null,
    recorded_at: "2026-09-01T12:01:00+00:00",
    temporal_basis: "recording_fallback",
    temporal_at: "2026-09-01T12:01:00+00:00",
    provenance: { kind: "helper", source: null },
    recorder: { kind: "helper", name: "review_artifacts", provider_id: null },
    actor: { kind: "agent", name: "agente-vivo", provider_id: null },
    executor: null,
    ...cambios,
  };
}

/** La traza sintética de tres hitos más los hitos `extra` (por secuencia). */
function conHitos(...extra) {
  const traza = structuredClone(TRAZA_SINTETICA);
  for (const n of extra) traza.events.push(hito(n));
  traza.valid_prefix_length = traza.events.length;
  traza.chain_status = "updating";
  return traza;
}

const tarjetas = (page) => page.locator('[data-part="cards"] li[data-event-id]');
const tarjeta = (page, id) => page.locator(`[data-part="cards"] li[data-event-id="${id}"]`);
const actual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');
const marcador = (page, id) => page.locator(`[data-part="timeline"] button[data-event-id="${id}"]`);
const marcadores = (page) => page.locator('[data-part="timeline"] button[data-event-id]');
const fuentesActivas = (page) => page.locator('[data-active-source="true"]');
const cargaDe = (page, id) => tarjeta(page, id).locator('[data-part="source-loader"]');
const enVivo = (page) => page.getByRole("button", { name: "En Vivo", exact: true });
const reanudar = (page) => page.getByRole("button", { name: "Reanudar En Vivo", exact: true });
const mostrarNuevos = (page) => page.getByRole("button", { name: "Mostrar nuevos", exact: true });
const boton = (page, nombre) => page.getByRole("button", { name: nombre, exact: true });
const motivo = (page) => page.locator('[data-part="live-reason"]');
const contador = (page) => page.locator('[data-part="pending-count"]');
const fuenteViva = (page) => page.locator('[data-part="live-source"]');
const avisoTraza = (page) => page.locator('[data-part="live-notice"]');
const banda = (page) => page.locator('[data-part="source-notice"]');
const inspector = (page) => page.locator('#inspector [data-part="inspector"]');
const animacion = (locator) => locator.evaluate((nodo) => getComputedStyle(nodo).animationName);
const FALLO_LECTURA = {
  status: 500,
  contentType: "application/json",
  body: JSON.stringify({ api_version: 1, error: { code: "read_failed", message: "No se pudo leer la revisión." } }),
};

/**
 * Abre la corrida sintética en Trazabilidad con avisos controlables. Devuelve
 * la `fuente` mutable y los contadores de peticiones de vista y traza.
 */
async function abrirVivo(page, { cierre = "processing", vista = null, traza = TRAZA_SINTETICA, evento = null, reloj = false } = {}) {
  const fuente = { vista: vista ?? vistaCon(cierre), traza, error: null, vistas: 0, trazas: 0 };
  await installFakeEventSource(page);
  if (reloj) await page.clock.install();
  await page.route("**/api/runs/*/trace", (ruta) => {
    fuente.trazas += 1;
    return ruta.fulfill(sobre(fuente.traza));
  });
  await openFixture(page, {
    ruta: `/?run=${CLAVE}&tab=trazabilidad${evento ? `&event=${evento}` : ""}`,
    onRun: (ruta) => {
      fuente.vistas += 1;
      return ruta.fulfill(fuente.error ?? sobre(fuente.vista));
    },
  });
  await expect(page.locator("[data-explorer]")).toBeVisible();
  // La primera apertura confirma el cierre con una lectura coherente.
  await expect(page.locator('[data-part="live"]')).not.toHaveAttribute("data-availability", "verifying", { timeout: 8000 });
  if (reloj) await page.clock.pauseAt(new Date(Date.now() + 60_000));
  return fuente;
}

let cursor = 0;
/** Entrega `veces` avisos completos de la corrida en el mismo instante. */
const avisar = (page, veces = 1) => {
  const desde = cursor + 1;
  cursor += veces;
  return page.evaluate(([clave, primero, n]) => {
    for (let i = 0; i < n; i += 1) window.__ccr.emitNotice({ kind: "run_changed", run_key: clave, cursor: primero + i, fingerprint: null });
  }, [CLAVE, desde, veces]);
};

/** Con el reloj detenido: avisa y deja pasar la agrupación de 100 ms. */
async function avisarConReloj(page, veces = 1) {
  await avisar(page, veces);
  await page.clock.runFor(150);
}

/** Espera a que termine una recarga coherente (vista A, traza y vista B). */
async function esperarRecarga(page, fuente, vistasAntes) {
  await expect.poll(() => fuente.vistas).toBeGreaterThanOrEqual(vistasAntes + 2);
  await page.waitForTimeout(150);
}

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
});

test.describe("LV-01 disponibilidad por cierre", () => {
  const CASOS = [
    ["prepared", "prepared", "no está en procesamiento"],
    ["retaining", "retaining", "no está en procesamiento"],
    ["closing", "closing", "no está en procesamiento"],
    ["complete", "complete", "no está en procesamiento"],
    ["ausente", null, "desconocido"],
    ["future_state", "future_state", "desconocido"],
  ];

  for (const [nombre, estado, explicacion] of CASOS) {
    test(`cierre ${nombre}: En Vivo deshabilitado con su motivo visible aunque la conexión esté abierta`, async ({ page }) => {
      await abrirVivo(page, { cierre: estado });
      await page.evaluate(() => window.__ccr.setConnection("open"));
      await expect(page.locator("#avisos")).toHaveAttribute("data-estado", "connected");
      await expect(enVivo(page)).toBeDisabled();
      await expect(motivo(page)).toBeVisible();
      await expect(motivo(page)).toContainText(explicacion);
      const describe = await enVivo(page).getAttribute("aria-describedby");
      expect(describe).toBe(await motivo(page).getAttribute("id"));
      // Sin carga de revisión activa ni actividad inferida.
      await expect(fuentesActivas(page)).toHaveCount(0);
      await expect(page.locator('[data-part="source-loader"]')).toHaveCount(0);
      // Pulsar el botón deshabilitado no activa nada.
      await enVivo(page).evaluate((b) => b.click());
      await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");
      await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    });
  }

  test("cierre processing: En Vivo habilitado y sin motivo", async ({ page }) => {
    await abrirVivo(page);
    await expect(enVivo(page)).toBeEnabled();
    await expect(motivo(page)).toBeHidden();
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("lectura en actualización", () => {
  test("view.updating deshabilita En Vivo con «Archivo en actualización»", async ({ page }) => {
    await abrirVivo(page, { vista: vistaCon("processing", { updating: true }) });
    await expect(enVivo(page)).toBeDisabled();
    await expect(motivo(page)).toHaveText("Archivo en actualización");
  });

  test("snapshot.transition_pending deshabilita En Vivo con «Archivo en actualización»", async ({ page }) => {
    const vista = vistaCon("processing", { diagnostics: [{ code: "snapshot.transition_pending", message: "Transición en curso." }] });
    await abrirVivo(page, { vista });
    await expect(enVivo(page)).toBeDisabled();
    await expect(motivo(page)).toHaveText("Archivo en actualización");
  });

  test("chain_status updating sin view.updating no deshabilita ni bloquea nada", async ({ page }) => {
    await abrirVivo(page, { traza: { ...TRAZA_SINTETICA, chain_status: "updating" } });
    await expect(enVivo(page)).toBeEnabled();
    await expect(motivo(page)).toBeHidden();
    await enVivo(page).click();
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    await expect(banda(page)).toBeHidden();
  });

  test("una recarga incoherente conserva la traza con «Archivo en actualización» y espera «Reintentar»", async ({ page }) => {
    const fuente = await abrirVivo(page);
    fuente.vista = vistaCon("processing", { updating: true });
    fuente.traza = conHitos(4);
    await avisar(page);
    await expect(banda(page)).toContainText("Archivo en actualización", { timeout: 8000 });
    await expect(enVivo(page)).toBeDisabled();
    await expect(motivo(page)).toHaveText("Archivo en actualización");
    // Se conserva el modelo anterior: E000004 no aparece.
    await expect(marcadores(page)).toHaveCount(3);
    await expect(tarjetas(page)).toHaveCount(3);
    // Tras los reintentos acotados se espera otro aviso o «Reintentar».
    const pedidas = fuente.vistas;
    await page.waitForTimeout(2000);
    expect(fuente.vistas).toBe(pedidas);
    fuente.vista = vistaCon("processing");
    await banda(page).getByRole("button", { name: "Reintentar" }).click();
    // El modelo nuevo llega; E000004 queda recibido sin presentar hasta «Mostrar nuevos».
    await expect(marcadores(page)).toHaveCount(4);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await expect(tarjetas(page)).toHaveCount(3);
    await expect(banda(page)).toBeHidden();
    await expect(enVivo(page)).toBeEnabled();
  });
});

test.describe("LV-02 último hito activo", () => {
  test("con E000002 seleccionado la carga está en E000003 (tarjeta y punto)", async ({ page }) => {
    await abrirVivo(page, { evento: "E000002" });
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
    await expect(tarjeta(page, "E000003")).toHaveAttribute("data-active-source", "true");
    await expect(cargaDe(page, "E000003")).toContainText(ETIQUETA_ACTIVO);
    await expect(marcador(page, "E000003")).toHaveAttribute("data-active-source", "true");
    await expect(marcador(page, "E000003")).toHaveAttribute("aria-label", new RegExp(ETIQUETA_ACTIVO));
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(1);
    await expect(page.locator('[data-part="timeline"] [data-active-source="true"]')).toHaveCount(1);
    await expect(cargaDe(page, "E000002")).toHaveCount(0);
  });

  test("la carga persiste tras el revelado y se mueve con la llegada de E000004", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    fuente.traza = conHitos(4);
    await avisarConReloj(page);
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "revealing");
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-active-source", "true");
    await expect(tarjeta(page, "E000003")).not.toHaveAttribute("data-active-source", "true");
    await expect(marcador(page, "E000004")).toHaveAttribute("data-active-source", "true");
    await page.clock.runFor(2000);
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");
    // El indicador de fuente sigue con processing después del revelado.
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-active-source", "true");
    await expect(cargaDe(page, "E000004")).toContainText(ETIQUETA_ACTIVO);
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(1);
  });

  test("en replay la carga va al último recibido aunque se seleccione uno anterior", async ({ page }) => {
    const fuente = await abrirVivo(page, { evento: "E000002" });
    fuente.traza = conHitos(4);
    await avisar(page);
    await expect(marcador(page, "E000004")).toHaveAttribute("data-active-source", "true");
    await expect(page.locator('[data-part="timeline"] [data-active-source="true"]')).toHaveCount(1);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
    // E000004 aún no se presenta: no está en la lista y el acceso explícito lleva a él.
    await expect(tarjeta(page, "E000004")).toHaveCount(0);
    await expect(fuenteViva(page)).toContainText("Último activo: E000004");
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(0);
    await mostrarNuevos(page).click();
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-active-source", "true");
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");
    // Una sola tarjeta lleva la carga activa.
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(1);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
  });

  test("un hito completed con carga no se rotula running", async ({ page }) => {
    const traza = structuredClone(TRAZA_SINTETICA);
    traza.events[2].status = "completed";
    await abrirVivo(page, { traza });
    await expect(cargaDe(page, "E000003")).toContainText(ETIQUETA_ACTIVO);
    await expect(tarjeta(page, "E000003")).toContainText("completed");
    await expect(tarjeta(page, "E000003")).not.toContainText(/running|en ejecución/i);
    expect(await marcador(page, "E000003").getAttribute("aria-label")).not.toMatch(/running|en ejecución/i);
  });

  test("el cierre a complete retira la carga", async ({ page }) => {
    const fuente = await abrirVivo(page);
    await expect(fuentesActivas(page)).toHaveCount(2);
    fuente.vista = vistaCon("complete");
    await avisar(page);
    await expect(fuentesActivas(page)).toHaveCount(0);
    await expect(page.locator('[data-part="source-loader"]')).toHaveCount(0);
    await expect(enVivo(page)).toBeDisabled();
  });

  test("processing sin hitos: «Esperando el primer registro» y ninguna tarjeta ni actor", async ({ page }) => {
    await abrirVivo(page, { traza: { events: [], valid_prefix_length: 0, chain_status: "updating", relations: [], diagnostics: [] } });
    await expect(page.locator('[data-part="empty"]')).toHaveText("Esperando el primer registro");
    await expect(tarjetas(page)).toHaveCount(0);
    await expect(page.locator('[data-part="actors"] button:visible')).toHaveCount(0);
    await expect(fuentesActivas(page)).toHaveCount(0);
    await expect(enVivo(page)).toBeEnabled();
  });

  test("primeros hitos de una traza vacía en replay: el seleccionado tiene tarjeta y no cuenta como pendiente", async ({ page }) => {
    const fuente = await abrirVivo(page, { traza: { events: [], valid_prefix_length: 0, chain_status: "updating", relations: [], diagnostics: [] } });
    await expect(page.locator('[data-part="empty"]')).toHaveText("Esperando el primer registro");
    const llegadas = structuredClone(TRAZA_SINTETICA);
    llegadas.events = llegadas.events.slice(0, 2);
    llegadas.valid_prefix_length = 2;
    llegadas.chain_status = "updating";
    fuente.traza = llegadas;
    await avisar(page);
    await expect(marcadores(page)).toHaveCount(2);
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000002");
    // El seleccionado siempre está presentado: tiene tarjeta y la lista no está vacía.
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
    await expect(tarjetas(page)).toHaveCount(2);
    await expect(page.locator('[data-part="cards"]')).not.toContainText("aún no se han presentado");
    await expect(contador(page)).toBeHidden();
  });

  test("Atrás a una entrada de Trazabilidad sin event conserva la cola de pendientes", async ({ page }) => {
    const fuente = await abrirVivo(page);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await page.getByRole("tab", { name: "Hallazgos", exact: true }).click();
    await page.getByRole("tab", { name: "Trazabilidad", exact: true }).click();
    await marcador(page, "E000002").click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
    fuente.traza = conHitos(4);
    await avisar(page);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");

    await page.goBack();
    await expect(page.getByRole("tab", { name: "Hallazgos", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page.getByRole("tab", { name: "Trazabilidad", exact: true })).toHaveAttribute("aria-selected", "true");
    // El hito por defecto es el último presentado; la llegada sigue pendiente.
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await expect(tarjeta(page, "E000004")).toHaveCount(0);
  });

  test("último fuera de página: «Último activo: E000060» con acceso explícito", async ({ page }) => {
    await abrirVivo(page, { traza: trazaSintetica(60, { chain: "updating" }), evento: "E000001" });
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000001");
    await expect(fuenteViva(page)).toContainText("Último activo: E000060");
    // No se marca un hito anterior.
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(0);
    await fuenteViva(page).getByRole("button", { name: "Ir al último activo" }).click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000060");
    await expect(tarjeta(page, "E000060")).toHaveAttribute("data-active-source", "true");
    await expect(fuenteViva(page)).toBeHidden();
  });

  test("último fuera del filtro: «Último activo: E000003» con acceso explícito", async ({ page }) => {
    await abrirVivo(page, { evento: "E000001" });
    await page.getByRole("searchbox", { name: "Buscar hitos" }).fill("preparado");
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(fuenteViva(page)).toContainText("Último activo: E000003");
    await expect(page.locator('[data-part="cards"] [data-active-source="true"]')).toHaveCount(0);
    await fuenteViva(page).getByRole("button", { name: "Ir al último activo" }).click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(tarjeta(page, "E000003")).toHaveAttribute("data-active-source", "true");
  });
});

test("activar: selecciona el último y sigue; las nuevas se revelan una a una y en ráfaga solo la última", async ({ page }) => {
  const fuente = await abrirVivo(page, { evento: "E000001", reloj: true });
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000001");
  await enVivo(page).click();
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
  await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
  await expect(boton(page, "Seguir recorrido")).toHaveAttribute("aria-pressed", "true");

  fuente.traza = conHitos(4);
  await avisarConReloj(page);
  await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "revealing");
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000004");
  await page.clock.runFor(2000);
  await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");

  fuente.traza = conHitos(4, 5);
  await avisarConReloj(page);
  await expect(tarjeta(page, "E000005")).toHaveAttribute("data-state", "revealing");
  await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");

  // Ráfaga durante un revelado: tres avisos, una recarga; solo el último se anima.
  const trazasAntes = fuente.trazas;
  fuente.traza = conHitos(4, 5, 6, 7, 8);
  await avisarConReloj(page, 3);
  await expect(tarjeta(page, "E000008")).toHaveAttribute("data-state", "revealing");
  for (const id of ["E000005", "E000006", "E000007"]) await expect(tarjeta(page, id)).toHaveAttribute("data-state", "complete");
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000008");
  expect(fuente.trazas - trazasAntes).toBe(1);
  await expect(page.locator('[data-part="cards"] li[data-state="revealing"]')).toHaveCount(1);
});

test.describe("LV-04 pausa y cola de lectura", () => {
  test("pausar conserva ID, foco y scroll; buscar no borra el contador; «Mostrar nuevos» no reanuda; «Reanudar En Vivo» selecciona el último", async ({ page }) => {
    const base = trazaSintetica(20, { chain: "updating" });
    const fuente = await abrirVivo(page, { traza: base, reloj: true });
    await enVivo(page).click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000020");
    await boton(page, "Pausar").click();
    await expect(reanudar(page)).toBeVisible();
    const panel = page.locator(".tarjetas-panel");
    await panel.evaluate((nodo) => { nodo.scrollTop = Math.floor(nodo.scrollHeight / 3); });
    const scroll = await panel.evaluate((nodo) => nodo.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    await page.evaluate(() => { document.activeElement.dataset.testigo = "1"; });
    const etapa = await actual(page).getAttribute("data-state");

    const llegadas = structuredClone(base);
    llegadas.events.push(hito(21), hito(22));
    llegadas.valid_prefix_length = 22;
    fuente.traza = llegadas;
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");
    // El modelo y los datos accesibles se actualizan (timeline); la lista no incorpora
    // los pendientes hasta «Mostrar nuevos».
    await expect(marcadores(page)).toHaveCount(22);
    await expect(tarjetas(page)).toHaveCount(20);
    await expect(tarjeta(page, "E000021")).toHaveCount(0);
    await expect(tarjeta(page, "E000022")).toHaveCount(0);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000020");
    await expect(actual(page)).toHaveAttribute("data-state", etapa);
    expect(await page.evaluate(() => document.activeElement?.dataset.testigo ?? null)).toBe("1");
    expect(await panel.evaluate((nodo) => nodo.scrollTop)).toBe(scroll);

    // Buscar no borra el contador y alcanza los recibidos sin presentar.
    const buscar = page.getByRole("searchbox", { name: "Buscar hitos" });
    await buscar.fill("Hito vivo");
    await expect(tarjetas(page)).toHaveCount(2);
    await expect(tarjeta(page, "E000021")).toHaveAttribute("data-state", "received");
    await expect(tarjeta(page, "E000021")).toContainText("Recibido · sin presentar");
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");
    await buscar.fill("Evento sintético 1");
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");
    await buscar.fill("");
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");

    // «Mostrar nuevos» incorpora sin desplazar ni reanudar.
    const scrollAntes = await panel.evaluate((nodo) => nodo.scrollTop);
    await mostrarNuevos(page).click();
    await expect(contador(page)).toBeHidden();
    await expect(tarjeta(page, "E000022")).toHaveAttribute("data-state", "complete");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000020");
    await expect(reanudar(page)).toBeVisible();
    await page.clock.runFor(3000);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000020");
    expect(await panel.evaluate((nodo) => nodo.scrollTop)).toBe(scrollAntes);

    // «Reanudar En Vivo» reconoce la cola y selecciona el último.
    llegadas.events.push(hito(23));
    llegadas.valid_prefix_length = 23;
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await reanudar(page).click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000023");
    await expect(contador(page)).toBeHidden();
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("abrir «JSON original» en seguimiento es lectura: la llegada va a la cola y el inspector conserva hito, JSON y foco; «Reanudar En Vivo» retoma", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    const json = inspector(page).locator('details[data-part="original-json"]');
    await json.locator("summary").click();
    await expect(json).toHaveAttribute("open", "");
    // Interactuar con el inspector deja de seguir, como pausar.
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");
    await expect(boton(page, "Seguir recorrido")).toHaveAttribute("aria-pressed", "false");
    await expect(reanudar(page)).toBeVisible();
    await page.evaluate(() => { document.activeElement.dataset.testigo = "1"; });

    fuente.traza = conHitos(4);
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await expect(marcador(page, "E000004")).toHaveCount(1);
    await expect(tarjeta(page, "E000004")).toHaveCount(0);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(json).toHaveAttribute("open", "");
    await expect(json.locator("pre")).toContainText('"event_id": "E000003"');
    expect(await page.evaluate(() => document.activeElement?.dataset.testigo ?? null)).toBe("1");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");

    // «Reanudar En Vivo» retoma; el JSON que sigue abierto al repintar no vuelve a suspender.
    await reanudar(page).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000004");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    await expect(contador(page)).toBeHidden();
    await expect(json).toHaveAttribute("open", "");
    fuente.traza = conHitos(4, 5);
    await avisarConReloj(page);
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000005");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000005");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    await expect(contador(page)).toBeHidden();
  });

  test("escribir en la búsqueda en seguimiento es lectura: la llegada queda en la cola y la selección se conserva", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("searchbox", { name: "Buscar hitos" }).pressSequentially("E00000");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");
    await expect(reanudar(page)).toBeVisible();

    fuente.traza = conHitos(4);
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");

    // «Reanudar En Vivo» sigue siendo explícito: reconoce la cola y selecciona el último.
    await reanudar(page).click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000004");
    await expect(contador(page)).toBeHidden();
  });

  test("enfocar «Copiar JSON» en seguimiento es lectura: el foco y el hito se conservan; «Seguir recorrido» retoma", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    const copiar = inspector(page).getByRole("button", { name: "Copiar JSON", exact: true });
    await copiar.focus();
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "false");
    await page.evaluate(() => { document.activeElement.dataset.testigo = "1"; });

    fuente.traza = conHitos(4);
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("1 nuevo sin presentar");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000003");
    const foco = await page.evaluate(() => ({ accion: document.activeElement?.dataset.accion ?? null, testigo: document.activeElement?.dataset.testigo ?? null }));
    expect(foco).toEqual({ accion: "copiar-json", testigo: "1" });

    // El botón de seguimiento también retoma En Vivo: reconoce la cola y selecciona el último.
    await boton(page, "Seguir recorrido").click();
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000004");
    await expect(enVivo(page)).toHaveAttribute("aria-pressed", "true");
    await expect(contador(page)).toBeHidden();
  });

  test("cierre coherente a complete en pausa: deshabilita, completa el revelado, conserva cola y selección, sin reproducir solo", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    fuente.traza = conHitos(4);
    await avisarConReloj(page);
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "revealing");
    await boton(page, "Pausar").click();
    await expect(reanudar(page)).toBeVisible();
    fuente.traza = conHitos(4, 5, 6);
    await avisarConReloj(page);
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "revealing");

    fuente.vista = vistaCon("complete");
    await avisarConReloj(page);
    await expect(enVivo(page)).toBeDisabled();
    await expect(motivo(page)).toContainText("no está en procesamiento");
    await expect(tarjeta(page, "E000004")).toHaveAttribute("data-state", "complete");
    await expect(contador(page)).toHaveText("2 nuevos sin presentar");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000004");
    await expect(fuentesActivas(page)).toHaveCount(0);
    await page.clock.runFor(6000);
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000004");
    await expect(boton(page, "Reproducir")).toBeVisible();
    // Los pendientes siguen recibidos (timeline) y fuera de la lista hasta «Mostrar nuevos».
    await expect(marcador(page, "E000005")).toHaveCount(1);
    await expect(tarjeta(page, "E000005")).toHaveCount(0);
    await mostrarNuevos(page).click();
    await expect(tarjeta(page, "E000005")).toHaveAttribute("data-state", "complete");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000004");
  });

  test("desconexión: icono estático «Último estado conocido» y «Datos no actualizados»; al reconectar espera la recarga", async ({ page }) => {
    const fuente = await abrirVivo(page, { reloj: true });
    await enVivo(page).click();
    const icono = cargaDe(page, "E000003").locator(".fuente-icono");
    expect(await animacion(icono)).not.toBe("none");

    await page.evaluate(() => window.__ccr.setConnection("error"));
    await expect(cargaDe(page, "E000003")).toHaveAttribute("data-loader", "static");
    await expect(cargaDe(page, "E000003")).toContainText(SIN_CONEXION);
    expect(await animacion(icono)).toBe("none");
    const iconoPunto = page.locator('[data-part="timeline"] [data-part="source-loader"] .fuente-icono');
    expect(await animacion(iconoPunto)).toBe("none");
    await expect(banda(page)).toContainText("Datos no actualizados");

    fuente.traza = conHitos(4);
    await page.evaluate(() => window.__ccr.setConnection("open"));
    // Sin recarga todavía: ni carga activa ni nuevos contados.
    await expect(cargaDe(page, "E000003")).toHaveAttribute("data-loader", "static");
    await expect(tarjeta(page, "E000004")).toHaveCount(0);
    expect(await animacion(icono)).toBe("none");

    await page.clock.runFor(150);
    await expect(tarjeta(page, "E000004")).toHaveCount(1);
    await expect(cargaDe(page, "E000004")).toHaveAttribute("data-loader", "active");
    await expect(cargaDe(page, "E000004")).toContainText(ETIQUETA_ACTIVO);
    await expect(banda(page)).toBeHidden();
  });
});

test("error de lectura: icono estático «datos no actualizados» hasta una recarga correcta", async ({ page }) => {
  const fuente = await abrirVivo(page);
  const icono = cargaDe(page, "E000003").locator(".fuente-icono");
  await expect(cargaDe(page, "E000003")).toHaveAttribute("data-loader", "active");
  expect(await animacion(icono)).not.toBe("none");
  fuente.error = FALLO_LECTURA;
  await avisar(page);
  await expect(banda(page)).toContainText("Datos no actualizados");
  await expect(cargaDe(page, "E000003")).toHaveAttribute("data-loader", "static");
  await expect(cargaDe(page, "E000003")).toContainText("Último estado conocido: processing · datos no actualizados");
  expect(await animacion(icono)).toBe("none");
  await expect(marcador(page, "E000003")).toHaveAttribute("aria-label", /datos no actualizados/);

  fuente.error = null;
  await avisar(page);
  await expect(cargaDe(page, "E000003")).toHaveAttribute("data-loader", "active");
  await expect(cargaDe(page, "E000003")).toContainText(ETIQUETA_ACTIVO);
  expect(await animacion(icono)).not.toBe("none");
  await expect(banda(page)).toBeHidden();
});

test("primera apertura: el cierre se confirma con una lectura coherente sin esperar un aviso", async ({ page }) => {
  // La primera vista dice `processing`; la relectura coherente, `complete`.
  await page.addInitScript(() => {
    window.__habilitado = false;
    window.__cargaVista = false;
    new MutationObserver(() => {
      const boton = document.querySelector('[data-part="live-toggle"]');
      if (boton && boton.getAttribute("aria-disabled") !== "true") window.__habilitado = true;
      if (document.querySelector('[data-active-source="true"], [data-part="source-loader"]')) window.__cargaVista = true;
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  const fuente = { vistas: 0 };
  await installFakeEventSource(page);
  await page.route("**/api/runs/*/trace", (ruta) => ruta.fulfill(sobre(TRAZA_SINTETICA)));
  await openFixture(page, {
    ruta: `/?run=${CLAVE}&tab=trazabilidad`,
    onRun: (ruta) => {
      fuente.vistas += 1;
      return ruta.fulfill(sobre(vistaCon(fuente.vistas === 1 ? "processing" : "complete")));
    },
  });
  await expect(page.locator("[data-explorer]")).toBeVisible();
  await expect(motivo(page)).toContainText("no está en procesamiento");
  expect(fuente.vistas).toBeGreaterThanOrEqual(3);
  await expect(enVivo(page)).toBeDisabled();
  await expect(fuentesActivas(page)).toHaveCount(0);
  await expect(page.locator('[data-part="source-loader"]')).toHaveCount(0);
  await expect(banda(page)).toBeHidden();
  expect(await page.evaluate(() => [window.__habilitado, window.__cargaVista])).toEqual([false, false]);
});

test("sesión caducada: aviso fijo, conserva la última vista y no entra en bucle", async ({ page }) => {
  const fuente = await abrirVivo(page);
  await expect(tarjetas(page)).toHaveCount(3);
  const vistasAntes = fuente.vistas;
  const trazasAntes = fuente.trazas;
  fuente.error = {
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ api_version: 1, error: { code: "session_required", message: "Se requiere una sesión local." } }),
  };
  fuente.traza = conHitos(4);
  await avisar(page);
  await expect(banda(page)).toContainText(SESION);
  await expect(page.locator("#anunciador")).toContainText(SESION);
  expect(fuente.vistas - vistasAntes).toBe(1);
  // La última vista sigue disponible.
  await expect(tarjetas(page)).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Trazabilidad" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#cabecera-revision")).not.toBeEmpty();
  // Sin bucle: otro aviso no provoca más de una petición y luego nada más.
  await avisar(page);
  await page.waitForTimeout(1500);
  expect(fuente.vistas - vistasAntes).toBeLessThanOrEqual(2);
  expect(fuente.trazas).toBe(trazasAntes);
  expect(await page.evaluate(() => window.__ccr.closed)).toBe(true);
  // No se intenta recuperar el token del almacenamiento.
  const almacenado = await page.evaluate(() => JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)]));
  expect(almacenado).not.toMatch(/token/i);
  await expect(banda(page)).toContainText(SESION);
});

test("prefijo reducido: pausa y aviso; la selección inválida pasa al último con aviso", async ({ page }) => {
  const fuente = await abrirVivo(page);
  await enVivo(page).click();
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
  const corta = structuredClone(TRAZA_SINTETICA);
  corta.events = corta.events.slice(0, 2);
  corta.valid_prefix_length = 2;
  fuente.traza = corta;
  await avisar(page);
  await expect(avisoTraza(page)).toContainText("prefijo aceptado");
  await expect(avisoTraza(page)).toContainText("se seleccionó E000002");
  await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
  await expect(tarjetas(page)).toHaveCount(2);
  await expect(reanudar(page)).toBeVisible();
  await expect(page.locator("#anunciador")).toContainText("prefijo aceptado");
});

test("mismo ID modificado: diagnóstico de cambio sin contar un nuevo", async ({ page }) => {
  const base = trazaSintetica(3, { chain: "updating" });
  const fuente = await abrirVivo(page, { traza: base });
  const modificada = structuredClone(base);
  modificada.events[1].summary = "Evento sintético 2 corregido";
  modificada.events[1].sha256 = "b".repeat(64);
  fuente.traza = modificada;
  await avisar(page);
  await expect(avisoTraza(page)).toContainText("El hito E000002 cambió en la fuente");
  await expect(tarjeta(page, "E000002")).toContainText("corregido");
  await expect(tarjetas(page)).toHaveCount(3);
  await expect(contador(page)).toBeHidden();
});

test("anuncios: un mensaje por ráfaga y uno por cambio de cierre", async ({ page }) => {
  const fuente = await abrirVivo(page);
  await enVivo(page).click();
  await page.evaluate(() => {
    window.__mensajes = [];
    const region = document.getElementById("anunciador");
    new MutationObserver(() => window.__mensajes.push(region.textContent.trim()))
      .observe(region, { childList: true, characterData: true, subtree: true });
  });
  const vistas = fuente.vistas;
  fuente.traza = conHitos(4, 5, 6);
  await avisar(page, 3);
  await expect(tarjeta(page, "E000006")).toHaveCount(1);
  await esperarRecarga(page, fuente, vistas);
  await page.waitForTimeout(300);
  let mensajes = await page.evaluate(() => window.__mensajes);
  expect(mensajes).toHaveLength(1);
  expect(mensajes[0]).toContain("E000006");

  fuente.vista = vistaCon("complete");
  await avisar(page);
  await expect(enVivo(page)).toBeDisabled();
  await page.waitForTimeout(300);
  mensajes = await page.evaluate(() => window.__mensajes);
  expect(mensajes).toHaveLength(2);
  expect(mensajes[1]).toContain("dejó de estar en procesamiento");
});
