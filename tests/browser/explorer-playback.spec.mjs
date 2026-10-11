import { expect, test } from "@playwright/test";

import { trazaSintetica } from "../js/generators.mjs";
import { PREFS_KEY } from "../../src/ccr_viewer/web/prefs.js";
import { TRAZA_SINTETICA, openFixture } from "./support.mjs";

/**
 * Revelado progresivo del elemento y movimiento (TR-03, §7).
 *
 * El tiempo lo gobierna `page.clock`: el reloj se detiene tras abrir la traza
 * y solo avanza con `runFor`, así que reproducción, revelado y muestreo por
 * `requestAnimationFrame` son deterministas. Cada prueba vigila además que no
 * haya violaciones de la política de contenido (CSP) en todo el recorrido.
 */

const responder = (traza) => (ruta) =>
  ruta.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ api_version: 1, data: traza, diagnostics: [] }),
  });

const tarjetas = (page) => page.locator('[data-part="cards"] li[data-event-id]');
const tarjeta = (page, id) => page.locator(`[data-part="cards"] li[data-event-id="${id}"]`);
const tarjetaActual = (page) => page.locator('[data-part="cards"] li[aria-current="true"]');
const boton = (page, nombre) => page.getByRole("button", { name: nombre, exact: true });
const estados = (page) => tarjetas(page).evaluateAll((nodos) => nodos.map((n) => n.dataset.state));

/** Valor numérico de `--etapa-<nombre>` escrito en la tarjeta (`NaN` si no hay). */
const etapa = (page, id, nombre) =>
  tarjeta(page, id).evaluate((li, propiedad) => Number.parseFloat(li.style.getPropertyValue(propiedad)), `--etapa-${nombre}`);

/** Duración CSS computada en segundos (`"0.42s"`, `"420ms"`). */
const segundos = (valor) => {
  const primero = String(valor).split(",")[0].trim();
  return primero.endsWith("ms") ? Number.parseFloat(primero) / 1000 : Number.parseFloat(primero);
};

/** Abre la traza con el reloj instalado y lo detiene: el tiempo solo avanza con `runFor`. */
async function abrirTraza(page, traza = TRAZA_SINTETICA) {
  await page.clock.install();
  await page.route("**/api/runs/*/trace", responder(traza));
  await openFixture(page);
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("[data-explorer]")).toBeVisible();
  await expect(tarjetas(page).first()).toBeVisible();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
}

/** «Reiniciar» y «Reproducir»: E000001 se revela desde cero a la velocidad elegida. */
async function reiniciarYReproducir(page) {
  await boton(page, "Reiniciar").click();
  await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "revealing");
  await boton(page, "Reproducir").click();
  await expect(boton(page, "Pausar")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const csp = [];
  page.on("console", (mensaje) => {
    if (/content[ -]security[ -]policy/i.test(mensaje.text())) csp.push(mensaje.text());
  });
  await page.addInitScript(() => {
    window.__violacionesCsp = [];
    document.addEventListener("securitypolicyviolation", (evento) => {
      window.__violacionesCsp.push(`${evento.violatedDirective} ${evento.blockedURI}`);
    });
  });
  page.__mensajesCsp = csp;
});

test.afterEach(async ({ page }) => {
  // Sin violaciones CSP en ninguna prueba del recorrido.
  const violaciones = await page.evaluate(() => window.__violacionesCsp ?? []).catch(() => []);
  expect(violaciones).toEqual([]);
  expect(page.__mensajesCsp).toEqual([]);
});

