import { expect, test } from "@playwright/test";

import { openFixture, REVISION_SINTETICA } from "./support.mjs";

/**
 * Cabecera de la revisión y vistas Resumen, Seguimiento y Archivo (UI-02).
 * Todas las respuestas son sintéticas y públicas.
 */

const CLAVE = REVISION_SINTETICA.summary.key;
const OTRA = "b".repeat(32);
const ID_LARGO = `CR-${"0123456789abcdef".repeat(8)}zzzz`;

const responder = (ruta, data, status = 200) =>
  ruta.fulfill({ status, contentType: "application/json", body: JSON.stringify({ api_version: 1, data }) });

const cabecera = (page) => page.locator("#cabecera-revision");
const panel = (page) => page.locator("#revision");
const pestana = (page, nombre) => page.getByRole("tab", { name: nombre, exact: true });

/** Abre la primera revisión de la biblioteca sirviendo `vista` como su detalle. */
async function abrir(page, vista = REVISION_SINTETICA) {
  await openFixture(page);
  await page.route(`**/api/runs/${CLAVE}`, (ruta) => responder(ruta, vista));
  await page.locator(".lista-revisiones button").first().click();
  await expect(cabecera(page).locator("h2")).toBeVisible();
}

const conCambios = (cambios) => {
  const vista = structuredClone(REVISION_SINTETICA);
  return cambios(vista) ?? vista;
};

test.describe("cabecera de la revisión", () => {
  test("acompaña a todas las pestañas y no vive dentro del panel", async ({ page }) => {
    await abrir(page);
    await expect(cabecera(page).locator("header.revision-encabezado h2")).toHaveText("Revisión sintética de validación");
    for (const nombre of ["Resumen", "Hallazgos", "Validación", "Seguimiento", "Archivo"]) {
      await pestana(page, nombre).click();
      await expect(pestana(page, nombre)).toHaveAttribute("aria-selected", "true");
      await expect(cabecera(page)).toContainText("CR-1111111111111111aaaa");
      await expect(cabecera(page)).toContainText("git.ejemplo.invalid/acme/demo");
      await expect(panel(page).locator("header.revision-encabezado")).toHaveCount(0);
    }
  });

  test("separa cierre, veredicto, integridad y checks, con conteos que declaran su alcance", async ({ page }) => {
    await abrir(page);
    const encabezado = cabecera(page);
    await expect(encabezado.locator('[data-concepto="cierre"]')).toContainText("complete");
    await expect(encabezado.locator('[data-concepto="veredicto"]')).toContainText("approvable_with_reservations");
    await expect(encabezado.locator('[data-concepto="integridad"]')).toContainText("bajo demanda");
    await expect(encabezado.locator('[data-concepto="hallazgos"]')).toContainText("de esta revisión");
    await expect(encabezado.locator('[data-concepto="hallazgos"]')).toContainText("Confirmados 1");
    await expect(encabezado.locator('[data-concepto="comprobaciones"]')).toContainText("declaradas en esta revisión");
    await expect(encabezado.locator('[data-concepto="comprobaciones"]')).toContainText("Superadas 1");
    await expect(encabezado).not.toContainText(/puntuaci|%/i);
  });

  test("copiar ID copia el valor completo", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Solo Chromium permite conceder y leer el portapapeles en la prueba.");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    const vista = conCambios((v) => {
      v.summary.source_review_id = ID_LARGO;
      v.review.review_id = ID_LARGO;
    });
    await abrir(page, vista);
    await cabecera(page).getByRole("button", { name: "Copiar ID" }).click();
    await expect(cabecera(page).locator('[role="status"]')).toContainText("copiado");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ID_LARGO);
  });

  test("si el portapapeles rechaza, la página sigue y el ID queda a la vista", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denegado")) },
      });
    });
    const errores = [];
    page.on("pageerror", (error) => errores.push(error.message));
    await abrir(page);
    await cabecera(page).getByRole("button", { name: "Copiar ID" }).click();
    await expect(cabecera(page).locator('[role="status"]')).toContainText("No se pudo copiar");
    await expect(cabecera(page)).toContainText("CR-1111111111111111aaaa");
    await pestana(page, "Hallazgos").click();
    await expect(panel(page)).toContainText("Validación de entrada ausente");
    expect(errores).toEqual([]);
  });

  test("la región de estado de la copia está en el árbol de accesibilidad antes y después de copiar", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.resolve() },
      });
    });
    await abrir(page);
    const estado = cabecera(page).locator('.copiar-estado[role="status"]');
    const visibleParaAT = () =>
      estado.evaluate((nodo) => {
        const estilo = getComputedStyle(nodo);
        return { display: estilo.display, visibilidad: estilo.visibility, conectado: nodo.isConnected };
      });
    const antes = await visibleParaAT();
    expect(antes.conectado).toBe(true);
    expect(antes.display).not.toBe("none");
    expect(antes.visibilidad).not.toBe("hidden");
    await expect(estado).toHaveText("");
    // Vacía no deja hueco visible en la fila del ID.
    const hueco = await estado.evaluate((nodo) => nodo.getBoundingClientRect().width);
    expect(hueco).toBeLessThanOrEqual(1);

    await cabecera(page).getByRole("button", { name: "Copiar ID" }).click();
    await expect(estado).toHaveText("ID copiado.");
    const despues = await visibleParaAT();
    expect(despues.display).not.toBe("none");
    expect(despues.visibilidad).not.toBe("hidden");
    await expect(estado).toBeVisible();
  });

  test("un ID largo sin espacios no desborda la página a 375 px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const vista = conCambios((v) => {
      v.summary.source_review_id = ID_LARGO;
      v.review.review_id = ID_LARGO;
      v.review.scope.reference = `https://git.ejemplo.invalid/${"segmento".repeat(20)}/merge_requests/42`;
    });
    await abrir(page, vista);
    await expect(cabecera(page)).toContainText(ID_LARGO);
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(desborde).toBeLessThanOrEqual(1);
  });

  test("no usa estilos en línea y la política de contenido no registra violaciones", async ({ page }) => {
    const consola = [];
    page.on("console", (mensaje) => consola.push(mensaje.text()));
    await abrir(page);
    await expect(cabecera(page).locator("[style]")).toHaveCount(0);
    await expect(panel(page).locator("[style]")).toHaveCount(0);
    expect(consola.filter((texto) => /content security policy|refused to apply inline style/i.test(texto))).toEqual([]);
  });

  test("sin selección la cabecera no ocupa espacio", async ({ page }) => {
    await openFixture(page);
    await expect(cabecera(page)).toBeHidden();
  });
});

