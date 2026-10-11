import { expect, test } from "@playwright/test";

import { bibliotecaSintetica } from "../js/generators.mjs";
import { REVISION_SINTETICA, openFixture } from "./support.mjs";

/**
 * UI-01: biblioteca compacta, filtros tipados y paginación con 1000 corridas
 * sintéticas. Las peticiones a `/api/runs` se registran para comprobar qué se
 * pide y cuándo; las respuestas salen de la réplica del filtrado del servidor.
 */

const respuesta = (ruta, data, status = 200) =>
  ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify({ api_version: 1, data, diagnostics: [] }) });

const FALLO = { api_version: 1, error: { code: "read_failed", message: "Lectura sintética fallida de la biblioteca." } };

/** Registra los parámetros de cada petición a la biblioteca. */
function registrar(page) {
  const pedidas = [];
  page.on("request", (peticion) => {
    const url = new URL(peticion.url());
    if (url.pathname === "/api/runs") pedidas.push(url.searchParams);
  });
  return pedidas;
}

/** Sustituye EventSource para entregar avisos a mano (`window.deliverNotice`). */
async function simularAvisos(page) {
  await page.addInitScript(() => {
    window.EventSource = class {
      addEventListener(type, callback) {
        if (type === "notice") window.deliverNotice = (notice) => callback({ data: JSON.stringify(notice) });
      }
      close() {}
    };
  });
}

const biblioteca = (page) => page.locator("#biblioteca");
const filas = (page) => page.locator("#biblioteca .lista-revisiones button.revision");
const resumen = (page) => page.locator("#biblioteca .biblioteca-resumen");
const busqueda = (page) => page.getByRole("searchbox", { name: "Buscar revisiones" });
const botonFiltros = (page) => page.locator("#biblioteca .filtros-boton");
const panel = (page) => page.locator("#biblioteca #filtros-avanzados");

async function abrirFiltros(page) {
  if ((await botonFiltros(page).getAttribute("aria-expanded")) !== "true") await botonFiltros(page).click();
  await expect(panel(page)).toBeVisible();
}

/** Deja que la aplicación termine de repintar tras una respuesta. */
const reposo = (page) =>
  page.evaluate(() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo))));