test.describe("revelado progresivo del elemento", () => {
  test("sin autoplay: al abrir todo está completo y el botón dice «Reproducir»", async ({ page }) => {
    await abrirTraza(page);
    expect(await estados(page)).toEqual(["complete", "complete", "complete"]);
    await expect(boton(page, "Reproducir")).toBeVisible();
    await page.clock.runFor(5000);
    expect(await estados(page)).toEqual(["complete", "complete", "complete"]);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000003");
    await expect(boton(page, "Reproducir")).toBeVisible();
  });

  test("Reiniciar: solo hay una tarjeta presentada y está en revealing", async ({ page }) => {
    await abrirTraza(page);
    await boton(page, "Reiniciar").click();
    expect(await estados(page)).toEqual(["revealing", "received", "received"]);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    // En pausa el revelado queda en su punto inicial: nada avanza solo.
    await page.clock.runFor(3000);
    expect(await estados(page)).toEqual(["revealing", "received", "received"]);
    expect(await etapa(page, "E000001", "estructura")).toBe(0);
  });

  test("Reproducir: la siguiente aparece tras 2350 ms a 1× y sin anuncios por fotograma", async ({ page }) => {
    await abrirTraza(page);
    await page.evaluate(() => {
      window.__anuncios = 0;
      new MutationObserver(() => { window.__anuncios += 1; })
        .observe(document.getElementById("anunciador"), { childList: true, characterData: true, subtree: true });
    });
    await reiniciarYReproducir(page);
    await page.clock.runFor(2340);
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "received");
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    await page.clock.runFor(20);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "revealing");
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "complete");
    await page.clock.runFor(2400);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000003");
    // La región polite no cambia por fotogramas ni por pasos del recorrido.
    expect(await page.evaluate(() => window.__anuncios)).toBe(0);
  });

  test("Reproducir a 2×: la siguiente aparece tras 1175 ms", async ({ page }) => {
    await abrirTraza(page);
    await page.getByRole("combobox", { name: "Velocidad" }).selectOption("2");
    await reiniciarYReproducir(page);
    await page.clock.runFor(1165);
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "received");
    await page.clock.runFor(20);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "revealing");
  });

  test("etapas: estructura, contenido y acciones solapadas sin saltos de altura", async ({ page }) => {
    await abrirTraza(page);
    await boton(page, "Reiniciar").click();
    const altoInicial = await tarjeta(page, "E000001").evaluate((li) => li.getBoundingClientRect().height);
    // El brillo de presentación se anima durante el revelado.
    expect(await tarjeta(page, "E000001").locator('[data-part="shimmer"]').evaluate((n) => getComputedStyle(n).animationName)).not.toBe("none");
    await boton(page, "Reproducir").click();

    // ~21 %: la estructura casi completa y las acciones aún ocultas.
    await page.clock.runFor(385);
    expect(await etapa(page, "E000001", "estructura")).toBeGreaterThanOrEqual(0.9);
    expect(await etapa(page, "E000001", "acciones")).toBe(0);

    // ~50 %: el contenido a medio revelar.
    await page.clock.runFor(515);
    const contenido = await etapa(page, "E000001", "contenido");
    expect(contenido).toBeGreaterThan(0);
    expect(contenido).toBeLessThan(1);
    expect(await etapa(page, "E000001", "cabecera")).toBe(1);

    // Termina el revelado (1800 ms) y empieza la separación de 550 ms.
    await page.clock.runFor(960);
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "complete");
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "received");
    const altoFinal = await tarjeta(page, "E000001").evaluate((li) => li.getBoundingClientRect().height);
    // Espacio estable: la tarjeta ocupa desde el principio su altura final.
    expect(Math.abs(altoFinal - altoInicial)).toBeLessThanOrEqual(1);
    await expect(boton(page, "Mostrar tarjeta completa")).toHaveAttribute("aria-disabled", "true");
  });

  test("pausa congela el revelado y al reanudar continúa", async ({ page }) => {
    await abrirTraza(page);
    await reiniciarYReproducir(page);
    await page.clock.runFor(900);
    await boton(page, "Pausar").click();
    await expect(boton(page, "Reproducir")).toBeVisible();
    const congelado = await etapa(page, "E000001", "contenido");
    expect(congelado).toBeGreaterThan(0);
    await page.clock.runFor(3000);
    expect(await etapa(page, "E000001", "contenido")).toBe(congelado);
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "revealing");
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    await boton(page, "Reproducir").click();
    await page.clock.runFor(100);
    expect(await etapa(page, "E000001", "contenido")).toBeGreaterThan(congelado);
  });

  test("«Mostrar tarjeta completa» termina el efecto y no reanuda", async ({ page }) => {
    await abrirTraza(page);
    await boton(page, "Reiniciar").click();
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "revealing");
    await boton(page, "Mostrar tarjeta completa").click();
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "complete");
    await expect(boton(page, "Reproducir")).toBeVisible();
    await page.clock.runFor(3000);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "received");

    // Durante la reproducción termina el efecto sin pausar.
    await reiniciarYReproducir(page);
    await page.clock.runFor(500);
    await boton(page, "Mostrar tarjeta completa").click();
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "complete");
    await expect(boton(page, "Pausar")).toBeVisible();
  });

  test("foco: los botones de acción ocultos son inertes y el botón principal describe el resumen completo", async ({ page }) => {
    await abrirTraza(page);
    await boton(page, "Reiniciar").click();
    const primera = tarjeta(page, "E000001");
    await expect(primera).toHaveAttribute("data-state", "revealing");
    expect(await etapa(page, "E000001", "estructura")).toBe(0);
    // Solo los botones son inertes; el pie con sus datos no lo es.
    const botones = primera.locator('[data-part="action-buttons"]');
    await expect(botones).toHaveAttribute("inert", "");
    await expect(primera.locator('[data-part="actions"]')).not.toHaveAttribute("inert", /.*/);
    const copiar = primera.locator(".tarjeta-copiar");
    await copiar.evaluate((nodo) => nodo.focus());
    await expect(copiar).not.toBeFocused();

    // Tipo, estado original y hora siguen accesibles, seleccionables y fuera de todo subárbol inerte.
    const datos = await primera.locator('[data-part="actions"]').evaluate((pie) =>
      [".tarjeta-tipo", ".tarjeta-estado", ".hito-tiempo"].map((selector) => {
        const nodo = pie.querySelector(selector);
        window.getSelection().selectAllChildren(nodo);
        return { inerte: nodo.closest("[inert]") !== null, seleccion: window.getSelection().toString() };
      }));
    expect(datos.map((dato) => dato.inerte)).toEqual([false, false, false]);
    expect(datos[0].seleccion).toBe("prepare");
    expect(datos[1].seleccion).toBe("completed");
    expect(datos[2].seleccion).toContain("respaldo de registro");
    await expect(primera.getByText("prepare", { exact: true })).toBeVisible();
    await expect(primera.getByText("completed", { exact: true })).toBeVisible();
    const arbol = await primera.ariaSnapshot();
    expect(arbol).toContain("prepare");
    expect(arbol).toContain("completed");
    expect(arbol).toContain("respaldo de registro");

    const principal = primera.locator("button.tarjeta-boton");
    const descrito = await principal.getAttribute("aria-describedby");
    expect(descrito).toBeTruthy();
    await expect(page.locator(`[id="${descrito}"]`)).toHaveText("Archivo sintético preparado");
    await expect(principal).toHaveAccessibleDescription("Archivo sintético preparado");

    // Con el teclado, el tabulador salta los botones ocultos.
    await principal.focus();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-event-id="E000001"] [data-part="actions"]')))).toBe(false);

    await boton(page, "Mostrar tarjeta completa").click();
    await expect(botones).not.toHaveAttribute("inert", /.*/);
    await copiar.focus();
    await expect(copiar).toBeFocused();
  });

  test("buscar parte del resumen aún oculto encuentra la tarjeta en revelado", async ({ page }) => {
    await abrirTraza(page);
    await boton(page, "Reiniciar").click();
    expect(await etapa(page, "E000001", "contenido")).toBe(0);
    // La selección del texto usa el resumen completo, nunca una versión parcial.
    const seleccion = await tarjeta(page, "E000001").locator('[data-part="content"]').evaluate((nodo) => {
      window.getSelection().selectAllChildren(nodo);
      return window.getSelection().toString();
    });
    expect(seleccion).toBe("Archivo sintético preparado");
    await page.getByRole("searchbox", { name: "Buscar hitos" }).fill("sintético preparado");
    await expect(tarjetas(page)).toHaveCount(1);
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "revealing");
  });

  test("copiar el resumen durante el revelado copia el texto completo", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "permisos de portapapeles solo en Chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await abrirTraza(page);
    await reiniciarYReproducir(page);
    // 72 %: las acciones ya aparecen y el revelado sigue en curso.
    await page.clock.runFor(1300);
    const primera = tarjeta(page, "E000001");
    await expect(primera).toHaveAttribute("data-state", "revealing");
    await expect(primera.locator('[data-part="action-buttons"]')).not.toHaveAttribute("inert", /.*/);
    await primera.getByRole("button", { name: /Copiar resumen/ }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Archivo sintético preparado");
  });

  test("movimiento reducido del sistema: tarjetas completas al instante y espera 2350/velocidad", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await abrirTraza(page);
    await comprobarSinAnimaciones(page);
  });

  test("«Sin animaciones» de la UI: mismo resultado con html[data-motion=reduce]", async ({ page }) => {
    await page.addInitScript((clave) => localStorage.setItem(clave, JSON.stringify({ motion: "reduce" })), PREFS_KEY);
    await abrirTraza(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await comprobarSinAnimaciones(page);
  });

  test("pausa por contexto: pestaña, página oculta o diálogo pausan y al volver no reanudan", async ({ page }) => {
    await abrirTraza(page);

    // Cambiar de pestaña.
    await reiniciarYReproducir(page);
    await page.clock.runFor(600);
    await page.getByRole("tab", { name: "Resumen" }).click();
    await page.clock.runFor(3000);
    await page.getByRole("tab", { name: "Trazabilidad" }).click();
    await expect(boton(page, "Reproducir")).toBeVisible();
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
    await expect(tarjeta(page, "E000001")).toHaveAttribute("data-state", "revealing");
    const tras = await etapa(page, "E000001", "contenido");
    await page.clock.runFor(3000);
    expect(await etapa(page, "E000001", "contenido")).toBe(tras);

    // Ocultar la página.
    await boton(page, "Reproducir").click();
    await page.clock.runFor(200);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(boton(page, "Reproducir")).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const oculta = await etapa(page, "E000001", "contenido");
    await page.clock.runFor(3000);
    await expect(boton(page, "Reproducir")).toBeVisible();
    expect(await etapa(page, "E000001", "contenido")).toBe(oculta);

    // Abrir un diálogo.
    await boton(page, "Reproducir").click();
    await page.clock.runFor(200);
    await page.getByRole("button", { name: "Preferencias" }).click();
    await expect(page.getByRole("dialog", { name: "Preferencias" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(boton(page, "Reproducir")).toBeVisible();
    const dialogo = await etapa(page, "E000001", "contenido");
    await page.clock.runFor(3000);
    expect(await etapa(page, "E000001", "contenido")).toBe(dialogo);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
  });

  test("duraciones: cursor ≤0.42 s, inspector 0.16–0.18 s y pulso de llegada ≤0.56 s", async ({ page }) => {
    await abrirTraza(page);
    const cursor = segundos(await page.locator('[data-part="cursor"]').evaluate((n) => getComputedStyle(n).transitionDuration));
    expect(cursor).toBeGreaterThan(0);
    expect(cursor).toBeLessThanOrEqual(0.42);
    const inspector = segundos(await page.locator('#inspector [data-part="inspector-body"]').evaluate((n) => getComputedStyle(n).transitionDuration));
    expect(inspector).toBeGreaterThanOrEqual(0.16);
    expect(inspector).toBeLessThanOrEqual(0.18);
    await boton(page, "Reiniciar").click();
    const pulso = await tarjeta(page, "E000001").evaluate((n) => {
      const estilo = getComputedStyle(n);
      return { nombre: estilo.animationName, duracion: estilo.animationDuration, veces: estilo.animationIterationCount };
    });
    expect(pulso.nombre).not.toBe("none");
    expect(segundos(pulso.duracion)).toBeGreaterThan(0);
    expect(segundos(pulso.duracion)).toBeLessThanOrEqual(0.56);
    expect(pulso.veces).toBe("1");
  });

  test("seguir recorrido: desplazar el panel lo desactiva y las llegadas no mueven la página", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await abrirTraza(page, trazaSintetica(30));
    await reiniciarYReproducir(page);
    await page.clock.runFor(2400);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
    const seguir = boton(page, "Seguir recorrido");
    await expect(seguir).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.scrollTo(0, 120));
    const panel = page.locator(".tarjetas-panel");
    await panel.evaluate((nodo) => { nodo.scrollTop = 400; });
    await expect(seguir).toHaveAttribute("aria-pressed", "false");
    const paginaY = await page.evaluate(() => window.scrollY);
    // Tarjeta visible en lo alto del panel y su posición: las llegadas no la mueven.
    const visible = () => panel.evaluate((nodo) => {
      const arriba = nodo.getBoundingClientRect().top;
      const li = [...nodo.querySelectorAll("li[data-event-id]")].find((n) => n.getBoundingClientRect().bottom > arriba + 1);
      return li ? { id: li.dataset.eventId, top: Math.round(li.getBoundingClientRect().top - arriba) } : null;
    });
    const antes = await visible();
    expect(antes).not.toBeNull();
    await page.clock.runFor(2350 * 3);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000005");
    expect(await page.evaluate(() => window.scrollY)).toBe(paginaY);
    expect(await visible()).toEqual(antes);
    await expect(seguir).toHaveAttribute("aria-pressed", "false");
  });

  test("una región fijada por el foco vuelve a seguir la selección al salir el foco", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(60));
    await boton(page, "Ventana anterior").click();
    await page.locator('[data-part="timeline"] button[data-event-id="E000050"]').click();
    await expect(page.locator('[data-part="timeline"]')).toContainText("1–50 de 60");
    // Avance sin mover el foco: el timeline enfocado conserva su ventana.
    await page.evaluate(() => [...document.querySelectorAll("[data-explorer] button")].find((b) => b.textContent === "Reproducir").click());
    await page.clock.runFor(2360);
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000051");
    await expect(page.locator('[data-part="timeline"]')).toContainText("1–50 de 60");
    // El foco sale del timeline: la ventana vuelve a la de la selección.
    await page.getByRole("searchbox", { name: "Buscar hitos" }).focus();
    await expect(page.locator('[data-part="timeline"]')).toContainText("51–60 de 60");
    await expect(page.locator('[data-part="timeline"] button[aria-current="true"]')).toHaveAttribute("data-event-id", "E000051");
  });

  test("sin violaciones CSP durante todo el recorrido", async ({ page }) => {
    await abrirTraza(page, trazaSintetica(5));
    await reiniciarYReproducir(page);
    await page.clock.runFor(2350 * 2 + 900);
    await boton(page, "Pausar").click();
    await boton(page, "Mostrar tarjeta completa").click();
    await page.getByRole("combobox", { name: "Velocidad" }).selectOption("4");
    await boton(page, "Reproducir").click();
    await page.clock.runFor(2350);
    await page.getByRole("searchbox", { name: "Buscar hitos" }).fill("Evento");
    await boton(page, "Ir al último").click();
    await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000005");
    expect(await page.evaluate(() => window.__violacionesCsp)).toEqual([]);
  });
});

