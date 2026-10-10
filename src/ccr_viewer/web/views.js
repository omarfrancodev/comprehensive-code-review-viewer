/**
 * Superficie de vistas.
 *
 * Reexporta los módulos de pantalla para que el resto de la aplicación importe
 * un único punto estable en lugar de conocer el mapa de archivos.
 */

export { renderLibrary } from "./library.js";
export { renderProfile } from "./profile.js";
export { renderFindings } from "./findings.js";
export { renderValidation } from "./validation.js";

import { elemento, seccion } from "./dom.js";
import { validateRun } from "./api.js";

/** Conserva todos los campos históricos, incluidos IDs que ya no son hallazgos. */
export function renderHistory(container, view, dispatch) {
  container.replaceChildren(elemento("h2", { texto: "Seguimiento" }));
  const rows = Array.isArray(view.review?.rereview) ? view.review.rereview : [];
  if (!rows.length) container.append(elemento("p", { texto: "Sin seguimiento registrado." }));
  for (const row of rows) container.append(elemento("pre", { clase: "codigo", texto: JSON.stringify(row, null, 2) }));
  if (view.review?.aliases) container.append(seccion("Aliases originales", [elemento("pre", { clase: "codigo", texto: JSON.stringify(view.review.aliases, null, 2) })]));
  for (const link of view.lineage ?? []) {
    const block = elemento("p", { texto: `${link.raw} · ${link.status}` });
    if (link.status === "resolved" && link.run_key) {
      const button = elemento("button", { texto: "Abrir revisión anterior", atributos: { type: "button" } });
      button.addEventListener("click", () => dispatch({ type: "selectRun", key: link.run_key }));
      block.append(button);
    }
    container.append(block);
  }
}

/** Verificación explícita independiente del veredicto y acceso al JSON intacto. */
export function renderArchive(container, view) {
  container.replaceChildren(elemento("h2", { texto: "Archivo" }));
  container.append(elemento("p", { texto: `Estado: ${view.closure?.state ?? "desconocido"} · Limpieza: ${view.closure?.cleanup ?? "desconocida"}` }));
  container.append(elemento("pre", { clase: "codigo", texto: JSON.stringify(view.closure?.residuals ?? [], null, 2) }));
  for (const diagnostic of view.diagnostics ?? []) container.append(elemento("p", { texto: `${diagnostic.code}: ${diagnostic.message}` }));
  const result = elemento("div", { atributos: { role: "status" } });
  const button = elemento("button", { texto: "Verificar integridad", atributos: { type: "button" } });
  button.addEventListener("click", async () => {
    button.disabled = true;
    result.textContent = "Verificando archivos…";
    try {
      const report = await validateRun(view.summary.key);
      result.replaceChildren(elemento("p", { texto: `Integridad: ${report.status}. El veredicto de la fuente se conserva.` }));
      for (const check of report.checks ?? []) result.append(elemento("p", { texto: `${check.name} · ${check.status} · ${check.detail}` }));
      for (const issue of report.diagnostics ?? []) result.append(elemento("p", { texto: issue.message }));
    } catch (error) { result.textContent = error.message; }
    finally { button.disabled = false; }
  });
  container.append(button, result);
  const raw = elemento("details");
  raw.append(elemento("summary", { texto: "JSON original" }), elemento("pre", { clase: "codigo", texto: JSON.stringify({ review: view.review, closure: view.closure }, null, 2) }));
  container.append(raw);
}