test.describe("UI-01 lista y paginación", () => {
  test("con 1000 corridas muestra 50 filas, total y página; tras filtrar, el total filtrado", async ({ page }) => {
    const library = bibliotecaSintetica(1000);
    const pedidas = registrar(page);
    await openFixture(page, { library });
    await expect(filas(page)).toHaveCount(50);
    await expect(resumen(page)).toHaveText("1000 revisiones · página 1 de 20");
    expect(pedidas.at(-1).get("limit")).toBe("50");
    expect(pedidas.at(-1).get("offset")).toBe("0");

    await abrirFiltros(page);
    await panel(page).getByLabel("Veredicto", { exact: true }).selectOption("approvable");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    const esperado = library.items.filter((item) => item.verdict === "approvable").length;
    await expect(resumen(page)).toHaveText(`${esperado} revisiones · página 1 de ${Math.ceil(esperado / 50)}`);
    await expect(filas(page)).toHaveCount(50);
    expect(pedidas.at(-1).get("verdict")).toBe("approvable");
  });

  test("el contador singular y la paginación recorren las páginas", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(120) });
    await expect(botonPagina(page, "Página anterior")).toBeDisabled();
    await botonPagina(page, "Página siguiente").click();
    await expect(resumen(page)).toHaveText("120 revisiones · página 2 de 3");
    expect(pedidas.at(-1).get("offset")).toBe("50");
    await botonPagina(page, "Página siguiente").click();
    await expect(resumen(page)).toHaveText("120 revisiones · página 3 de 3");
    await expect(filas(page)).toHaveCount(20);
    await expect(botonPagina(page, "Página siguiente")).toBeDisabled();
  });

  test("agrupa por repositorio sin repetir el alcance en cada fila", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(50) });
    const grupos = page.locator("#biblioteca .grupo-revisiones > h3");
    await expect(grupos).toHaveCount(5);
    const encabezados = await grupos.allTextContents();
    expect(new Set(encabezados).size).toBe(5);
    // El alcance («pr N») aparece en el título de la fila, no en el encabezado.
    for (const texto of encabezados) expect(texto).not.toMatch(/\bpr \d+/i);
    await expect(page.locator("#biblioteca .lista-revisiones .revision-titulo").first()).toHaveText("PR #1");
    await expect(filas(page)).toHaveCount(50);
  });

  test("con repositorios intercalados (orden por fecha) agrupa toda la página y conserva el orden", async ({ page }) => {
    const library = bibliotecaSintetica(30, { interleaved: true });
    await openFixture(page, { library });
    // Sin agrupar solo filas contiguas, los tres repositorios se repetirían 30 veces.
    const grupos = page.locator("#biblioteca .grupo-revisiones > h3");
    await expect(grupos).toHaveCount(3);
    const encabezados = await grupos.allTextContents();
    expect(new Set(encabezados).size).toBe(3);
    expect(encabezados).toEqual([...new Set(library.items.map((item) => item.repository_identity))]);
    // Dentro de cada grupo se respeta el orden del servidor, y el orden del DOM
    // (el del teclado) es el mismo que se ve: grupo a grupo.
    const mostradas = await filas(page).evaluateAll((nodos) => nodos.map((nodo) => nodo.dataset.key));
    const esperadas = encabezados.flatMap((repo) =>
      library.items.filter((item) => item.repository_identity === repo).map((item) => item.key),
    );
    expect(mostradas).toEqual(esperadas);
    expect(mostradas).toHaveLength(30);
  });

  test("muestra el repositorio declarado (esquema y «.git») y agrupa por la identidad normalizada", async ({ page }) => {
    const DECLARADO = "https://git.ejemplo.invalid/acme/demo.git";
    const IDENTIDAD = "git.ejemplo.invalid/acme/demo";
    const library = bibliotecaSintetica(3, { interleaved: true });
    // Filas 0 y 2 (no contiguas) del mismo repositorio, declarado de dos formas.
    library.items[0] = { ...library.items[0], repository_label: DECLARADO, repository_identity: IDENTIDAD };
    library.items[2] = { ...library.items[2], repository_label: IDENTIDAD, repository_identity: IDENTIDAD };
    const vista = structuredClone(REVISION_SINTETICA);
    vista.summary = { ...vista.summary, key: library.items[0].key, repository_label: DECLARADO, repository_identity: IDENTIDAD };
    await openFixture(page, {
      library,
      onRun: (ruta) => ruta.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ api_version: 1, data: vista, diagnostics: [] }) }),
    });

    const grupos = page.locator("#biblioteca .grupo-revisiones > h3");
    await expect(grupos).toHaveCount(2);
    await expect(grupos.first()).toHaveText(DECLARADO);
    const mostradas = await filas(page).evaluateAll((nodos) => nodos.map((nodo) => nodo.dataset.key));
    expect(mostradas).toEqual([library.items[0].key, library.items[2].key, library.items[1].key]);
    // Fila compacta: último segmento del valor declarado, con el valor completo en `title`.
    const repo = filas(page).first().locator(".revision-repo");
    await expect(repo).toHaveText("demo.git");
    await expect(repo).toHaveAttribute("title", DECLARADO);
    // Cada detalle muestra el repositorio que declaró su fila.
    await page.locator(`#biblioteca summary[data-detalle="${library.items[0].key}"]`).click();
    await expect(page.locator("#biblioteca .revision-campos").first()).toContainText(DECLARADO);
    await page.locator(`#biblioteca summary[data-detalle="${library.items[2].key}"]`).click();
    const detalle2 = page.locator("#biblioteca .revision-detalle").nth(1).locator(".revision-campos");
    await expect(detalle2).toContainText(IDENTIDAD);
    await expect(detalle2).not.toContainText(DECLARADO);

    // La sugerencia de filtro es la identidad con la que filtra el servidor, rotulada con lo declarado.
    await abrirFiltros(page);
    const opcion = page.locator("#biblioteca datalist[id$='repository'] option").first();
    await expect(opcion).toHaveAttribute("value", IDENTIDAD);
    await expect(opcion).toHaveAttribute("label", `Declarado: ${DECLARADO}`);
    await expect(panel(page).locator(".filtro-sugerencias").first()).toContainText("identidad normalizada");

    // Cabecera de la revisión y Resumen: también el valor declarado.
    await filas(page).first().click();
    await expect(page.locator("#cabecera-revision .encabezado-repositorio")).toHaveText(`Repositorio: ${DECLARADO}`);
    const campo = page.locator("#revision .campo").filter({ has: page.locator("dt", { hasText: /^Repositorio$/ }) });
    await expect(campo.locator("dd")).toHaveText(DECLARADO);
  });

  test("etiquetas coincidentes: dos filas «PR #42» muestran su ID de revisión distinto", async ({ page }) => {
    const library = bibliotecaSintetica(3, { sameTitle: true });
    await openFixture(page, { library });
    const titulos = await page.locator("#biblioteca .revision-titulo").allTextContents();
    expect(titulos).toEqual(["PR #42", "PR #42", "PR #42"]);
    const pistas = await page.locator("#biblioteca .revision-pista").allTextContents();
    expect(pistas).toEqual(library.items.map((item) => item.source_review_id));
    expect(new Set(pistas).size).toBe(3);
  });

  test("URL larga sin espacios: no desborda y el valor completo sigue accesible", async ({ page }) => {
    const library = bibliotecaSintetica(12, { longUrl: true });
    await openFixture(page, { library });
    for (const ancho of [1280, 375]) {
      await page.setViewportSize({ width: ancho, height: 800 });
      if (ancho < 800) await page.getByRole("button", { name: /biblioteca/i }).first().click();
      const medidas = await page.evaluate(() => {
        const nodo = document.getElementById("biblioteca");
        return { scroll: nodo.scrollWidth, ancho: nodo.clientWidth, pagina: document.documentElement.scrollWidth, ventana: window.innerWidth };
      });
      expect(medidas.scroll, `#biblioteca a ${ancho}px`).toBeLessThanOrEqual(medidas.ancho);
      expect(medidas.pagina, `página a ${ancho}px`).toBeLessThanOrEqual(medidas.ventana);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    const primera = library.items[0];
    // La etiqueta compacta puede truncarse; el atributo title conserva el valor completo.
    const titulo = await page.locator("#biblioteca .revision-titulo").first().getAttribute("title");
    expect(titulo).toBe(primera.scope_label);
    // «Ver detalle» muestra identidad, alcance y referencia completos.
    await page.getByText("Ver detalle", { exact: true }).first().click();
    const detalle = page.locator("#biblioteca .revision-campos").first();
    await expect(detalle).toContainText(primera.scope_reference);
    await expect(detalle).toContainText(primera.repository_identity);
    await expect(detalle).toContainText(primera.source_review_id);
  });
});

