/**
 * Soporte de pruebas de navegador con respuestas sintéticas.
 *
 * Intercepta la API normalizada para que las pruebas no dependan de un archivo
 * real ni de un servidor en marcha. Todos los valores son públicos y sintéticos.
 */

export const REVISION_SINTETICA = {
  api_version: 1,
  compatibility: "supported",
  source_versions: { review: 7, closure: 5, trace: 1 },
  summary: {
    key: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    repository_label: "git.ejemplo.invalid/acme/demo",
    repository_identity: "git.ejemplo.invalid/acme/demo",
    scope_label: "pr 42",
    source_review_id: "CR-1111111111111111aaaa",
    profile: "extended",
    verdict: "approvable_with_reservations",
    archive_state: "complete",
    display_state: "closed",
    phase: null,
    finding_counts: { confirmed: { P0: 0, P1: 1, P2: 0, P3: 0 }, totalConfirmed: 1 },
    diagnostics: [],
  },
  review: {
    schema_version: 7,
    review_id: "CR-1111111111111111aaaa",
    profile: "extended",
    profile_reason: "Perfil sintético declarado.",
    presentation: { kind: "review", subject: "Revisión sintética de validación" },
    scope: { mode: "pr", reference: "42", base: "main", head: "9f1c2b7", target: "demo", snapshot: null },
    verdict: "approvable_with_reservations",
    verdict_reason: "Hallazgo corregible antes de publicar.",
    reservations: ["El borde acepta valores fuera de rango."],
    responsible: { name: "Responsable sintética", username: "usuaria", verified: true },
    change_authors: [
      { name: "Autora sintética", username: null, verified: false, commits: ["9f1c2b7"] },
    ],
    coverage: {
      stale: false,
      adequate: true,
      verification: "independent",
      limitations: { material: false, details: "" },
      areas: [
        { area: "A", status: "covered", details: "Revisión estática", material: false, finding_ids: ["F001"] },
        { area: "B", status: "covered", details: "Revisión estática", material: false, finding_ids: [] },
        { area: "C", status: "covered", details: "Revisión estática", material: false, finding_ids: [] },
        { area: "D", status: "covered", details: "Revisión estática", material: false, finding_ids: [] },
        { area: "E", status: "covered", details: "Revisión estática", material: false, finding_ids: [] },
      ],
    },
    aliases: {},
    checks: [
      {
        id: "C001",
        command: "python -m unittest discover -s tests",
        revision: "9f1c2b7",
        status: "passed",
        failure_kind: null,
        evidence: "Suite sintética: 3 pruebas, 0 fallos.",
        reused: false,
        reuse_reason: null,
        rerun_reason: null,
      },
    ],
    findings: [
      {
        id: "F001",
        status: "confirmed",
        priority: "P1",
        blocking: false,
        blocking_reason: null,
        origin: "introduced",
        title: "Validación de entrada ausente",
        location: { path: "src/demo/handler.py", line: 42, url: null, section: null },
        scenario: "Una petición externa envía un valor fuera de rango.",
        impact: "El borde propaga el valor al lector interno.",
        correction: "Comparar el valor con el rango declarado.",
        evidence: [{ kind: "static", details: "El parámetro se usa sin comparación.", check_id: null }],
      },
    ],
  },
  closure: { schema_version: 5, state: "complete", cleanup: "not_needed", residuals: [] },
  lineage: [],
  files: [],
  diagnostics: [],
};

const BIBLIOTECA = {
  api_version: 1,
  data: {
    items: [REVISION_SINTETICA.summary],
    total: 1,
    offset: 0,
    limit: 50,
    truncated: false,
  },
  diagnostics: [],
};