test.describe("Resumen", () => {
  test("conserva el perfil original y muestra los campos sin presentación propia en un details", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.profile = "perfil_futuro";
      v.review.campo_futuro = { activo: true };
    });
    await abrir(page, vista);
    await expect(panel(page)).toContainText("perfil_futuro");
    const originales = panel(page).locator("details.campos-originales");
    await expect(originales).toHaveCount(1);
    await expect(originales).toContainText("campo_futuro");
    await originales.locator("summary").click();
    await expect(originales.locator("pre").first()).toBeVisible();
    await expect(originales).toContainText('"activo": true');
  });
});

test.describe("Seguimiento", () => {
  const vinculos = [
    { raw: "archivo/anterior", status: "resolved", run_key: OTRA, file_key: null, fragment: null, candidates: [], source: "rereview" },
    { raw: "archivo/ausente", status: "missing", run_key: null, file_key: null, fragment: null, candidates: ["archivo/ausente"], source: "previous_reviews" },
    { raw: "https://ejemplo.invalid/revision", status: "external", run_key: null, file_key: null, fragment: null, candidates: [], source: "rereview" },
  ];

  test("estructura las entradas de re-review y solo abre vínculos resueltos", async ({ page }) => {
    const anterior = conCambios((v) => {
      v.summary.key = OTRA;
      v.summary.scope_label = "pr 41";
      v.review.review_id = "CR-0000000000000000bbbb";
      v.summary.source_review_id = "CR-0000000000000000bbbb";
      v.review.presentation = { kind: "review", subject: "Revisión anterior sintética" };
    });
    const actual = conCambios((v) => {
      v.review.rereview = [
        {
          status: "resolved",
          details: "Corregido en la corrida actual.",
          previous_review_id: "CR-0000000000000000bbbb",
          previous_reference: "archivo/anterior",
          previous_finding_id: "F001",
          previous_title: "Título previo sintético",
          previous_url: null,
          check_ids: ["C001"],
        },
        { forma: "desconocida" },
      ];
      v.lineage = vinculos;
    });
    await openFixture(page);
    await page.route(`**/api/runs/${CLAVE}`, (ruta) => responder(ruta, actual));
    await page.route(`**/api/runs/${OTRA}`, (ruta) => responder(ruta, anterior));
    await page.locator(".lista-revisiones button").first().click();
    await pestana(page, "Seguimiento").click();

    await expect(panel(page)).toContainText("F001");
    await expect(panel(page)).toContainText("Título previo sintético");
    await expect(panel(page)).toContainText("Resuelto");
    await expect(panel(page)).toContainText("C001");
    // La forma desconocida conserva su JSON en un details secundario.
    const secundario = panel(page).locator("details", { hasText: "forma" });
    await expect(secundario).toHaveCount(1);
    await expect(secundario).toContainText('"forma": "desconocida"');

    const abrirAnterior = panel(page).getByRole("button", { name: "Abrir revisión anterior" });
    await expect(abrirAnterior).toHaveCount(1);
    await expect(panel(page)).toContainText("archivo/ausente");
    await expect(panel(page)).toContainText("https://ejemplo.invalid/revision");
    await abrirAnterior.click();
    await expect(cabecera(page).locator("h2")).toHaveText("Revisión anterior sintética");
    expect(new URL(page.url()).searchParams.get("run")).toBe(OTRA);
  });

  test("sin entradas declara la ausencia", async ({ page }) => {
    await abrir(page);
    await pestana(page, "Seguimiento").click();
    await expect(panel(page)).toContainText("Sin entradas de re-review declaradas");
    await expect(panel(page).getByRole("button", { name: "Abrir revisión anterior" })).toHaveCount(0);
  });
});