function botonPagina(page, nombre) {
  return page.locator("#biblioteca .paginacion").getByRole("button", { name: nombre });
}

test.describe("UI-01 filtros", () => {
  test("«open» es un selector Todas/Abiertas/Cerradas y la petición lleva open=true", async ({ page }) => {
    const library = bibliotecaSintetica(200);
    const pedidas = registrar(page);
    await openFixture(page, { library });
    await abrirFiltros(page);
    const selector = panel(page).getByLabel("Abiertas o cerradas", { exact: true });
    await expect(selector.locator("option")).toHaveText(["Todas", "Abiertas", "Cerradas"]);
    await selector.selectOption({ label: "Abiertas" });
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("open")).toBe("true");
    const abiertas = library.items.filter((item) => item.display_state !== "closed").length;
    await expect(resumen(page)).toHaveText(`${abiertas} revisiones · página 1 de ${Math.ceil(abiertas / 50)}`);
    await expect(page.getByRole("button", { name: "Abiertas", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "false");
  });

  test("los chips Todas/Abiertas aplican de inmediato", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await page.getByRole("button", { name: "Abiertas", exact: true }).click();
    await expect.poll(() => pedidas.at(-1).get("open")).toBe("true");
    await page.getByRole("button", { name: "Todas", exact: true }).click();
    await expect.poll(() => pedidas.at(-1).has("open")).toBe(false);
    await expect(page.getByRole("button", { name: "Todas", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("fechas con desde > hasta: «Aplicar» deshabilitado y mensaje vinculado por aria-describedby", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(30) });
    await abrirFiltros(page);
    await panel(page).getByLabel("Desde", { exact: true }).fill("2026-09-20");
    await panel(page).getByLabel("Hasta", { exact: true }).fill("2026-09-10");
    const aplicar = panel(page).getByRole("button", { name: "Aplicar" });
    await expect(aplicar).toBeDisabled();
    const error = panel(page).locator(".filtro-error:visible");
    await expect(error).toHaveCount(1);
    await expect(error).toContainText("posterior");
    const idError = await error.getAttribute("id");
    expect(idError).toBeTruthy();
    await expect(panel(page).getByLabel("Desde", { exact: true })).toHaveAttribute("aria-describedby", new RegExp(`\\b${idError}\\b`));
    await expect(panel(page).getByLabel("Desde", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(aplicar).toHaveAttribute("aria-describedby", new RegExp(`\\b${idError}\\b`));
    // Corregir el rango rehabilita «Aplicar» y oculta el mensaje.
    await panel(page).getByLabel("Hasta", { exact: true }).fill("2026-09-25");
    await expect(aplicar).toBeEnabled();
    await expect(panel(page).locator(".filtro-error:visible")).toHaveCount(0);
  });

  test("un chip rápido aplicado con el panel abierto no se revierte al pulsar «Aplicar»", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await abrirFiltros(page);
    await expect(panel(page).getByLabel("Abiertas o cerradas", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Abiertas", exact: true }).click();
    await expect.poll(() => pedidas.at(-1).get("open")).toBe("true");
    // El borrador refleja el filtro aplicado desde fuera del formulario.
    await expect(panel(page).getByLabel("Abiertas o cerradas", { exact: true })).toHaveValue("true");
    await panel(page).getByLabel("Veredicto", { exact: true }).selectOption("approvable");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("verdict")).toBe("approvable");
    expect(pedidas.at(-1).get("open")).toBe("true");
    await expect(page.getByRole("button", { name: "Abiertas", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("«Limpiar» con el panel abierto vacía los borradores y no reaplica valores viejos", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await abrirFiltros(page);
    await panel(page).getByLabel("Perfil", { exact: true }).selectOption("deep");
    await panel(page).getByLabel("Repositorio", { exact: true }).fill("git.ejemplo.invalid/acme/repo-001");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("profile")).toBe("deep");

    await abrirFiltros(page);
    await expect(panel(page).getByLabel("Perfil", { exact: true })).toHaveValue("deep");
    // Un borrador sin aplicar en otra clave se conserva al cambiar los filtros.
    await panel(page).getByLabel("Veredicto", { exact: true }).selectOption("not_approvable");
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect.poll(() => pedidas.at(-1).has("profile")).toBe(false);
    await expect(panel(page).getByLabel("Perfil", { exact: true })).toHaveValue("");
    await expect(panel(page).getByLabel("Repositorio", { exact: true })).toHaveValue("");
    await expect(panel(page).getByLabel("Veredicto", { exact: true })).toHaveValue("not_approvable");

    await panel(page).getByLabel("Tipo", { exact: true }).selectOption("review");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("kind")).toBe("review");
    expect(pedidas.at(-1).has("profile")).toBe(false);
    expect(pedidas.at(-1).has("repository")).toBe(false);
  });

  test("quitar un chip con el panel abierto actualiza solo su borrador", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await abrirFiltros(page);
    await panel(page).getByLabel("Perfil", { exact: true }).selectOption("deep");
    await panel(page).getByLabel("Tipo", { exact: true }).selectOption("review");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("kind")).toBe("review");
    await abrirFiltros(page);
    await page.getByRole("button", { name: "Quitar filtro Perfil: deep" }).click();
    await expect.poll(() => pedidas.at(-1).has("profile")).toBe(false);
    await expect(panel(page).getByLabel("Perfil", { exact: true })).toHaveValue("");
    await expect(panel(page).getByLabel("Tipo", { exact: true })).toHaveValue("review");
  });

  test("«Cancelar» descarta los borradores sin pedir nada", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(30) });
    const antes = pedidas.length;
    await abrirFiltros(page);
    await panel(page).getByLabel("Repositorio", { exact: true }).fill("git.ejemplo.invalid/acme/repo-001");
    await panel(page).getByLabel("Veredicto", { exact: true }).selectOption("not_approvable");
    await panel(page).getByRole("button", { name: "Cancelar" }).click();
    await expect(panel(page)).toBeHidden();
    await expect(botonFiltros(page)).toBeFocused();
    expect(pedidas.length).toBe(antes);
    await expect(botonFiltros(page)).toHaveText("Filtros");
    await abrirFiltros(page);
    await expect(panel(page).getByLabel("Repositorio", { exact: true })).toHaveValue("");
    await expect(panel(page).getByLabel("Veredicto", { exact: true })).toHaveValue("");
  });

  test("aplicar desde la página 2 pide offset=0 y los chips aplicados se pueden quitar", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(200) });
    await botonPagina(page, "Página siguiente").click();
    await expect(resumen(page)).toHaveText("200 revisiones · página 2 de 4");
    expect(pedidas.at(-1).get("offset")).toBe("50");

    await abrirFiltros(page);
    await panel(page).getByLabel("Perfil", { exact: true }).selectOption("deep");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("profile")).toBe("deep");
    expect(pedidas.at(-1).get("offset")).toBe("0");
    await expect(resumen(page)).toHaveText("50 revisiones · página 1 de 1");
    await expect(botonFiltros(page)).toHaveText("Filtros (1)");

    const chip = page.locator("#biblioteca .filtros-aplicados li");
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("Perfil: deep");
    await page.getByRole("button", { name: "Quitar filtro Perfil: deep" }).click();
    await expect(resumen(page)).toHaveText("200 revisiones · página 1 de 4");
    await expect(chip).toHaveCount(0);
    await expect(botonFiltros(page)).toBeFocused();
  });

  test("«Limpiar» quita todos los filtros, incluida la búsqueda", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await busqueda(page).fill("repo-001");
    await busqueda(page).press("Enter");
    await expect(resumen(page)).toHaveText("10 revisiones · página 1 de 1");
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect(resumen(page)).toHaveText("100 revisiones · página 1 de 2");
    await expect(busqueda(page)).toHaveValue("");
    await expect(busqueda(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Limpiar", exact: true })).toBeHidden();
    expect(pedidas.at(-1).has("q")).toBe(false);
  });

  test("enums: verdict ofrece los 4 valores del contrato y «Otro valor…» acepta texto libre", async ({ page }) => {
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(40) });
    await abrirFiltros(page);
    const selector = panel(page).getByLabel("Veredicto", { exact: true });
    const valores = await selector.locator("option").evaluateAll((opciones) => opciones.map((opcion) => opcion.value));
    expect(valores).toEqual([
      "", "approvable", "approvable_with_reservations", "not_approvable", "insufficient_evidence", "__otro__",
    ]);
    await expect(selector.locator("option").last()).toHaveText("Otro valor…");
    await expect(panel(page).getByLabel("Valor original de Veredicto")).toBeHidden();
    await selector.selectOption("__otro__");
    const libre = panel(page).getByLabel("Valor original de Veredicto");
    await expect(libre).toBeVisible();
    await libre.fill("  valor_futuro_del_contrato ");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect.poll(() => pedidas.at(-1).get("verdict")).toBe("valor_futuro_del_contrato");
    await expect(page.locator("#biblioteca .filtros-aplicados")).toContainText("Veredicto: valor_futuro_del_contrato");
    // El valor desconocido aplicado se recupera como «Otro valor…» al volver a abrir.
    await abrirFiltros(page);
    await expect(selector).toHaveValue("__otro__");
    await expect(libre).toHaveValue("valor_futuro_del_contrato");
  });

  test("las sugerencias de repositorio, modo y referencia son de la página actual y se etiquetan así", async ({ page }) => {
    const library = bibliotecaSintetica(30);
    await openFixture(page, { library });
    await abrirFiltros(page);
    const repos = await page.locator("#biblioteca datalist[id$='repository'] option").evaluateAll((o) => o.map((n) => n.value));
    expect(repos).toEqual([...new Set(library.items.map((item) => item.repository_identity))]);
    await expect(panel(page).locator(".filtro-sugerencias").first()).toContainText("Sugerencias de esta página");
    await expect(panel(page).locator(".filtro-sugerencias").first()).toContainText("no es un inventario completo");
    const modos = await page.locator("#biblioteca datalist[id$='mode'] option").evaluateAll((o) => o.map((n) => n.value));
    expect(modos).toEqual(["pr"]);
  });
});

