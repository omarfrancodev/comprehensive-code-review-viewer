/** Biblioteca: lista de revisiones con filtros y estados vacíos o de error. */

import { elemento, seccion } from "./dom.js";

const ESTADOS = {
  closed: "cerrada",
  open_activity_unknown: "abierta, actividad desconocida",
  open_recent_activity: "abierta, actividad reciente",
  result_available_closure_pending: "resultado disponible, cierre pendiente",
  interruption_recorded: "interrupción registrada",
};

/**
 * Dibuja la biblioteca. La selección y el desplazamiento se conservan porque
 * quien redibuja no toca esos campos del estado.
 */
export function renderLibrary(contenedor, state, dispatch) {
  contenedor.replaceChildren();
  contenedor.append(elemento("h2", { texto: "Revisiones" }));

  const filtros = elemento("form", { clase: "filtros" });
  filtros.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const datos = new FormData(filtros);
    const nuevo = {};
    for (const [clave, valor] of datos) {
      if (typeof valor === "string" && valor.trim() !== "") nuevo[clave] = valor.trim();
    }
    dispatch({ type: "setFilters", filters: nuevo });
  });

  const campo = (nombre, etiqueta, valor, tipo = "text") => {
    const etiquetaNodo = elemento("label", { texto: etiqueta });
    const entrada = elemento("input", {
      atributos: { name: nombre, value: valor ?? "", type: tipo, "aria-label": etiqueta },
    });
    const envoltorio = elemento("div", { clase: "filtro" });
    envoltorio.append(etiquetaNodo, entrada);
    return envoltorio;
  };

  filtros.append(
    campo("q", "Buscar", state.filters.q),
    campo("repository", "Repositorio", state.filters.repository),
    campo("verdict", "Veredicto", state.filters.verdict),
    campo("profile", "Perfil", state.filters.profile),
    campo("mode", "Modo", state.filters.mode),
    campo("reference", "Referencia", state.filters.reference),
    campo("kind", "Tipo", state.filters.kind),
    campo("open", "Abiertas (true/false)", state.filters.open),
    campo("date_from", "Desde", state.filters.date_from, "date"),
    campo("date_to", "Hasta", state.filters.date_to, "date"),
  );
  const botonera = elemento("div", { clase: "filtro-botones" });
  const aplicar = elemento("button", { atributos: { type: "submit" }, texto: "Filtrar" });
  const reiniciar = elemento("button", {
    atributos: { type: "button" },
    texto: "Limpiar",
  });
  reiniciar.addEventListener("click", () => dispatch({ type: "resetFilters" }));
  botonera.append(aplicar, reiniciar);
  filtros.append(botonera);
  contenedor.append(filtros);

  if (state.error) {
    contenedor.append(
      seccion("No se pudo cargar", [
        elemento("p", { clase: "estado estado--error", texto: state.error }),
      ]),
    );
    return;
  }

  const total = state.library?.total ?? 0;
  if (total === 0) {
    contenedor.append(
      seccion("Sin revisiones", [
        elemento("p", {
          clase: "estado",
          texto: "No hay revisiones archivadas que coincidan con los filtros actuales.",
        }),
      ]),
    );
    return;
  }

  const lista = elemento("ul", { clase: "lista-revisiones" });
  let previousGroup = null;
  for (const item of state.library.items ?? []) {
    const group = `${item.repository_identity ?? item.repository_label ?? item.key} · ${item.scope_label ?? "Sin alcance"}`;
    if (previousGroup !== group) {
      const heading = elemento("li", { clase: "grupo-revisiones" });
      heading.append(elemento("h3", { texto: group }));
      lista.append(heading);
      previousGroup = group;
    }
    const entrada = elemento("li");
    const boton = elemento("button", {
      clase: state.selectedRun === item.key ? "revision revision--activa" : "revision",
      atributos: {
        type: "button",
        "aria-pressed": state.selectedRun === item.key ? "true" : "false",
        "data-key": item.key,
      },
    });
    boton.append(elemento("span", { clase: "revision-alcance", texto: item.scope_label ?? "Sin alcance" }));
    boton.append(elemento("span", { clase: "revision-repo", texto: item.repository_label ?? item.key }));
    boton.append(
      elemento("span", {
        clase: "revision-estado",
        texto: `${ESTADOS[item.display_state] ?? item.display_state ?? "estado desconocido"} · ${
          item.verdict ?? "sin veredicto"
        }`,
      }),
    );
    if (item.recently_observed_change) {
      boton.append(elemento("span", { clase: "marca marca--actividad", texto: "cambio detectado" }));
    }
    if (item.archive_state === "processing") boton.append(elemento("span", { texto: "trabajo iniciado" }));
    if (item.last_recorded_at) boton.append(elemento("span", { clase: "nota", texto: `Último registro: ${item.last_recorded_at}` }));
    if (item.last_observed_change_at) boton.append(elemento("span", { clase: "nota", texto: `Último cambio detectado por el visor: ${item.last_observed_change_at}` }));
    if (item.phase) boton.append(elemento("span", { clase: "nota", texto: `Fase registrada: ${item.phase}` }));
    boton.addEventListener("click", () => dispatch({ type: "selectRun", key: item.key }));
    entrada.append(boton);
    lista.append(entrada);
  }
  contenedor.append(lista);
  const paginas = elemento("nav", { clase: "paginacion", atributos: { "aria-label": "Páginas de la biblioteca" } });
  const limite = state.library.limit ?? 50;
  for (const [texto, offset, disabled] of [
    ["Página anterior", Math.max(0, state.offset - limite), state.offset === 0],
    ["Página siguiente", state.offset + limite, state.offset + limite >= total],
  ]) {
    const boton = elemento("button", { texto, atributos: { type: "button", disabled } });
    boton.addEventListener("click", () => dispatch({ type: "setOffset", offset }));
    paginas.append(boton);
  }
  contenedor.append(paginas);
  contenedor.append(
    elemento("p", {
      clase: "estado",
      texto: `${total} revisión(es) · ${state.offset + 1}–${Math.min(state.offset + limite, total)}${state.library?.diagnostics?.length ? " · Biblioteca con limitaciones de exploración" : ""}`,
    }),
  );
}