test.describe("Archivo", () => {
  test("«Verificar integridad» muestra su resultado en role=status y no cambia el veredicto", async ({ page }) => {
    await abrir(page);
    await page.route("**/api/runs/*/validate", (ruta) =>
      responder(ruta, {
        status: "failed",
        checks: [{ name: "hashes", status: "failed", detail: "review.json no coincide" }],
        diagnostics: [{ message: "Hash distinto al declarado." }],
      }),
    );
    const veredicto = cabecera(page).locator('[data-concepto="veredicto"]');
    const integridad = cabecera(page).locator('[data-concepto="integridad"]');
    const antes = await veredicto.innerText();
    const antesIntegridad = await integridad.innerText();
    await pestana(page, "Archivo").click();
    const resultado = panel(page).locator('[role="status"]');
    await expect(resultado).toHaveCount(1);
    await expect(resultado).toHaveText("");
    await panel(page).getByRole("button", { name: "Verificar integridad" }).click();
    await expect(resultado).toContainText("Integridad: failed");
    await expect(resultado).toContainText("review.json no coincide");
    await expect(resultado).toContainText("Hash distinto al declarado.");
    expect(await veredicto.innerText()).toBe(antes);
    expect(await integridad.innerText()).toBe(antesIntegridad);
    await expect(veredicto).toContainText("approvable_with_reservations");
  });

  test("residuos vacíos son ausencia declarada y el JSON original queda desplegable", async ({ page }) => {
    await abrir(page);
    await pestana(page, "Archivo").click();
    await expect(panel(page)).toContainText("Sin residuos declarados");
    const original = panel(page).locator("details", { hasText: "JSON original" });
    await expect(original).toHaveCount(1);
    await expect(original.locator("pre")).toBeHidden();
    await original.locator("summary").click();
    await expect(original.locator("pre")).toContainText('"schema_version": 7');
    // El «[]» solo aparece dentro del JSON secundario.
    await expect(panel(page).locator("p, li, dd").filter({ hasText: /^\[\]$/ })).toHaveCount(0);
  });

  test("los diagnósticos se agrupan por gravedad", async ({ page }) => {
    const vista = conCambios((v) => {
      v.diagnostics = [
        { code: "info.demo", severity: "info", message: "Aviso informativo.", source: null },
        { code: "error.demo", severity: "error", message: "Fallo declarado.", source: "cierre.json" },
        { code: "warn.demo", severity: "warning", message: "Advertencia declarada.", source: "review.json" },
      ];
    });
    await abrir(page, vista);
    await pestana(page, "Archivo").click();
    const grupos = panel(page).locator("[data-gravedad]");
    await expect(grupos).toHaveCount(3);
    await expect(grupos.nth(0)).toHaveAttribute("data-gravedad", "error");
    await expect(grupos.nth(0)).toContainText("error.demo");
    await expect(grupos.nth(1)).toHaveAttribute("data-gravedad", "warning");
    await expect(grupos.nth(2)).toHaveAttribute("data-gravedad", "info");
  });

  test("formas no admitidas conservan el aviso y el JSON original", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.findings = "no es una lista";
      v.review.dato_original = "conservado sin cambios";
      v.diagnostics = [
        { code: "adapter.invalid_shape", severity: "warning", message: "Hay campos con tipos no admitidos; se conservan los datos originales.", source: "review.json" },
      ];
    });
    await abrir(page, vista);
    await pestana(page, "Hallazgos").click();
    await expect(panel(page)).toContainText("La metadata contiene tipos no admitidos");
    await expect(cabecera(page)).toContainText("CR-1111111111111111aaaa");
    await panel(page).getByText("JSON original", { exact: true }).click();
    await expect(panel(page).locator("details pre")).toContainText("conservado sin cambios");
    await expect(panel(page).locator("details pre")).toContainText('"findings": "no es una lista"');
  });

  test("una vista que no se puede representar degrada a Archivo con aviso y conserva el JSON", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.change_authors = [null];
      v.review.dato_original = "dato conservado";
    });
    await abrir(page, vista);
    await expect(panel(page)).toContainText("No se pudo representar la metadata de esta vista");
    await expect(cabecera(page).locator("h2")).toBeVisible();
    await panel(page).getByText("JSON original", { exact: true }).click();
    await expect(panel(page).locator("details pre")).toContainText("dato conservado");
  });
});