/** Informe Markdown sintético con contenido hostil y estructura real. */
export const INFORME_SINTETICO = [
  "# Informe de revisión sintética",
  "",
  "## Resumen",
  "",
  "Texto con acento: revisión de **entrada** y `código` literal.",
  "",
  "| Columna | Valor |",
  "| --- | --- |",
  "| Veredicto | aprobable |",
  "",
  "### Detalle",
  "",
  "<script>window.__pwned = true;</script>",
  "",
  "<img src=x onerror=\"window.__pwned = true\">",
  "",
  "<iframe src=\"https://ejemplo.invalid\"></iframe>",
  "",
  "![imagen remota](https://ejemplo.invalid/imagen.png)",
  "",
  "[enlace remoto](https://ejemplo.invalid/revision)",
  "",
  "[enlace codificado](javascript:alert(1))",
  "",
  "[notas locales](evidence/notes.json)",
].join("\n");

const ARCHIVOS = [
  {
    key: "1".repeat(32),
    name: "informe.md",
    relative_path: "informe.md",
    media_kind: "markdown",
    bytes: INFORME_SINTETICO.length,
    available: true,
  },
  {
    key: "2".repeat(32),
    name: "notes.json",
    relative_path: "evidence/notes.json",
    media_kind: "json",
    bytes: 32,
    available: true,
  },
];

const CONFIG = {
  api_version: 1,
  data: {
    api_version: 1,
    root: "C:/archivo/sintetico",
    selected_by: "explicit",
    package_version: "0.1.0",
    limits: { page_size: 50, max_runs: 5000 },
    capabilities: { api_version: 1, live_updates: true, markdown: true },
  },
  diagnostics: [],
};

/**
 * Intercepta las rutas de la API con respuestas sintéticas y abre la aplicación.
 * La política de seguridad del servidor no se relaja en ningún momento.
 */
export async function openFixture(page, variant = "final_v7") {
  const envoltura = (data) => ({ status: 200, contentType: "application/json", body: JSON.stringify(data) });

  await page.route("**/api/config", (ruta) => ruta.fulfill(envoltura(CONFIG)));
  await page.route("**/api/runs?*", (ruta) => ruta.fulfill(envoltura(BIBLIOTECA)));
  await page.route("**/api/runs", (ruta) => ruta.fulfill(envoltura(BIBLIOTECA)));
  await page.route(
    "**/api/runs/*/trace",
    (ruta) =>
      ruta.fulfill(
        envoltura({
          api_version: 1,
          data: {
            events: [],
            valid_prefix_length: 0,
            chain_status: "verified",
            temporal_order: [],
            relations: [],
            diagnostics: [],
          },
        }),
      ),
  );
  await page.route("**/api/runs/*/files", (ruta) =>
    ruta.fulfill(envoltura({ api_version: 1, data: ARCHIVOS, diagnostics: [] })),
  );
  await page.route("**/api/runs/*/files/*", (ruta) =>
    ruta.fulfill(
      envoltura({
        api_version: 1,
        data: {
          text: INFORME_SINTETICO,
          media_kind: "markdown",
          truncated: false,
          total_bytes: INFORME_SINTETICO.length,
        },
      }),
    ),
  );
  await page.route("**/api/runs/*/validate", (ruta) =>
    ruta.fulfill(
      envoltura({
        api_version: 1,
        data: { status: "verified", checks: [], diagnostics: [] },
      }),
    ),
  );
  await page.route("**/api/runs/*", (ruta) =>
    ruta.fulfill(
      envoltura({ api_version: 1, data: REVISION_SINTETICA, diagnostics: [] }),
    ),
  );
  await page.route("**/api/events", (ruta) =>
    ruta.fulfill({ status: 200, contentType: "text/event-stream", body: ": latencia\n\n" }),
  );
  await page.route("**/api/session", (ruta) =>
    ruta.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Set-Cookie": "ccr_session=prueba; Path=/; HttpOnly; SameSite=Strict" },
      body: JSON.stringify({ api_version: 1, data: { ok: true } }),
    }),
  );

  await page.goto("/#token=token-sintetico");
  await page.waitForSelector("#biblioteca .lista-revisiones button", { timeout: 15_000 });
  return { variant };
}