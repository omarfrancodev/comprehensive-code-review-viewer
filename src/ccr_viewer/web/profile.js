/**
 * Resumen de la revisión: identidad y alcance, veredicto de la fuente,
 * responsabilidad, cobertura y límites.
 *
 * El título, el ID copiable y los conteos viven en la cabecera de la revisión
 * (`header.js`). Aquí se conservan los valores de origen sin reinterpretarlos:
 * el perfil no se normaliza, el veredicto no se recalcula y todo campo que esta
 * vista no presenta queda, intacto, en un `<details>` secundario.
 */

import { campo, elemento, listaDefinitiva, seccion } from "./dom.js";
import {
  ESTADOS_CIERRE,
  ESTADOS_COBERTURA,
  ESTADOS_COMPATIBILIDAD,
  ESTADOS_LIMPIEZA,
  VEREDICTOS,
  banderaDeclarada,
  originalDeclarado,
  valorLegible,
} from "./estados.js";

// Campos que esta vista presenta (o que presentan otras vistas de la revisión).
// Todo lo demás se conserva en «Campos originales sin presentación propia».
const REVISION_CONOCIDA = [
  "schema_version", "review_id", "profile", "profile_reason", "presentation", "scope",
  "verdict", "verdict_reason", "reservations", "responsible", "change_authors",
  "coverage", "aliases", "checks", "findings", "rereview", "previous_reviews",
  "profile_snapshot", "executors", "dependencies",
];
const CIERRE_CONOCIDO = [
  "schema_version", "state", "cleanup", "residuals", "scope", "skill_version", "version",
  "harness", "profile_snapshot", "executors", "dependencies", "trace", "run_id",
  "created_at", "previous_run", "repository", "repository_identity", "previous_review",
];
const ANIDADOS_REVISION = {
  scope: ["mode", "reference", "target", "base", "head", "snapshot"],
  coverage: ["stale", "adequate", "verification", "limitations", "areas"],
  responsible: ["name", "username", "verified"],
  presentation: ["kind", "subject"],
};

function objeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
}

/** Campos de `origen` que no están en `conocidos`, con su ruta y valor intactos. */
function camposNoPresentados(prefijo, origen, conocidos, anidados = {}) {
  const resultado = [];
  const fuente = objeto(origen);
  if (!fuente) return resultado;
  for (const [nombre, valor] of Object.entries(fuente)) {
    if (!conocidos.includes(nombre)) {
      resultado.push({ ruta: `${prefijo}${nombre}`, valor });
    } else if (anidados[nombre] && objeto(valor)) {
      resultado.push(...camposNoPresentados(`${prefijo}${nombre}.`, valor, anidados[nombre]));
    }
  }
  return resultado;
}

function detallesOriginales(entradas) {
  if (entradas.length === 0) return null;
  const detalles = elemento("details", { clase: "campos-originales" });
  detalles.append(
    elemento("summary", { texto: `Campos originales sin presentación propia (${entradas.length})` }),
    elemento("p", {
      clase: "nota",
      texto: "El visor los conserva tal como la fuente los declara y no los interpreta.",
    }),
  );
  const lista = elemento("dl", { clase: "campos" });
  for (const { ruta, valor } of entradas) {
    lista.append(campo(ruta, elemento("pre", { clase: "codigo", texto: JSON.stringify(valor, null, 2) })));
  }
  detalles.append(lista);
  return detalles;
}

/**
 * Texto de una bandera declarada: solo `true`/`false` se traducen; una forma
 * desconocida conserva su valor original y nunca se presenta como negativa.
 */
function textoBandera(valor, { si, no, ausente, sujeto }) {
  const estado = banderaDeclarada(valor);
  if (estado === "si") return si;
  if (estado === "no") return no;
  if (estado === "ausente") return ausente;
  return `${sujeto} en estado desconocido (valor original: ${originalDeclarado(valor)})`;
}