/** Movimiento reducido (sistema o preferencia): completas al instante, sin animaciones y pasos de 2350/velocidad. */
async function comprobarSinAnimaciones(page) {
  expect(await estados(page)).toEqual(["complete", "complete", "complete"]);
  await boton(page, "Reiniciar").click();
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
  expect(await estados(page)).toEqual(["complete", "received", "received"]);
  // El brillo (carga del revelado) queda sin animación aunque una tarjeta se revelara.
  const brillo = await tarjeta(page, "E000001").evaluate((li) => {
    li.dataset.state = "revealing";
    const nodo = li.querySelector('[data-part="shimmer"]');
    const estilo = { brillo: getComputedStyle(nodo).animationName, pulso: getComputedStyle(li).animationName };
    li.dataset.state = "complete";
    return estilo;
  });
  expect(brillo).toEqual({ brillo: "none", pulso: "none" });
  expect(segundos(await page.locator('[data-part="cursor"]').evaluate((n) => getComputedStyle(n).transitionDuration))).toBe(0);

  // Los controles y el avance discreto siguen disponibles.
  await boton(page, "Reproducir").click();
  await expect(boton(page, "Pausar")).toBeVisible();
  await page.clock.runFor(2340);
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000001");
  await page.clock.runFor(20);
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
  await expect(tarjeta(page, "E000002")).toHaveAttribute("data-state", "complete");
  await boton(page, "Pausar").click();
  await page.getByRole("combobox", { name: "Velocidad" }).selectOption("2");
  await boton(page, "Reproducir").click();
  await page.clock.runFor(1165);
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
  await page.clock.runFor(20);
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000003");
  await expect(tarjeta(page, "E000003")).toHaveAttribute("data-state", "complete");
  await boton(page, "Evento anterior").click();
  await expect(tarjetaActual(page)).toHaveAttribute("data-event-id", "E000002");
}
