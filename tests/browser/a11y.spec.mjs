import { expect, test } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { fixtureOperation, startFixtureServer } from "./server.mjs";
import { REVISION_SINTETICA, installFakeEventSource, openFixture } from "./support.mjs";

/**
 * AX-01 (§11, §12): teclado completo, foco y retorno de diálogos, región
 * polite sin anuncios repetidos y foco visible en ambos temas. El contraste de
 * los tokens lo cubre `tests/js/contrast.test.mjs`; aquí se mide el anillo de
 * foco efectivamente pintado sobre su fondo.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
const inspector = (page) => page.locator('#inspector [data-part="inspector"]');
const actual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');

/** Describe el elemento enfocado para los mensajes de error. */
const descripcionFoco = (page) => page.evaluate(() => {
  const a = document.activeElement;
  if (!a || a === document.body) return "<body>";
  return `${a.tagName.toLowerCase()}${a.id ? `#${a.id}` : ""} «${(a.getAttribute("aria-label") ?? a.textContent ?? "").trim().slice(0, 40)}»`;
});

/**
 * Pulsa Tab (o Mayús+Tab) hasta que el foco cumpla `selector`; falla si no
 * llega en `maximo` pulsaciones. Solo teclado: nunca se hace clic.
 */
async function tabularHasta(page, objetivo, { maximo = 80, atras = false } = {}) {
  for (let i = 0; i < maximo; i += 1) {
    if (await focoEn(page, objetivo)) return;
    await page.keyboard.press(atras ? "Shift+Tab" : "Tab");
  }
  throw new Error(`El foco no llegó a ${JSON.stringify(objetivo)} tras ${maximo} tabulaciones (está en ${await descripcionFoco(page)})`);
}

/**
 * ¿El foco está en `objetivo`? Es un selector CSS o `{ css, texto }` (texto
 * visible exacto del control, p. ej. un botón por su rótulo).
 */
const focoEn = (page, objetivo) => page.evaluate((o) => {
  const a = document.activeElement;
  if (!a) return false;
  if (typeof o === "string") return a.matches(o);
  return a.matches(o.css) && a.textContent.trim() === o.texto;
}, objetivo);

const control = (css, texto) => ({ css, texto });

/**
 * Anillo de foco del elemento activo: estilo, grosor y contraste del color del
 * contorno contra el fondo efectivo (primer ancestro con fondo opaco).
 */
function medirFoco() {
  const luminancia = ([r, g, b]) => {
    const canal = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  };
  const rgba = (texto) => {
    const m = texto.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const partes = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: partes.slice(0, 3), alfa: partes.length > 3 ? partes[3] : 1 };
  };
  const nodo = document.activeElement;
  const estilo = getComputedStyle(nodo);
  // El contorno se pinta fuera del elemento (offset positivo) o dentro (negativo).
  const offset = Number.parseFloat(estilo.outlineOffset) || 0;
  let fondo = null;
  for (let n = offset >= 0 ? nodo.parentElement : nodo; n; n = n.parentElement) {
    const color = rgba(getComputedStyle(n).backgroundColor);
    if (color && color.alfa > 0.5) {
      fondo = color.rgb;
      break;
    }
  }
  fondo ??= rgba(getComputedStyle(document.body).backgroundColor)?.rgb ?? [255, 255, 255];
  const contorno = rgba(estilo.outlineColor)?.rgb ?? [0, 0, 0];
  const [a, b] = [luminancia(contorno), luminancia(fondo)].sort((x, y) => y - x);
  const caja = nodo.getBoundingClientRect();
  return {
    estilo: estilo.outlineStyle,
    ancho: Number.parseFloat(estilo.outlineWidth) || 0,
    contraste: (a + 0.05) / (b + 0.05),
    visible: caja.width > 0 && caja.height > 0,
    nodo: `${nodo.tagName.toLowerCase()}${nodo.className && typeof nodo.className === "string" ? `.${nodo.className.split(" ")[0]}` : ""}`,
  };
}