// --- Hallazgos, Validación y Documentos (UI-02, parte 2) --------------------

const SEGUNDO_HALLAZGO = {
  id: "F002",
  status: "unresolved",
  priority: "P2",
  blocking: false,
  blocking_reason: null,
  origin: "introduced",
  title: "Carrera en la caché",
  location: { path: "src/demo/cache.py", line: 7, url: null, section: null },
  scenario: "Dos hilos escriben a la vez.",
  impact: "La lectura devuelve datos rotos.",
  correction: "Bloquear la escritura.",
  evidence: [{ kind: "executed", details: "Reproducida en la suite.", check_id: "C001" }],
};

const conDosHallazgos = () =>
  conCambios((v) => {
    v.review.findings.push(structuredClone(SEGUNDO_HALLAZGO));
  });

const filasHallazgo = (page) => panel(page).locator(".fila-hallazgo");
const detalleActivo = (page) => panel(page).locator("[data-detalle]");

test.describe("Hallazgos", () => {
  test("seleccionar un hallazgo abre su detalle sin salir de la pestaña", async ({ page }) => {
    await abrir(page, conDosHallazgos());
    await pestana(page, "Hallazgos").click();
    await expect(filasHallazgo(page)).toHaveCount(2);
    await expect(filasHallazgo(page).first()).toContainText("F001");
    await expect(filasHallazgo(page).first()).toContainText("P1");
    await expect(filasHallazgo(page).first()).toContainText("confirmed");
    await expect(filasHallazgo(page).first()).toContainText("src/demo/handler.py");

    await filasHallazgo(page).nth(1).click();
    const detalle = detalleActivo(page);
    await expect(detalle).toContainText("Carrera en la caché");
    await expect(detalle).toContainText("Dos hilos escriben a la vez.");
    await expect(detalle).toContainText("La lectura devuelve datos rotos.");
    await expect(detalle).toContainText("Bloquear la escritura.");
    await expect(detalle).toContainText("Reproducida en la suite.");
    await expect(filasHallazgo(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(pestana(page, "Hallazgos")).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("hallazgos");
    await expect(filasHallazgo(page)).toHaveCount(2);
  });

  test("los filtros locales acotan la lista y el conteo", async ({ page }) => {
    await abrir(page, conDosHallazgos());
    await pestana(page, "Hallazgos").click();
    const conteo = panel(page).locator("[data-conteo]");
    await expect(conteo).toContainText("2 de 2");
    await panel(page).locator('[data-filtro="estado"]').selectOption("unresolved");
    await expect(conteo).toContainText("1 de 2");
    await expect(filasHallazgo(page)).toHaveCount(1);
    await expect(filasHallazgo(page).first()).toContainText("F002");
    await panel(page).locator('[data-filtro="estado"]').selectOption("");
    await panel(page).locator('[data-filtro="texto"]').fill("handler");
    await expect(conteo).toContainText("1 de 2");
    await expect(filasHallazgo(page).first()).toContainText("F001");
    await panel(page).locator('[data-filtro="texto"]').fill("no existe");
    await expect(panel(page)).toContainText("Ningún hallazgo coincide");
    await expect(conteo).toContainText("0 de 2");
  });

  test("la prioridad y el estado desconocidos conservan su valor original", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.findings[0].priority = "P9";
      v.review.findings[0].status = "estado_futuro";
    });
    await abrir(page, vista);
    await pestana(page, "Hallazgos").click();
    await expect(filasHallazgo(page).first()).toContainText("P9");
    await expect(filasHallazgo(page).first()).toContainText("estado_futuro");
    await panel(page).locator('[data-filtro="prioridad"]').selectOption("P9");
    await expect(filasHallazgo(page)).toHaveCount(1);
  });

  test("la referencia a C001 navega a Validación y resalta el check, que lista los hallazgos que lo citan", async ({ page }) => {
    await abrir(page, conDosHallazgos());
    await pestana(page, "Hallazgos").click();
    await filasHallazgo(page).nth(1).click();
    await detalleActivo(page).getByRole("button", { name: /C001/ }).click();

    await expect(pestana(page, "Validación")).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("validacion");
    const check = panel(page).locator('[data-detalle][data-resaltado="true"]');
    await expect(check).toContainText("C001");
    await expect(panel(page).locator(".fila-comprobacion").first()).toHaveAttribute("aria-pressed", "true");
    // Lista los hallazgos que lo citan y permite volver a ellos.
    await expect(check).toContainText("F002");
    await expect(check).toContainText("Carrera en la caché");
    await check.getByRole("button", { name: /F002/ }).click();
    await expect(pestana(page, "Hallazgos")).toHaveAttribute("aria-selected", "true");
    await expect(detalleActivo(page)).toContainText("Dos hilos escriben a la vez.");
    await expect(detalleActivo(page)).toHaveAttribute("data-resaltado", "true");
  });

  test("el destino se consume: abrir Validación después no vuelve a resaltar", async ({ page }) => {
    await abrir(page, conDosHallazgos());
    await pestana(page, "Hallazgos").click();
    await filasHallazgo(page).nth(1).click();
    await detalleActivo(page).getByRole("button", { name: /C001/ }).click();
    await expect(panel(page).locator('[data-detalle][data-resaltado="true"]')).toHaveCount(1);
    await pestana(page, "Resumen").click();
    await pestana(page, "Validación").click();
    await expect(panel(page).locator("[data-detalle]")).toHaveCount(1);
    await expect(panel(page).locator('[data-detalle][data-resaltado="true"]')).toHaveCount(0);
  });

  test("los filtros y la selección sobreviven a una recarga en vivo de la misma revisión", async ({ page }) => {
    await page.addInitScript(() => {
      window.EventSource = class {
        addEventListener(tipo, devolucion) {
          if (tipo === "notice") window.entregarAviso = (aviso) => devolucion({ data: JSON.stringify(aviso) });
        }
        close() {}
      };
    });
    await abrir(page, conDosHallazgos());
    await pestana(page, "Hallazgos").click();
    await panel(page).locator('[data-filtro="texto"]').fill("caché");
    await expect(filasHallazgo(page)).toHaveCount(1);
    await filasHallazgo(page).first().click();
    // Marca el control actual para comprobar que la vista se dibujó de nuevo.
    await page.evaluate(() => { document.querySelector('[data-filtro="texto"]').dataset.anterior = "1"; });
    await page.evaluate((clave) => window.entregarAviso({ kind: "run_changed", run_key: clave, cursor: 2 }), CLAVE);
    const nuevo = panel(page).locator('[data-filtro="texto"]:not([data-anterior])');
    await expect(nuevo).toHaveCount(1);
    await expect(nuevo).toHaveValue("caché");
    await expect(panel(page).locator("[data-conteo]")).toContainText("1 de 2");
    await expect(detalleActivo(page)).toContainText("Carrera en la caché");
  });

  test("el contenido hostil de los hallazgos queda inerte", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.findings[0].title = "<img src=x onerror=\"window.__pwned = true\">";
      v.review.findings[0].location = { path: "../../etc/passwd", line: 1, url: "javascript:alert(1)", section: null };
      v.review.findings[0].scenario = "<script>window.__pwned = true</script>";
      v.review.checks[0].command = "<script>window.__pwned = true</script> && rm -rf /";
    });
    await abrir(page, vista);
    await pestana(page, "Hallazgos").click();
    await expect(filasHallazgo(page).first()).toContainText("<img src=x");
    await expect(detalleActivo(page)).toContainText("../../etc/passwd");
    await expect(detalleActivo(page)).toContainText("javascript:alert(1)");
    await pestana(page, "Validación").click();
    await expect(panel(page)).toContainText("<script>window.__pwned = true</script> && rm -rf /");
    for (const nombre of ["script", "img", "iframe", "a"]) {
      await expect(panel(page).locator(nombre)).toHaveCount(0);
    }
    expect(await page.evaluate(() => window.__pwned ?? false)).toBe(false);
  });
});

