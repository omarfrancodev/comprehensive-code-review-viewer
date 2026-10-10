import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración de las pruebas de navegador.
 *
 * Sólo hay dos navegadores de escritorio; la disposición móvil se comprueba
 * reduciendo el ancho de la ventana, no añadiendo un tercer proyecto.
 * Ninguna prueba usa un archivo real: todas usan respuestas sintéticas.
 */
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  // La Tarea 10 sustituye este arranque por el servidor Python real; aquí basta
  // con publicar los recursos estáticos porque la API se intercepta.
  webServer: process.env.CCR_BASE_URL
    ? undefined
    : {
        command: "node tests/browser/static-server.mjs",
        url: "http://127.0.0.1:8765",
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
  use: {
    baseURL: process.env.CCR_BASE_URL ?? "http://127.0.0.1:8765",
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});