test.describe("AX-01 con el servidor real", () => {
  let servidor = null;

  test.afterEach(() => {
    servidor?.stop();
    servidor = null;
  });

  test("flujo completo solo con teclado: biblioteca → revisión → tabs → explorador → controles → inspector", async ({ page }) => {
    servidor = await startFixtureServer("final_v7");
    await page.goto(servidor.url);
    await page.waitForSelector("#biblioteca .lista-revisiones button", { timeout: 20_000 });
    await page.locator("body").focus();

    // «Saltar al contenido» es lo primero.
    await page.keyboard.press("Tab");
    expect(await focoEn(page, "a.saltar")).toBe(true);

    // Biblioteca → revisión.
    await tabularHasta(page, ".lista-revisiones button");
    await page.keyboard.press("Enter");
    await expect(page.locator("#cabecera-revision h2")).toHaveText("Revisión sintética de validación de entrada");

    // Tabs con activación manual: las flechas mueven el foco, Enter activa.
    await tabularHasta(page, '#barra-revision [role="tab"][aria-selected="true"]');
    for (let i = 0; i < 10 && !(await focoEn(page, "#pestana-trazabilidad")); i += 1) await page.keyboard.press("ArrowRight");
    expect(await focoEn(page, "#pestana-trazabilidad")).toBe(true);
    await expect(page.getByRole("tab", { name: "Trazabilidad" })).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Trazabilidad" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-explorer]")).toBeVisible();
    // final_v7 declara tres hitos: E000001 prepare (helper), E000002 check y E000003 close.
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");

    // Actores: el primer acceso selecciona el primer hito de ese actor.
    await tabularHasta(page, '[data-part="actors"] button[data-actor-key]');
    await page.keyboard.press("Enter");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000001");

    // Timeline: un punto con Enter; el foco se queda en el punto.
    await tabularHasta(page, '[data-part="timeline"] button[data-event-id="E000003"]');
    await page.keyboard.press("Enter");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    expect(await focoEn(page, '[data-part="timeline"] button[data-event-id="E000003"]')).toBe(true);

    // Controles: anterior, deslizador nativo, reproducir/pausar con teclado.
    await tabularHasta(page, control('[data-part="controls"] button', "Evento anterior"));
    await page.keyboard.press("Enter");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000002");
    await tabularHasta(page, '[data-part="controls"] input[type="range"]');
    await page.keyboard.press("End");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await page.keyboard.press("Home");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000001");
    await tabularHasta(page, control('[data-part="controls"] button', "Reproducir"), { atras: true });
    await page.keyboard.press("Space");
    await expect(page.locator('[data-part="controls"] button:text-is("Pausar")')).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator('[data-part="controls"] button:text-is("Reproducir")')).toBeFocused();

    // Búsqueda: escribir y Enter selecciona la coincidencia.
    await tabularHasta(page, '[data-part="search"] input[type="search"]');
    await page.keyboard.type("Cierre");
    await page.keyboard.press("Enter");
    await expect(actual(page)).toHaveAttribute("data-event-id", "E000003");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");

    // Tarjetas: botón de selección con Enter, sin mover el foco al inspector.
    await tabularHasta(page, '[data-part="cards"] li[data-event-id="E000002"] .tarjeta-boton');
    await page.keyboard.press("Enter");
    await expect(inspector(page)).toHaveAttribute("data-event-id", "E000002");
    expect(await page.evaluate(() => document.getElementById("inspector").contains(document.activeElement))).toBe(false);

    // Inspector: alcanzable con Tab; el JSON original se despliega con Enter.
    await tabularHasta(page, '#inspector details[data-part="original-json"] > summary');
    await page.keyboard.press("Enter");
    await expect(inspector(page).locator('details[data-part="original-json"]')).toHaveAttribute("open", "");
    await expect(inspector(page).locator('details[data-part="original-json"] pre')).toContainText("E000002");
  });

  test("la región polite no repite mensajes: navegar, reproducir, recibir y quedar en reposo", async ({ page }) => {
    servidor = await startFixtureServer("processing_archive_v5");
    await page.addInitScript(() => {
      window.__mensajes = [];
      const observar = () => {
        const region = document.getElementById("anunciador");
        if (!region) return;
        new MutationObserver(() => window.__mensajes.push({ t: performance.now(), texto: region.textContent }))
          .observe(region, { childList: true, characterData: true, subtree: true });
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observar);
      else observar();
    });
    await page.goto(servidor.url);
    await page.locator(".lista-revisiones button").first().click();
    for (const nombre of ["Hallazgos", "Archivo", "Trazabilidad"]) {
      await page.getByRole("tab", { name: nombre, exact: true }).click();
    }
    await expect(page.locator('[data-part="live"]')).not.toHaveAttribute("data-availability", "verifying", { timeout: 10_000 });
    await page.getByRole("button", { name: "Reiniciar", exact: true }).click();
    await page.getByRole("button", { name: "Reproducir", exact: true }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "En Vivo", exact: true }).click();
    fixtureOperation(servidor.run, "add_check");
    await expect(page.locator('[data-part="cards"] li[data-event-id]')).toHaveCount(3, { timeout: 20_000 });
    await page.waitForTimeout(1000);
    const tras = await page.evaluate(() => window.__mensajes.length);
    // Reposo: el colector sigue sondeando y reescaneando (cada 10 s) sin cambios.
    await page.waitForTimeout(22_000);
    const mensajes = await page.evaluate(() => window.__mensajes.map((m) => m.texto));
    const limpios = mensajes.map((m) => m.trim()).filter(Boolean);
    for (let i = 1; i < limpios.length; i += 1) {
      expect(limpios[i], `mensaje repetido: ${JSON.stringify(limpios)}`).not.toBe(limpios[i - 1]);
    }
    // La llegada de E000003 se anunció y el reposo no anunció nada.
    expect(limpios.some((m) => m.includes("E000003"))).toBe(true);
    expect(mensajes.slice(tras), `anuncios en reposo: ${JSON.stringify(mensajes.slice(tras))}`).toEqual([]);
    // Ningún anuncio por fotograma del revelado: pocos mensajes en total.
    expect(limpios.length).toBeLessThanOrEqual(6);
  });
});