function coberturaAreas(coverage) {
  const areas = Array.isArray(coverage?.areas) ? coverage.areas : [];
  if (areas.length === 0) return null;
  const lista = elemento("ul", { clase: "areas" });
  for (const area of areas) {
    const item = elemento("li");
    const titulo = elemento("strong");
    titulo.append(elemento("span", { texto: `${area.area} — ` }), valorLegible(area.status, ESTADOS_COBERTURA));
    item.append(titulo);
    item.append(elemento("span", { texto: ` ${area.details ?? ""}` }));
    const material = banderaDeclarada(area.material);
    if (material === "si") item.append(elemento("span", { clase: "marca marca--material", texto: " material" }));
    else if (material === "desconocido") {
      item.append(elemento("span", {
        clase: "nota",
        texto: ` materialidad en estado desconocido (valor original: ${originalDeclarado(area.material)})`,
      }));
    }
    if (Array.isArray(area.finding_ids) && area.finding_ids.length > 0) {
      item.append(elemento("span", { clase: "nota", texto: ` referencias: ${area.finding_ids.join(", ")}` }));
    }
    lista.append(item);
  }
  return lista;
}

/** Dibuja el Resumen conservando los valores de origen sin reinterpretarlos. */
export function renderProfile(contenedor, view) {
  contenedor.replaceChildren();
  const review = view?.review ?? null;
  const summary = view?.summary ?? {};
  const closure = view?.closure ?? null;
  const scope = (nombre) => review?.scope?.[nombre] ?? closure?.scope?.[nombre];

  contenedor.append(
    seccion("Identidad y alcance", [
      listaDefinitiva([
        campo("Asunto", review?.presentation?.subject, { textoVacio: "Sin asunto declarado" }),
        campo("Tipo de revisión", review?.presentation?.kind, { textoVacio: "No declarado" }),
        campo("Revisión de origen", summary.source_review_id ?? review?.review_id, { textoVacio: "No identificado" }),
        // El repositorio declarado; la identidad normalizada es solo para comparar.
        campo("Repositorio", summary.repository_label ?? summary.repository_identity),
        campo("Modo", scope("mode")),
        campo("Referencia", scope("reference") ?? summary.scope_reference),
        campo("Objetivo", scope("target")),
        campo("Base", scope("base")),
        campo("Cabeza", scope("head")),
        campo("Instantánea", scope("snapshot")),
        campo("Compatibilidad", view?.compatibility ? valorLegible(view.compatibility, ESTADOS_COMPATIBILIDAD) : null),
      ]),
    ], "seccion seccion--identidad"),
  );

  const reservas = Array.isArray(review?.reservations) ? review.reservations : [];
  const listaReservas = reservas.length > 0 ? elemento("ul", { clase: "lista-simple" }) : null;
  for (const reserva of reservas) {
    listaReservas.append(elemento("li", { texto: reserva }));
  }

  contenedor.append(
    seccion("Veredicto de la fuente", [
      listaDefinitiva([
        campo("Veredicto", review?.verdict ? valorLegible(review.verdict, VEREDICTOS) : null, {
          textoVacio: "Sin veredicto registrado",
          nota: "Valor declarado por la fuente; el visor no lo recalcula.",
        }),
        campo("Motivo", review?.verdict_reason, { textoVacio: "Sin motivo registrado" }),
        campo("Reservas", listaReservas, { textoVacio: "Sin reservas registradas" }),
      ]),
    ]),
  );

  const autores = elemento("ul", { clase: "lista-simple" });
  for (const autor of review?.change_authors ?? []) {
    autores.append(
      elemento("li", {
        texto: `${autor.name ?? "Sin nombre"}${autor.username ? ` (@${autor.username})` : ""} · ${textoBandera(autor.verified, {
          si: "cuenta verificada",
          no: "identidad no verificada",
          ausente: "verificación no declarada",
          sujeto: "verificación",
        })}`,
      }),
    );
  }

  contenedor.append(
    seccion("Responsabilidad", [
      listaDefinitiva([
        campo("Responsable", review?.responsible?.name, {
          nota: textoBandera(review?.responsible?.verified, {
            si: "Cuenta verificada por la fuente.",
            no: "Identidad declarada, no verificada.",
            ausente: "Verificación no declarada por la fuente.",
            sujeto: "Verificación",
          }),
        }),
        campo("Autores del cambio", autores.children.length > 0 ? autores : null, {
          textoVacio: "Sin autores del cambio registrados",
          nota: "La autoría del cambio es un dato distinto de la responsabilidad.",
        }),
      ]),
    ]),
  );

  const marcas = elemento("ul", { clase: "marcas" });
  const coverage = review?.coverage ?? {};
  // Solo un booleano declarado activa una marca; otra forma se muestra como desconocida.
  const caducidad = banderaDeclarada(coverage.stale);
  if (caducidad === "si") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Revisión caducada" }));
  else if (caducidad === "desconocido") {
    marcas.append(elemento("li", { clase: "marca", texto: textoBandera(coverage.stale, { sujeto: "Caducidad" }) }));
  }
  const suficiencia = banderaDeclarada(coverage.adequate);
  if (suficiencia === "no") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Cobertura insuficiente" }));
  else if (suficiencia === "desconocido") {
    marcas.append(elemento("li", { clase: "marca", texto: textoBandera(coverage.adequate, { sujeto: "Suficiencia de la cobertura" }) }));
  }
  if (view?.compatibility === "limited") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Compatibilidad limitada" }));
  if (closure?.cleanup === "pending") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Limpieza pendiente" }));

  const cobertura = [
    campo("Verificación", coverage.verification, { textoVacio: "No declarada" }),
    campo("Limitaciones", coverage.limitations?.details, { textoVacio: "Sin limitaciones registradas" }),
    campo("Marcas", marcas.children.length > 0 ? marcas : null, { textoVacio: "Sin marcas activas" }),
  ];
  const areas = coberturaAreas(coverage);
  if (areas) cobertura.push(campo("Cobertura ABCDE", areas));
  contenedor.append(seccion("Cobertura y limitaciones", [listaDefinitiva(cobertura)]));

  contenedor.append(
    seccion("Perfil y estado del archivo", [
      listaDefinitiva([
        campo("Perfil", review?.profile, { nota: "Valor original de la fuente, sin normalizar." }),
        campo("Motivo del perfil", review?.profile_reason, { textoVacio: "Sin motivo registrado" }),
        campo("Estado del archivo", closure?.state ? valorLegible(closure.state, ESTADOS_CIERRE) : null, { textoVacio: "Sin cierre registrado" }),
        campo("Limpieza", closure?.cleanup ? valorLegible(closure.cleanup, ESTADOS_LIMPIEZA) : null, { textoVacio: "Sin dato de limpieza" }),
      ]),
    ]),
  );

  const declarations = [];
  declarations.push(campo("Versión del skill", closure?.skill_version ?? closure?.version));
  declarations.push(campo("Harness", closure?.harness));
  for (const name of ["profile_snapshot", "executors", "dependencies"]) {
    const value = review?.[name] ?? closure?.[name];
    if (value !== undefined && value !== null) declarations.push(campo(name, elemento("pre", { clase: "codigo", texto: JSON.stringify(value, null, 2) })));
  }
  contenedor.append(
    seccion("Declaraciones de ejecución", [
      elemento("p", { clase: "nota", texto: "Datos declarados por la fuente; no demuestran actividad actual ni verificación del aislamiento." }),
      listaDefinitiva(declarations),
    ]),
  );

  const originales = detallesOriginales([
    ...camposNoPresentados("", review, REVISION_CONOCIDA, ANIDADOS_REVISION),
    ...camposNoPresentados("cierre.", closure, CIERRE_CONOCIDO),
  ]);
  if (originales) contenedor.append(originales);
}
