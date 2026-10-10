import { expect, test } from "@playwright/test";

import { startFixtureServer } from "./server.mjs";

/**
 * Aceptación integrada contra el servidor real.
 *
 * No se intercepta ninguna ruta: la aplicación habla con el visor de verdad y
 * la política de seguridad se respeta íntegra.
 */
let servidor;

test.beforeAll(async () => {
  servidor = await startFixtureServer("final_v7");
});

test.afterAll(() => {
  servidor?.stop();
});

test.beforeEach(async ({ page }) => {
  await page.goto(servidor.url);
  await page.waitForSelector("#biblioteca .lista-revisiones button", { timeout: 20_000 });
});

test("establece la sesión con el token del fragmento", async ({ page }) => {
  // En Windows la ruta temporal puede aparecer con su alias corto (8.3): se
  // compara el nombre del directorio, que es estable en ambos casos.
  await expect(page.locator("#raiz")).toContainText("archivo");
  await expect(page.locator("#raiz")).toContainText("(explicit)");
  // El fragmento se limpia tras el canje.
  await expect(page).toHaveURL(/\/$/);
  expect(page.url()).not.toContain("token");
});

test("navega la biblioteca y abre una revisión", async ({ page }) => {
  await expect(page.locator("#biblioteca")).toContainText("cerrada");
  await page.locator(".lista-revisiones button").first().click();
  await expect(page.locator("#revision header.revision-encabezado h2")).toHaveText(
    "Revisión sintética de validación de entrada",
  );
  await expect(page.locator("#revision")).toContainText("CR-1111111111111111aaaa");
});

test("la trazabilidad llega del servidor y verifica su cadena", async ({ page }) => {
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Trazabilidad" }).click();
  await expect(page.locator("#revision")).toContainText("cadena verificada");
  await expect(page.locator(".hitos .hito").first()).toContainText("E000001");
});

test("el informe Markdown se renderiza sin peticiones remotas", async ({ page }) => {
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator(".documento-texto h1")).toHaveText("Informe de revision sintetica");
});

test("la validación declara integridad verificada sin tocar el archivo", async ({ page }) => {
  await page.locator(".lista-revisiones button").first().click();
  const respuesta = await page.evaluate(async () => {
    const clave = document.querySelector(".lista-revisiones button").dataset.key;
    const r = await fetch(`/api/runs/${clave}/validate`, {
      method: "POST",
      credentials: "same-origin",
    });
    return { estado: r.status, cuerpo: await r.json() };
  });
  expect(respuesta.estado).toBe(200);
  expect(respuesta.cuerpo.data.status).toBe("verified");
});

test("una petición sin sesión se rechaza", async ({ browser }) => {
  // El Host y el Origin los cubre tests/test_server.py a nivel HTTP: aquí se
  // comprueba que el navegador sin sesión previa tampoco entra.
  const contexto = await browser.newContext();
  try {
    const respuesta = await contexto.request.get(`${servidor.url.split("#")[0]}/api/config`);
    expect(respuesta.status()).toBe(403);
    const cuerpo = await respuesta.json();
    expect(cuerpo.error.code).toBe("session_required");
  } finally {
    await contexto.close();
  }
});

test("no se hacen peticiones fuera del bucle local", async ({ page }) => {
  const externas = [];
  page.on("request", (peticion) => {
    if (!peticion.url().startsWith("http://127.0.0.1")) externas.push(peticion.url());
  });
  await page.locator(".lista-revisiones button").first().click();
  await page.getByRole("tab", { name: "Documentos" }).click();
  await page.waitForTimeout(700);
  expect(externas).toHaveLength(0);
});