test.describe("AX-01 diálogos", () => {
  test("Preferencias y Contexto de raíz: foco dentro, Escape y retorno al invocador", async ({ page }) => {
    await installFakeEventSource(page);
    await openFixture(page);
    // En orden del documento: Firefox no da la vuelta al final de la página.
    await page.locator("body").focus();
    for (const [id, nombre] of [["#raiz", "Contexto de raíz"], ["#preferencias", "Preferencias"]]) {
      await tabularHasta(page, id);
      await page.keyboard.press("Enter");
      const dialogo = page.getByRole("dialog", { name: nombre });
      await expect(dialogo).toBeVisible();
      expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true);
      // El foco queda contenido en el diálogo modal.
      for (let i = 0; i < 8; i += 1) {
        await page.keyboard.press("Tab");
        expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest("dialog") !== null)).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(dialogo).toHaveCount(0);
      expect(await focoEn(page, id)).toBe(true);
    }
  });

  test("lista de actores: elegir devuelve el foco al invocador; si este desaparece, al control estable más próximo y visible", async ({ page }) => {
    const fuente = { traza: trazaSintetica(30, { actors: 12 }) };
    await installFakeEventSource(page);
    await page.route("**/api/runs/*/trace", (ruta) =>
      ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: fuente.traza, diagnostics: [] }) }),
    );
    await openFixture(page, { ruta: `/?run=${CLAVE}&tab=trazabilidad` });
    await expect(page.locator("[data-explorer]")).toBeVisible();
    const verTodos = control('[data-part="actors"] button', "Ver todos los actores");
    const verTodosVisible = page.locator('[data-part="actors"] button:text-is("Ver todos los actores")');
    await page.locator("body").focus();
    await tabularHasta(page, verTodos);
    await page.keyboard.press("Enter");
    const dialogo = page.getByRole("dialog", { name: /Actores/ });
    await expect(dialogo).toBeVisible();
    // Elegir con el teclado: el diálogo se cierra y el foco vuelve a «Ver todos».
    await tabularHasta(page, "dialog button[data-actor-key]");
    await page.keyboard.press("Enter");
    await expect(dialogo).toHaveCount(0);
    expect(await focoEn(page, verTodos)).toBe(true);

    // Con el diálogo abierto, una recarga deja solo 3 actores: «Ver todos» ya no se pinta.
    await page.keyboard.press("Enter");
    await expect(dialogo).toBeVisible();
    fuente.traza = trazaSintetica(30, { actors: 3 });
    await page.evaluate((clave) => window.__ccr.emitNotice({ kind: "run_changed", run_key: clave, cursor: 1, fingerprint: null }), CLAVE);
    await expect(page.locator('[data-part="actors"] button[data-actor-key]')).toHaveCount(3);
    await expect(verTodosVisible).toBeHidden();
    await page.keyboard.press("Escape");
    // El diálogo cerrado se retira del documento al terminar su evento `close`.
    await expect(page.locator("dialog")).toHaveCount(0);
    // El foco no se pierde: cae en un control visible y enfocable del explorador
    // (la franja de actores), con su anillo de foco visible.
    const destino = await page.evaluate(() => {
      const a = document.activeElement;
      const caja = a?.getBoundingClientRect();
      return {
        cuerpo: !a || a === document.body,
        enFranja: Boolean(a?.closest('[data-part="actors"]')),
        visible: Boolean(caja && caja.width > 0 && caja.height > 0),
        control: Boolean(a?.matches("button, input, select, textarea, a[href], summary")),
      };
    });
    expect(destino, await descripcionFoco(page)).toEqual({ cuerpo: false, enFranja: true, visible: true, control: true });
  });
});