test.describe("Validación", () => {
  test("muestra el comando como texto, la salida registrada y no ofrece ejecutar", async ({ page }) => {
    const vista = conCambios((v) => {
      v.review.checks.push({
        id: "C002", command: "npm test", revision: "9f1c2b7", status: "failed", failure_kind: "environment",
        evidence: "", reused: false, reuse_reason: null, rerun_reason: null,
      });
    });
    await abrir(page, vista);
    await pestana(page, "Validación").click();
    const filas = panel(page).locator(".fila-comprobacion");
    await expect(filas).toHaveCount(2);
    await expect(detalleActivo(page)).toContainText("python -m unittest discover -s tests");
    await expect(detalleActivo(page)).toContainText("Suite sintética: 3 pruebas, 0 fallos.");
    await filas.nth(1).click();
    await expect(detalleActivo(page)).toContainText("npm test");
    await expect(detalleActivo(page)).toContainText("Sin salida registrada");
    await expect(detalleActivo(page)).toContainText("problema de entorno");
    await expect(panel(page).getByRole("button", { name: /ejecutar|reejecutar|run/i })).toHaveCount(0);
  });

  test("un check que nadie cita lo declara", async ({ page }) => {
    await abrir(page);
    await pestana(page, "Validación").click();
    await expect(detalleActivo(page)).toContainText("Ningún hallazgo cita esta comprobación");
  });
});

