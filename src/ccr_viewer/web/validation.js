/**
 * Validación: comprobaciones declaradas, con su estado, su resultado y los
 * hallazgos que las citan (lista y detalle).
 *
 * El visor muestra lo que la fuente declara: un comando es texto inerte, un
 * estado desconocido conserva su valor original y no existe ninguna acción
 * para ejecutar o reejecutar una comprobación.
 */

import {
  campo,
  consumirDestino,
  detallesJson,
  elemento,
  listaDefinitiva,
  seccion,
  textoDe,
  traerAVista,
} from "./dom.js";
import { CLASES_FALLO, ESTADOS_COMPROBACION, valorLegible } from "./estados.js";

/** Campos con presentación propia; el resto se conserva en «campos originales». */
const CAMPOS_CONOCIDOS = [
  "id", "status", "command", "revision", "evidence", "reused", "reuse_reason",
  "rerun_reason", "failure_kind",
];

function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

const idDe = (check) => textoDe(check.id) ?? "C—";

/** Valor textual en bloque (comando o salida): inerte, con saltos de línea. */
function bloque(valor, clase) {
  const texto = textoDe(valor);
  return texto === null ? null : elemento("pre", { clase: `codigo ${clase}`, texto });
}

function fila(check, activa) {
  const boton = elemento("button", {
    clase: "fila-comprobacion",
    atributos: { type: "button", "aria-pressed": String(activa) },
  });
  const meta = elemento("span", { clase: "fila-meta" });
  meta.append(valorLegible(check.status, ESTADOS_COMPROBACION, { vacio: "Sin estado declarado" }));
  const revision = textoDe(check.revision);
  if (revision !== null) meta.append(elemento("span", { clase: "fila-revision", texto: `revisión ${revision}` }));
  boton.append(elemento("span", { clase: "fila-id", texto: idDe(check) }), meta);
  const comando = textoDe(check.command);
  if (comando !== null) boton.append(elemento("span", { clase: "fila-comando", texto: comando }));
  return boton;
}

/** Hallazgos que citan la comprobación en `evidence[].check_id`. */
function citantes(check, findings) {
  const id = textoDe(check.id);
  if (id === null) return [];
  return findings.filter(
    (h) => esObjeto(h)
      && Array.isArray(h.evidence)
      && h.evidence.some((e) => esObjeto(e) && textoDe(e.check_id) === id),
  );
}

function detalleDe(check, { findings, dispatch, resaltado }) {
  const articulo = elemento("article", {
    clase: "comprobacion comprobacion-detalle",
    atributos: { "data-detalle": "comprobacion", tabindex: "-1", "data-resaltado": resaltado ? "true" : null },
  });
  const estado = typeof check.status === "string" && Object.hasOwn(ESTADOS_COMPROBACION, check.status)
    ? ESTADOS_COMPROBACION[check.status]
    : textoDe(check.status) ?? "desconocido";
  articulo.append(elemento("h3", { texto: `${idDe(check)} · ${estado}` }));

  const filas = [
    campo("Estado", valorLegible(check.status, ESTADOS_COMPROBACION, { vacio: "Sin estado declarado" })),
    campo("Comando", bloque(check.command, "comando"), { textoVacio: "Sin comando declarado" }),
    campo("Revisión", textoDe(check.revision), { textoVacio: "Sin revisión registrada" }),
    campo("Resultado", bloque(check.evidence, "salida"), { textoVacio: "Sin salida registrada" }),
  ];
  if (check.reused) {
    const dd = elemento("div");
    dd.append(elemento("span", { texto: "Sí" }));
    // Una reutilización conserva la revisión original; no se presenta como actual.
    dd.append(
      elemento("p", {
        clase: "nota",
        texto: textoDe(check.reuse_reason) ?? "Sin motivo declarado; conserva la revisión de origen.",
      }),
    );
    filas.push(campo("Reutilizada", dd));
  }
  if (textoDe(check.rerun_reason) !== null) filas.push(campo("Motivo de reejecución", textoDe(check.rerun_reason)));
  if (check.failure_kind) {
    const clase = typeof check.failure_kind === "string" && Object.hasOwn(CLASES_FALLO, check.failure_kind)
      ? CLASES_FALLO[check.failure_kind]
      : textoDe(check.failure_kind);
    filas.push(
      campo(
        "Clase del fallo",
        `${clase}. El visor muestra el resultado local de la comprobación; no afirma que la revisión entera se detenga.`,
      ),
    );
  }
  articulo.append(listaDefinitiva(filas));

  // Evidencia navegable: los hallazgos que citan esta comprobación.
  const citados = citantes(check, findings);
  articulo.append(elemento("h5", { texto: "Hallazgos que citan esta comprobación" }));
  if (citados.length === 0) {
    articulo.append(elemento("p", { clase: "estado", texto: "Ningún hallazgo cita esta comprobación." }));
  } else {
    const lista = elemento("ul", { clase: "evidencia" });
    for (const hallazgo of citados) {
      const id = textoDe(hallazgo.id) ?? "Sin ID";
      const item = elemento("li");
      const ir = elemento("button", {
        clase: "enlace-interno",
        texto: `Ver hallazgo ${id}`,
        atributos: { type: "button" },
      });
      if (textoDe(hallazgo.id) !== null) {
        ir.addEventListener("click", () => dispatch({ type: "openTarget", tab: "hallazgos", id }));
      } else {
        ir.disabled = true;
      }
      item.append(ir, elemento("span", { texto: ` ${textoDe(hallazgo.title) ?? "Sin título"}` }));
      lista.append(item);
    }
    articulo.append(lista);
  }

  const extras = Object.fromEntries(Object.entries(check).filter(([nombre]) => !CAMPOS_CONOCIDOS.includes(nombre)));
  const cantidad = Object.keys(extras).length;
  if (cantidad > 0) {
    articulo.append(detallesJson(`Campos originales sin presentación propia (${cantidad})`, extras, "campos-originales"));
  }
  return articulo;
}

