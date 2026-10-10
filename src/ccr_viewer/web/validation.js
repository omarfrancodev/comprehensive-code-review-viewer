/** Validación: comprobaciones reales, con su estado y su motivo de origen. */

import { elemento, listaDefinitiva, seccion } from "./dom.js";

const ESTADOS = {
  passed: "superada",
  failed: "fallida",
  blocked: "bloqueada",
  not_run: "no ejecutada",
};

const CLASES_FALLA = {
  product: "defecto de producto",
  fixture: "defecto de la prueba",
  environment: "problema de entorno",
};

function tarjeta(check) {
  const articulo = elemento("article", { clase: "comprobacion" });
  const estado = ESTADOS[check.status] ?? check.status ?? "desconocido";
  articulo.append(elemento("h3", { texto: `${check.id ?? "C—"} · ${estado}` }));

  const cuerpo = elemento("dl", { clase: "campos" });
  const filas = [
    ["Comando", check.command],
    ["Revisión", check.revision, { textoVacio: "Sin revisión registrada" }],
    ["Resultado", check.evidence, { textoVacio: "Sin salida registrada" }],
  ];
  for (const [etiqueta, valor, opciones] of filas) {
    const fila = elemento("div", { clase: "campo" });
    fila.append(elemento("dt", { texto: etiqueta }));
    const cuerpo2 = elemento("dd");
    if (valor === null || valor === undefined || valor === "") {
      cuerpo2.append(elemento("span", { clase: "valor--desconocido", texto: opciones?.textoVacio ?? "No identificado" }));
    } else {
      cuerpo2.textContent = String(valor);
    }
    fila.append(cuerpo2);
    cuerpo.append(fila);
  }

  if (check.reused) {
    const fila = elemento("div", { clase: "campo" });
    fila.append(elemento("dt", { texto: "Reutilizada" }));
    const dd = elemento("dd");
    dd.append(elemento("span", { texto: "Sí" }));
    // Una reutilización conserva la revisión original; no se presenta como actual.
    dd.append(
      elemento("p", {
        clase: "nota",
        texto: check.reuse_reason ?? "Sin motivo declarado; conserva la revisión de origen.",
      }),
    );
    fila.append(dd);
    cuerpo.append(fila);
  }
  if (check.rerun_reason) {
    const fila = elemento("div", { clase: "campo" });
    fila.append(elemento("dt", { texto: "Motivo de reejecución" }), elemento("dd", { texto: check.rerun_reason }));
    cuerpo.append(fila);
  }
  if (check.failure_kind) {
    const fila = elemento("div", { clase: "campo" });
    fila.append(elemento("dt", { texto: "Clase del fallo" }));
    fila.append(
      elemento("dd", {
        texto: `${CLASES_FALLA[check.failure_kind] ?? check.failure_kind}. `
          + "El visor muestra el resultado local de la comprobación; no afirma que la revisión entera se detenga.",
      }),
    );
    cuerpo.append(fila);
  }
  articulo.append(cuerpo);
  return articulo;
}

/** Dibuja las comprobaciones. Sin comprobaciones no se muestra una señal de aprobado. */
export function renderValidation(contenedor, view) {
  contenedor.replaceChildren();
  const review = view?.review ?? null;
  const checks = Array.isArray(review?.checks) ? review.checks : [];

  if (!review || checks.length === 0) {
    contenedor.append(
      seccion("Validación", [
        elemento("p", {
          clase: "estado",
          texto: "No hay comprobaciones registradas: la fuente no declara ejecuciones para esta revisión.",
        }),
      ]),
    );
    return;
  }

  const resumen = elemento("p", { clase: "resumen-linea" });
  const cuenta = (estado) => checks.filter((c) => c?.status === estado).length;
  resumen.textContent =
    `Superadas: ${cuenta("passed")} · Fallidas: ${cuenta("failed")} · `
    + `Bloqueadas: ${cuenta("blocked")} · No ejecutadas: ${cuenta("not_run")}`;

  contenedor.append(seccion("Validación", [resumen]));
  contenedor.append(seccion("Comprobaciones", checks.map(tarjeta)));

  const reutilizadas = checks.filter((c) => c?.reused);
  if (reutilizadas.length > 0) {
    const lista = elemento("ul", { clase: "lista-simple" });
    for (const check of reutilizadas) {
      lista.append(
        elemento("li", {
          texto: `${check.id}: ejecución anterior reutilizada en la revisión ${check.revision ?? "no declarada"}.`,
        }),
      );
    }
    contenedor.append(
      seccion("Comprobaciones heredadas de la línea base", [
        lista,
        elemento("p", {
          clase: "nota",
          texto: "Una comprobación reutilizada conserva su revisión de origen; no se presenta como ejecución actual.",
        }),
      ]),
    );
  }

  contenedor.append(
    seccion("Independencia de la verificación", [
      listaDefinitiva([]),
      elemento("p", {
        clase: "nota",
        texto: review?.coverage?.verification
          ? `La fuente declara verificación: ${review.coverage.verification}.`
          : "La fuente no declara el modo de verificación.",
      }),
    ]),
  );
}