test.describe("Documentos", () => {
  const NOTES = "2".repeat(32);
  const claveDe = (ruta) => new URL(ruta.request().url()).pathname.split("/").at(-1);
  const inventario = (page) => panel(page).locator(".fila-archivo");
  const previa = (page) => panel(page).locator("[data-vista-previa]");

  test("el preview muestra ruta, formato y aviso de truncamiento y el inventario se conserva", async ({ page }) => {
    await abrir(page);
    await page.route("**/api/runs/*/files/*", (ruta) =>
      claveDe(ruta) === NOTES
        ? responder(ruta, { text: "{\"nota\": 1}", media_kind: "json", truncated: true, total_bytes: 9000 })
        : ruta.fallback(),
    );
    await pestana(page, "Documentos").click();
    await expect(inventario(page)).toHaveCount(2);
    // El informe queda seleccionado de inicio.
    await expect(previa(page)).toContainText("informe.md");
    await expect(previa(page)).toContainText("markdown");
    await expect(previa(page).locator(".documento-texto h1")).toHaveText("Informe de revisión sintética");

    await inventario(page).nth(1).click();
    await expect(previa(page)).toContainText("evidence/notes.json");
    await expect(previa(page)).toContainText("json");
    await expect(previa(page)).toContainText("Vista previa truncada");
    await expect(previa(page)).toContainText("9000 bytes");
    await expect(previa(page)).toContainText("\"nota\": 1");
    await expect(inventario(page)).toHaveCount(2);
    await expect(inventario(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(inventario(page).first()).toHaveAttribute("aria-pressed", "false");
  });

  test("un error de preview conserva la lista y la selección y ofrece Reintentar", async ({ page }) => {
    await abrir(page);
    let fallar = true;
    await page.route("**/api/runs/*/files/*", (ruta) => {
      if (claveDe(ruta) !== NOTES) return ruta.fallback();
      if (fallar) {
        return ruta.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ api_version: 1, error: { code: "read_failed", message: "archivo ilegible" } }),
        });
      }
      return responder(ruta, { text: "contenido recuperado", media_kind: "json", truncated: false, total_bytes: 19 });
    });
    await pestana(page, "Documentos").click();
    await expect(inventario(page)).toHaveCount(2);
    await inventario(page).nth(1).click();
    await expect(previa(page)).toContainText("No se pudo leer: archivo ilegible");
    await expect(inventario(page)).toHaveCount(2);
    await expect(inventario(page).nth(1)).toHaveAttribute("aria-pressed", "true");
    fallar = false;
    await previa(page).getByRole("button", { name: "Reintentar" }).click();
    await expect(previa(page)).toContainText("contenido recuperado");
    await expect(previa(page)).not.toContainText("archivo ilegible");
  });

  test("un enlace local del informe selecciona ese archivo en el inventario", async ({ page }) => {
    await abrir(page);
    await page.route("**/api/runs/*/files/*", (ruta) =>
      claveDe(ruta) === NOTES
        ? responder(ruta, { text: "{\"enlazado\": true}", media_kind: "json", truncated: false, total_bytes: 18 })
        : ruta.fallback(),
    );
    await pestana(page, "Documentos").click();
    await previa(page).getByRole("link", { name: "notas locales" }).click();
    await expect(previa(page)).toContainText("\"enlazado\": true");
    await expect(inventario(page).nth(1)).toHaveAttribute("aria-pressed", "true");
  });

  test("informe ausente, inventario vacío y lectura fallida son tres mensajes distintos", async ({ page }) => {
    await abrir(page);
    await page.route("**/api/runs/*/files", (ruta) =>
      responder(ruta, [
        { key: NOTES, name: "notes.json", relative_path: "evidence/notes.json", media_kind: "json", bytes: 32, available: true },
      ]),
    );
    await pestana(page, "Documentos").click();
    await expect(panel(page)).toContainText("no conserva un informe Markdown");
    await expect(inventario(page)).toHaveCount(1);
    await expect(panel(page)).not.toContainText("inventario está vacío");

    await page.route("**/api/runs/*/files", (ruta) => responder(ruta, []));
    await pestana(page, "Resumen").click();
    await pestana(page, "Documentos").click();
    await expect(panel(page)).toContainText("inventario está vacío");
    await expect(panel(page)).not.toContainText("no conserva un informe Markdown");

    await page.route("**/api/runs/*/files", (ruta) =>
      ruta.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ api_version: 1, error: { code: "read_failed", message: "inventario ilegible" } }),
      }),
    );
    await pestana(page, "Resumen").click();
    await pestana(page, "Documentos").click();
    await expect(panel(page)).toContainText("No se pudo leer el inventario: inventario ilegible");
    await expect(panel(page).getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(panel(page)).not.toContainText("inventario está vacío");
  });

  test("las vistas nuevas no usan estilos en línea", async ({ page }) => {
    await abrir(page, conDosHallazgos());
    for (const nombre of ["Hallazgos", "Validación", "Documentos"]) {
      await pestana(page, nombre).click();
      await expect(pestana(page, nombre)).toHaveAttribute("aria-selected", "true");
      await expect(panel(page).locator("[style]")).toHaveCount(0);
    }
  });
});