/** Dibuja las comprobaciones. Sin comprobaciones no se muestra una señal de aprobado. */
export function renderValidation(contenedor, view, dispatch = () => {}, contexto = {}) {
  contenedor.replaceChildren();
  const review = view?.review ?? null;
  const declaradas = Array.isArray(review?.checks) ? review.checks : [];

  if (!review || declaradas.length === 0) {
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

  const checks = declaradas.filter(esObjeto);
  if (checks.length === 0) {
    contenedor.append(
      seccion("Validación", [
        elemento("p", { clase: "estado", texto: "Las comprobaciones declaradas no tienen una forma reconocible; el JSON original está en Archivo." }),
      ]),
    );
    return;
  }
  const findings = Array.isArray(review.findings) ? review.findings : [];

  const resumen = elemento("p", { clase: "resumen-linea" });
  const cuenta = (estado) => checks.filter((c) => c.status === estado).length;
  const conocidos = Object.keys(ESTADOS_COMPROBACION).reduce((suma, estado) => suma + cuenta(estado), 0);
  const otros = checks.length - conocidos;
  resumen.textContent =
    `Superadas: ${cuenta("passed")} · Fallidas: ${cuenta("failed")} · `
    + `Bloqueadas: ${cuenta("blocked")} · No ejecutadas: ${cuenta("not_run")}`
    + (otros > 0 ? ` · Otros estados: ${otros}` : "");

  // Estado local de la vista: comprobación seleccionada y su resalte.
  // Con memoria de la aplicación, la selección sobrevive a una recarga en vivo.
  const recuerdo = contexto?.memoria ? (contexto.memoria.validacion ??= {}) : {};
  let seleccionada = (recuerdo.id !== undefined && checks.find((c) => textoDe(c.id) === recuerdo.id)) || checks[0];
  let resaltado = false;
  let aviso = null;
  const destino = consumirDestino(contexto, dispatch, "validacion");
  if (destino !== null) {
    const buscada = checks.find((c) => textoDe(c.id) === destino);
    if (buscada) {
      seleccionada = buscada;
      resaltado = true;
      recuerdo.id = destino;
    } else {
      aviso = `La comprobación «${destino}» no está declarada en esta revisión; se conserva la selección actual.`;
    }
  }

  const lista = elemento("ul", { clase: "lista-densa", atributos: { "aria-label": "Comprobaciones" } });
  const detalle = elemento("div", { clase: "detalle" });
  const filas = checks.map((check) => ({ check, boton: fila(check, check === seleccionada) }));

  function pintarDetalle() {
    const articulo = detalleDe(seleccionada, { findings, dispatch, resaltado });
    detalle.replaceChildren(
      ...(aviso ? [elemento("p", { clase: "estado estado--aviso", texto: aviso })] : []),
      articulo,
    );
    return articulo;
  }

  for (const { check, boton } of filas) {
    boton.addEventListener("click", () => {
      seleccionada = check;
      recuerdo.id = textoDe(check.id) ?? undefined;
      resaltado = false;
      aviso = null;
      for (const otra of filas) otra.boton.setAttribute("aria-pressed", String(otra.check === seleccionada));
      pintarDetalle();
    });
    const item = elemento("li");
    item.append(boton);
    lista.append(item);
  }
  const articulo = pintarDetalle();

  const rejilla = elemento("div", { clase: "maestro-detalle" });
  const maestro = elemento("div", { clase: "maestro" });
  maestro.append(lista);
  rejilla.append(maestro, detalle);

  contenedor.append(seccion("Validación", [resumen]));
  contenedor.append(seccion("Comprobaciones", [rejilla], "seccion seccion--maestro"));

  if (resaltado) {
    traerAVista(filas.find(({ check }) => check === seleccionada).boton);
    traerAVista(articulo, { enfocar: true });
  }

  const reutilizadas = checks.filter((c) => c.reused);
  if (reutilizadas.length > 0) {
    const referencias = elemento("ul", { clase: "lista-simple" });
    for (const check of reutilizadas) {
      referencias.append(
        elemento("li", {
          texto: `${idDe(check)}: ejecución anterior reutilizada en la revisión ${textoDe(check.revision) ?? "no declarada"}.`,
        }),
      );
    }
    contenedor.append(
      seccion("Comprobaciones heredadas de la línea base", [
        referencias,
        elemento("p", {
          clase: "nota",
          texto: "Una comprobación reutilizada conserva su revisión de origen; no se presenta como ejecución actual.",
        }),
      ]),
    );
  }

  contenedor.append(
    seccion("Independencia de la verificación", [
      elemento("p", {
        clase: "nota",
        texto: review?.coverage?.verification
          ? `La fuente declara verificación: ${review.coverage.verification}.`
          : "La fuente no declara el modo de verificación.",
      }),
    ]),
  );
}