test.describe("UI-01 búsqueda", () => {
  test("con reloj controlado: a 249 ms no pide, a 250 ms sí", async ({ page }) => {
    await page.clock.install();
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    const antes = pedidas.length;
    await busqueda(page).fill("repo-002");
    await page.clock.runFor(249);
    await page.waitForTimeout(150);
    expect(pedidas.length).toBe(antes);
    await page.clock.runFor(1);
    await expect.poll(() => pedidas.length).toBe(antes + 1);
    expect(pedidas.at(-1).get("q")).toBe("repo-002");
    expect(pedidas.at(-1).get("offset")).toBe("0");
  });

  test("seguir escribiendo reinicia la espera: una sola petición con el valor final", async ({ page }) => {
    await page.clock.install();
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    const antes = pedidas.length;
    await busqueda(page).fill("rep");
    await page.clock.runFor(200);
    await busqueda(page).fill("repo-003");
    await page.clock.runFor(200);
    await page.waitForTimeout(150);
    expect(pedidas.length).toBe(antes);
    await page.clock.runFor(60);
    await expect.poll(() => pedidas.length).toBe(antes + 1);
    expect(pedidas.at(-1).get("q")).toBe("repo-003");
  });

  test("Enter pide de inmediato", async ({ page }) => {
    await page.clock.install();
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    const antes = pedidas.length;
    await busqueda(page).fill("repo-004");
    await busqueda(page).press("Enter");
    await expect.poll(() => pedidas.length).toBe(antes + 1);
    expect(pedidas.at(-1).get("q")).toBe("repo-004");
  });

  test("foco, caret y valor sobreviven a una recarga por aviso", async ({ page }) => {
    await simularAvisos(page);
    const pedidas = registrar(page);
    await openFixture(page, { library: bibliotecaSintetica(100) });
    await busqueda(page).click();
    await busqueda(page).pressSequentially("repo-005");
    await expect.poll(() => pedidas.at(-1).get("q")).toBe("repo-005");
    await expect(resumen(page)).toHaveText("10 revisiones · página 1 de 1");
    await busqueda(page).evaluate((entrada) => entrada.setSelectionRange(3, 3));

    const antes = pedidas.length;
    const recarga = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/runs");
    await page.evaluate(() => window.deliverNotice({ kind: "catalog_changed", cursor: 7 }));
    await recarga;
    await reposo(page);
    expect(pedidas.length).toBe(antes + 1);
    await expect(busqueda(page)).toBeFocused();
    await expect(busqueda(page)).toHaveValue("repo-005");
    const caret = await busqueda(page).evaluate((entrada) => [entrada.selectionStart, entrada.selectionEnd]);
    expect(caret).toEqual([3, 3]);
  });
});

