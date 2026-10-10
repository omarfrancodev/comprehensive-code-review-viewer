/** Ficha de la revisión: perfil, alcance, responsabilidades y límites. */

import { campo, elemento, listaDefinitiva, seccion } from "./dom.js";

const ESTADOS_COMPATIBILIDAD = {
  supported: "soportada",
  historical: "histórica",
  limited: "limitada",
};

function coberturaAreas(coverage) {
  const areas = Array.isArray(coverage?.areas) ? coverage.areas : [];
  if (areas.length === 0) return null;
  const lista = elemento("ul", { clase: "areas" });
  for (const area of areas) {
    const item = elemento("li");
    item.append(elemento("strong", { texto: `${area.area} — ${area.status}` }));
    item.append(elemento("span", { texto: ` ${area.details ?? ""}` }));
    if (area.material) item.append(elemento("span", { clase: "marca marca--material", texto: " material" }));
    if (Array.isArray(area.finding_ids) && area.finding_ids.length > 0) {
      item.append(elemento("span", { clase: "nota", texto: ` referencias: ${area.finding_ids.join(", ")}` }));
    }
    lista.append(item);
  }
  return lista;
}

/**
 * Dibuja la ficha conservando los valores de origen sin reinterpretarlos.
 * El perfil no se normaliza y el veredicto no se recalcula.
 */
export function renderProfile(contenedor, view) {
  contenedor.replaceChildren();
  const review = view?.review ?? null;
  const summary = view?.summary ?? {};
  const closure = view?.closure ?? null;

  const encabezado = elemento("header", { clase: "revision-encabezado" });
  encabezado.append(elemento("h2", { texto: review?.presentation?.subject ?? "Code Review" }));
  encabezado.append(
    elemento("p", {
      clase: "identidad",
      texto: `Revisión de origen: ${summary.source_review_id ?? "No identificado"}`,
    }),
  );
  if (view?.compatibility) {
    encabezado.append(
      elemento("p", {
        clase: "marca marca--compatibilidad",
        texto: `Compatibilidad ${ESTADOS_COMPATIBILIDAD[view.compatibility] ?? view.compatibility}`,
      }),
    );
  }
  contenedor.append(encabezado);

  const reservas = Array.isArray(review?.reservations) ? review.reservations : [];
  const listaReservas = reservas.length > 0 ? elemento("ul", { clase: "lista-simple" }) : null;
  for (const reserva of reservas) {
    listaReservas.append(elemento("li", { texto: reserva }));
  }

  contenedor.append(
    seccion("Veredicto de la fuente", [
      listaDefinitiva([
        campo("Veredicto", review?.verdict, { textoVacio: "Sin veredicto registrado" }),
        campo("Motivo", review?.verdict_reason, { textoVacio: "Sin motivo registrado" }),
        campo("Reservas", listaReservas, { textoVacio: "Sin reservas registradas" }),
      ]),
    ]),
  );

  contenedor.append(
    seccion("Alcance", [
      listaDefinitiva([
        campo("Modo", review?.scope?.mode ?? closure?.scope?.mode),
        campo("Referencia", review?.scope?.reference ?? closure?.scope?.reference),
        campo("Objetivo", review?.scope?.target ?? closure?.scope?.target),
        campo("Base", review?.scope?.base ?? closure?.scope?.base),
        campo("Cabeza", review?.scope?.head ?? closure?.scope?.head),
        campo("Instantánea", review?.scope?.snapshot ?? closure?.scope?.snapshot),
      ]),
    ]),
  );

  const autores = elemento("ul", { clase: "lista-simple" });
  for (const autor of review?.change_authors ?? []) {
    autores.append(
      elemento("li", {
        texto: `${autor.name ?? "Sin nombre"}${autor.username ? ` (@${autor.username})` : ""}${
          autor.verified ? " · cuenta verificada" : " · identidad no verificada"
        }`,
      }),
    );
  }

  contenedor.append(
    seccion("Responsabilidad", [
      listaDefinitiva([
        campo("Responsable", review?.responsible?.name, {
          nota: review?.responsible?.verified
            ? "Cuenta verificada por la fuente."
            : "Identidad declarada, no verificada.",
        }),
        campo("Autores del cambio", autores, {
          textoVacio: "Sin autores del cambio registrados",
          nota: "La autoría del cambio es un dato distinto de la responsabilidad.",
        }),
      ]),
    ]),
  );

  const marcas = elemento("ul", { clase: "marcas" });
  const coverage = review?.coverage ?? {};
  if (coverage.stale) marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Revisión caducada" }));
  if (coverage.adequate === false) marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Cobertura insuficiente" }));
  if (view?.compatibility === "limited") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Compatibilidad limitada" }));
  if (closure?.cleanup === "pending") marcas.append(elemento("li", { clase: "marca marca--aviso", texto: "Limpieza pendiente" }));

  const limites = [
    campo("Perfil", review?.profile, { nota: "Valor original de la fuente, sin normalizar." }),
    campo("Motivo del perfil", review?.profile_reason, { textoVacio: "Sin motivo registrado" }),
    campo("Verificación", coverage.verification, { textoVacio: "No declarada" }),
    campo("Limitaciones", coverage.limitations?.details, { textoVacio: "Sin limitaciones registradas" }),
    campo("Estado del archivo", closure?.state, { textoVacio: "Sin cierre registrado" }),
    campo("Limpieza", closure?.cleanup, { textoVacio: "Sin dato de limpieza" }),
    campo("Marcas", marcas.children.length > 0 ? marcas : null, { textoVacio: "Sin marcas activas" }),
  ];

  const areas = coberturaAreas(coverage);
  if (areas) limites.push(campo("Cobertura ABCDE", areas));

  contenedor.append(seccion("Límites y estado", [listaDefinitiva(limites)]));
}