/**
 * Archivo: cierre, limpieza, residuos, diagnósticos, verificación explícita de
 * integridad y JSON original.
 *
 * Abrir la vista no verifica nada: la integridad se pide con un botón y su
 * resultado se publica en una región `role=status`, sin tocar el veredicto de
 * la fuente. Una lista vacía se expresa como ausencia de elementos declarados.
 */

import { validateRun } from "./api.js";
import { campo, elemento, listaDefinitiva, seccion } from "./dom.js";
import { ESTADOS_CIERRE, ESTADOS_LIMPIEZA, valorLegible } from "./estados.js";

const GRAVEDADES = [
  ["error", "Errores"],
  ["warning", "Avisos"],
  ["info", "Informativos"],
];
const SIN_GRAVEDAD = "sin-gravedad";

function objeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

const json = (valor) => JSON.stringify(valor, null, 2) ?? String(valor);

function seccionCierre(closure) {
  if (!closure) {
    return seccion("Cierre y limpieza", [
      elemento("p", { clase: "estado", texto: "Sin cierre registrado: la fuente no declara un archivo de cierre." }),
    ]);
  }
  const marcas = elemento("ul", { clase: "marcas" });
  if (closure.cleanup === "pending") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Limpieza pendiente" }));
  return seccion("Cierre y limpieza", [
    listaDefinitiva([
      campo("Estado del cierre", valorLegible(closure.state, ESTADOS_CIERRE, { vacio: "Sin estado declarado" })),
      campo("Limpieza", valorLegible(closure.cleanup, ESTADOS_LIMPIEZA, { vacio: "Sin dato de limpieza" })),
      campo("Marcas", marcas.children.length > 0 ? marcas : null, { textoVacio: "Sin marcas activas" }),
    ]),
  ]);
}

function seccionResiduos(closure) {
  const residuos = closure?.residuals;
  if (residuos === undefined || residuos === null) {
    return seccion("Residuos", [
      elemento("p", { clase: "estado", texto: "El cierre no declara residuos." }),
    ]);
  }
  if (!Array.isArray(residuos)) {
    // Forma no reconocida: se conserva a la vista, sin interpretarla.
    return seccion("Residuos", [
      elemento("p", { clase: "nota", texto: "El campo de residuos no es una lista; se conserva sin interpretar." }),
      elemento("pre", { clase: "codigo", texto: json(residuos) }),
    ]);
  }
  if (residuos.length === 0) {
    return seccion("Residuos", [elemento("p", { clase: "estado", texto: "Sin residuos declarados." })]);
  }
  const lista = elemento("ul", { clase: "lista-simple" });
  for (const residuo of residuos) {
    const item = elemento("li");
    if (typeof residuo === "string") item.textContent = residuo;
    else item.append(elemento("pre", { clase: "codigo", texto: json(residuo) }));
    lista.append(item);
  }
  return seccion("Residuos", [
    elemento("p", { clase: "nota", texto: `${residuos.length} residuo(s) declarado(s) por la fuente.` }),
    lista,
  ]);
}

function seccionDiagnosticos(diagnostics) {
  const lista = Array.isArray(diagnostics) ? diagnostics : [];
  if (lista.length === 0) {
    return seccion("Diagnósticos del visor", [
      elemento("p", { clase: "estado", texto: "Sin diagnósticos del visor para esta revisión." }),
    ]);
  }
  // Orden: error, aviso, informativo y, después, gravedades desconocidas en el
  // orden en que aparecen (valor original) y las que no declaran gravedad.
  const grupos = new Map(GRAVEDADES.map(([clave]) => [clave, []]));
  for (const diagnostico of lista) {
    const fila = objeto(diagnostico) ?? { message: String(diagnostico) };
    const clave = typeof fila.severity === "string" && fila.severity !== "" ? fila.severity : SIN_GRAVEDAD;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
  }
  const etiquetas = Object.fromEntries(GRAVEDADES);
  const bloques = [];
  for (const [clave, filas] of grupos) {
    if (filas.length === 0) continue;
    const etiqueta = etiquetas[clave] ?? (clave === SIN_GRAVEDAD ? "Sin gravedad declarada" : `Gravedad ${clave}`);
    const grupo = elemento("section", { clase: "diagnosticos-grupo", atributos: { "data-gravedad": clave } });
    grupo.append(elemento("h3", { texto: `${etiqueta} (${filas.length})` }));
    const items = elemento("ul", { clase: "lista-simple" });
    for (const fila of filas) {
      const item = elemento("li");
      if (fila.code !== undefined) item.append(elemento("code", { texto: String(fila.code) }), elemento("span", { texto: ": " }));
      item.append(elemento("span", { texto: String(fila.message ?? "") }));
      if (fila.source) item.append(elemento("span", { clase: "nota", texto: ` (fuente: ${fila.source})` }));
      items.append(item);
    }
    grupo.append(items);
    bloques.push(grupo);
  }
  return seccion("Diagnósticos del visor", bloques);
}

function seccionIntegridad(view, validate) {
  const resultado = elemento("div", { clase: "resultado-integridad", atributos: { role: "status" } });
  const boton = elemento("button", { texto: "Verificar integridad", atributos: { type: "button" } });
  boton.addEventListener("click", async () => {
    boton.disabled = true;
    resultado.textContent = "Verificando archivos…";
    try {
      const reporte = await validate(view.summary.key);
      resultado.replaceChildren(
        elemento("p", { texto: `Integridad: ${reporte.status}. El veredicto de la fuente se conserva.` }),
      );
      for (const check of reporte.checks ?? []) {
        resultado.append(elemento("p", { texto: `${check.name} · ${check.status} · ${check.detail}` }));
      }
      for (const problema of reporte.diagnostics ?? []) resultado.append(elemento("p", { texto: problema.message }));
    } catch (error) {
      resultado.textContent = `No se pudo verificar la integridad: ${error.message}`;
    } finally {
      boton.disabled = false;
    }
  });
  return seccion("Integridad", [
    elemento("p", {
      clase: "nota",
      texto: "La verificación compara los archivos con sus hashes declarados. Es independiente del veredicto y del estado del cierre, y no modifica nada.",
    }),
    boton,
    resultado,
  ]);
}

/** Dibuja el archivo; `validate` es la llamada de verificación (inyectable). */
export function renderArchive(container, view, { validate = validateRun } = {}) {
  container.replaceChildren(elemento("h2", { texto: "Archivo" }));
  const closure = objeto(view?.closure);
  container.append(
    seccionCierre(closure),
    seccionResiduos(closure),
    seccionDiagnosticos(view?.diagnostics),
    seccionIntegridad(view, validate),
  );
  const original = elemento("details");
  original.append(
    elemento("summary", { texto: "JSON original" }),
    elemento("pre", { clase: "codigo", texto: json({ review: view?.review, closure: view?.closure }) }),
  );
  container.append(original);
}