test.describe("UI-01 estados, selección y recarga", () => {
  test("cambiar de filtro no cambia la revisión abierta aunque su fila deje de coincidir", async ({ page }) => {
    const library = bibliotecaSintetica(20);
    // La primera corrida es la sintética completa para poder abrirla.
    library.items[0] = { ...library.items[0], ...REVISION_SINTETICA.summary, verdict: "approvable", repository_identity: "git.ejemplo.invalid/acme/repo-000" };
    await openFixture(page, { library });
    await page.locator("#biblioteca .lista-revisiones button.revision").first().click();
    await expect(page.locator("#revision")).toContainText("Revisión sintética de validación");
    const ruta = new URL(page.url()).search;
    expect(ruta).toContain(`run=${REVISION_SINTETICA.summary.key}`);

    await abrirFiltros(page);
    await panel(page).getByLabel("Veredicto", { exact: true }).selectOption("not_approvable");
    await panel(page).getByRole("button", { name: "Aplicar" }).click();
    await expect(page.locator(`#biblioteca button.revision[data-key="${REVISION_SINTETICA.summary.key}"]`)).toHaveCount(0);
    await expect(page.locator("#revision")).toContainText("Revisión sintética de validación");
    expect(new URL(page.url()).search).toBe(ruta);
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
  });

  test("al seleccionar una fila solo esa queda activa y conserva el foco", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(5) });
    const segunda = page.locator("#biblioteca button.revision").nth(1);
    await segunda.click();
    await expect(segunda).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('#biblioteca button.revision[aria-pressed="true"]')).toHaveCount(1);
    await expect(segunda).toBeFocused();
    await page.locator("#biblioteca button.revision").nth(3).click();
    await expect(segunda).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('#biblioteca button.revision[aria-pressed="true"]')).toHaveCount(1);
  });

  test("el detalle abierto de una fila sobrevive a una recarga de la lista", async ({ page }) => {
    await simularAvisos(page);
    const library = bibliotecaSintetica(5);
    await openFixture(page, { library });
    const detalle = page.locator("#biblioteca .revision-detalle").nth(2);
    await detalle.locator("summary").click();
    await expect(detalle).toHaveAttribute("open", "");
    const recarga = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/runs");
    await page.evaluate(() => window.deliverNotice({ kind: "catalog_changed", cursor: 4 }));
    await recarga;
    await reposo(page);
    await expect(page.locator("#biblioteca .revision-detalle").nth(2)).toHaveAttribute("open", "");
    await expect(page.locator("#biblioteca .revision-detalle[open]")).toHaveCount(1);
  });

  test("estado: biblioteca vacía", async ({ page }) => {
    await openFixture(page, { library: { items: [], total: 0 } });
    const estado = page.locator('#biblioteca [data-estado="vacia"]');
    await expect(estado).toContainText("No hay revisiones archivadas");
    await expect(page.locator('#biblioteca [data-estado="sin-coincidencias"]')).toHaveCount(0);
    await expect(page.locator("#biblioteca .paginacion")).toBeHidden();
  });

  test("estado: sin coincidencias es distinto de vacía y se sale con «Limpiar»", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(20) });
    await busqueda(page).fill("no-existe-ninguna");
    await busqueda(page).press("Enter");
    const estado = page.locator('#biblioteca [data-estado="sin-coincidencias"]');
    await expect(estado).toContainText("Ninguna revisión coincide");
    await expect(page.locator('#biblioteca [data-estado="vacia"]')).toHaveCount(0);
    await expect(filas(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Limpiar", exact: true }).click();
    await expect(filas(page)).toHaveCount(20);
  });

  test("estado: carga distinta de vacía", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(5) });
    let liberar;
    const espera = new Promise((resolver) => { liberar = resolver; });
    await page.route("**/api/runs?*", async (ruta) => {
      await espera;
      await respuesta(ruta, { items: [], total: 0, offset: 0, limit: 50 });
    });
    await page.reload();
    const carga = page.locator('#biblioteca [data-estado="cargando"]');
    await expect(carga).toContainText("Cargando revisiones");
    await expect(page.locator('#biblioteca [data-estado="vacia"]')).toHaveCount(0);
    liberar();
    await expect(page.locator('#biblioteca [data-estado="vacia"]')).toBeVisible();
    await expect(carga).toHaveCount(0);
  });

  test("estado: fallo sin lista previa muestra el error con reintento", async ({ page }) => {
    await openFixture(page, { library: bibliotecaSintetica(5) });
    await page.route("**/api/runs?*", (ruta) => ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(FALLO) }));
    await page.reload();
    const error = page.locator('#biblioteca [data-estado="error"]');
    await expect(error).toContainText("Lectura sintética fallida de la biblioteca.");
    await expect(page.locator('#biblioteca [data-estado="vacia"]')).toHaveCount(0);
    await expect(filas(page)).toHaveCount(0);

    await page.unroute("**/api/runs?*");
    await page.route("**/api/runs?*", (ruta) => respuesta(ruta, { items: bibliotecaSintetica(3).items, total: 3, offset: 0, limit: 50 }));
    await error.getByRole("button", { name: "Reintentar" }).click();
    await expect(filas(page)).toHaveCount(3);
    await expect(error).toHaveCount(0);
  });

  test("fallo de recarga: la lista permanece con el aviso «no está actualizada» y «Reintentar»", async ({ page }) => {
    await simularAvisos(page);
    await openFixture(page, { library: bibliotecaSintetica(30) });
    await expect(filas(page)).toHaveCount(30);
    await page.route("**/api/runs?*", (ruta) => ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(FALLO) }));
    await page.evaluate(() => window.deliverNotice({ kind: "catalog_changed", cursor: 3 }));
    const aviso = page.locator('#biblioteca [data-estado="desactualizada"]');
    await expect(aviso).toContainText("no está actualizada");
    await expect(filas(page)).toHaveCount(30);
    await expect(resumen(page)).toHaveText("30 revisiones · página 1 de 1");

    await page.unroute("**/api/runs?*");
    await page.route("**/api/runs?*", (ruta) => respuesta(ruta, { items: bibliotecaSintetica(31).items, total: 31, offset: 0, limit: 50 }));
    await aviso.getByRole("button", { name: "Reintentar" }).click();
    await expect(aviso).toHaveCount(0);
    await expect(filas(page)).toHaveCount(31);
  });

  test("un fallo de /api/config se muestra y se anuncia sin ocultar la biblioteca", async ({ page }) => {
    // La región polite es de un solo mensaje: se registran todos los anuncios.
    await page.addInitScript(() => {
      window.__anuncios = [];
      document.addEventListener("DOMContentLoaded", () => {
        const region = document.getElementById("anunciador");
        new MutationObserver(() => window.__anuncios.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
      });
    });
    await openFixture(page, { library: bibliotecaSintetica(6) });
    const mensaje = "Configuración sintética ilegible.";
    await page.route("**/api/config", (ruta) =>
      ruta.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ api_version: 1, error: { code: "config_failed", message: mensaje } }),
      }),
    );
    await page.reload();
    await expect(page.locator("#raiz")).toContainText(mensaje);
    await expect(page.locator("#raiz")).not.toContainText("Cargando la raíz");
    await expect.poll(async () => (await page.evaluate(() => window.__anuncios)).filter((texto) => texto.includes(mensaje)).length).toBe(1);
    await expect(filas(page)).toHaveCount(6);
    // El diálogo de la raíz explica el fallo en lugar de prometer disponibilidad.
    await page.locator("#raiz").click();
    await expect(page.getByRole("dialog", { name: "Contexto de raíz" })).toContainText(mensaje);
    await page.keyboard.press("Escape");
    await expect(filas(page)).toHaveCount(6);
  });

  test("un error al cargar una revisión no oculta la biblioteca", async ({ page }) => {
    const library = bibliotecaSintetica(8);
    await openFixture(page, { library });
    const clave = library.items[2].key;
    await page.route(`**/api/runs/${clave}`, (ruta) =>
      ruta.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify(FALLO) }),
    );
    await page.locator(`#biblioteca button.revision[data-key="${clave}"]`).click();
    await expect(page.locator("#revision")).toContainText("Lectura sintética fallida");
    await expect(filas(page)).toHaveCount(8);
    await expect(page.locator('#biblioteca [data-estado="error"]')).toHaveCount(0);
    await expect(page.locator('#biblioteca [data-estado="desactualizada"]')).toHaveCount(0);
    await expect(page.locator(`#biblioteca button.revision[data-key="${clave}"]`)).toHaveAttribute("aria-pressed", "true");
  });

  test("una respuesta obsoleta no pisa a la más reciente", async ({ page }) => {
    const library = bibliotecaSintetica(100);
    await openFixture(page, { library });
    let liberarPrimera;
    const primera = new Promise((resolver) => { liberarPrimera = resolver; });
    await page.route("**/api/runs?*", async (ruta) => {
      const consulta = new URL(ruta.request().url()).searchParams;
      if (consulta.get("q") === "repo-000") {
        await primera;
        // Respuesta tardía de un filtro que ya no es el aplicado.
        return respuesta(ruta, { items: library.items.slice(0, 10), total: 10, offset: 0, limit: 50 });
      }
      return respuesta(ruta, { items: library.items.slice(10, 20), total: 10, offset: 0, limit: 50 });
    });
    await busqueda(page).fill("repo-000");
    await busqueda(page).press("Enter");
    await busqueda(page).fill("repo-001");
    await busqueda(page).press("Enter");
    await expect(filas(page).first()).toHaveAttribute("data-key", library.items[10].key);
    liberarPrimera();
    await reposo(page);
    await expect(filas(page).first()).toHaveAttribute("data-key", library.items[10].key);
  });
});