for (const tema of ["light", "dark"]) {
  test(`foco visible en tema ${tema}: anillo de 2 px con contraste ≥ 3:1 en cada tipo de control`, async ({ page }) => {
    await installFakeEventSource(page);
    await page.route("**/api/runs/*/trace", (ruta) =>
      ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: trazaSintetica(12, { actors: 3 }), diagnostics: [] }) }),
    );
    await openFixture(page, { ruta: `/?run=${CLAVE}&tab=trazabilidad` });
    await page.locator("#tema").selectOption(tema);
    await expect(page.locator("html")).toHaveAttribute("data-theme", tema);
    await expect(page.locator("[data-explorer]")).toBeVisible();
    await page.locator("body").focus();
    const objetivos = [
      "#tema",
      "#preferencias",
      ".lista-revisiones button",
      '#barra-revision [role="tab"][aria-selected="true"]',
      '[data-part="live"] button[data-part="live-toggle"]',
      '[data-part="actors"] button[data-actor-key]',
      '[data-part="timeline"] button.marcador',
      '[data-part="controls"] button',
      '[data-part="controls"] select',
      '[data-part="controls"] input[type="range"]',
      '[data-part="search"] input[type="search"]',
      ".tarjetas-panel",
      '[data-part="cards"] .tarjeta-boton',
      // En orden del documento: Firefox no da la vuelta al final de la página.
      "#inspector button",
      "#inspector summary",
    ];
    const fallos = [];
    for (const selector of objetivos) {
      await tabularHasta(page, selector, { maximo: 150 });
      const foco = await page.evaluate(medirFoco);
      if (foco.estilo === "none" || foco.ancho < 2 || foco.contraste < 3 || !foco.visible) fallos.push({ selector, ...foco });
    }
    expect(fallos).toEqual([]);
  });
}
