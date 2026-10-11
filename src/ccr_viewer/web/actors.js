/**
 * Franja de actores del explorador (§6.2).
 *
 * Participantes deduplicados por la identidad declarada (kind/name/provider_id),
 * en orden de primera aparición. Una identidad ausente es «Actor no declarado»:
 * nunca se sustituye por el registrador ni por el ejecutor. La franja muestra
 * 8 accesos por ventana; «Ver todos los actores» abre una lista paginada de 50.
 * Elegir un actor no filtra ni agrupa las tarjetas.
 */

import { botonAccion, elemento, fijarInactivo, reconciliarHijos } from "./dom.js";

export const ACTORES_POR_VENTANA = 8;
export const ACTORES_POR_PAGINA = 50;

/** `provider_id` original de una clave de `actorKey`, o `""`. */
function proveedorDeClave(clave) {
  try {
    const partes = JSON.parse(clave);
    return Array.isArray(partes) && typeof partes[2] === "string" ? partes[2] : "";
  } catch {
    return "";
  }
}

/**
 * Etiqueta visible de cada actor por su clave. Si identidades distintas
 * comparten etiqueta (solo difieren en `provider_id`), se añade el proveedor
 * y, como último recurso, un ordinal. Claves e identidades no cambian.
 */
export function etiquetasDeActores(actores) {
  const grupos = new Map();
  for (const actor of actores) {
    const grupo = grupos.get(actor.label) ?? [];
    grupo.push(actor);
    grupos.set(actor.label, grupo);
  }
  const etiquetas = new Map();
  for (const [etiqueta, grupo] of grupos) {
    if (grupo.length === 1) {
      etiquetas.set(grupo[0].key, etiqueta);
      continue;
    }
    const pistas = grupo.map((actor) => proveedorDeClave(actor.key) || "sin proveedor");
    const unicas = new Set(pistas).size === grupo.length;
    grupo.forEach((actor, i) => {
      etiquetas.set(actor.key, `${etiqueta} (${unicas ? pistas[i] : `${pistas[i]} · ${i + 1}`})`);
    });
  }
  return etiquetas;
}

const cuenta = (n) => (n === 1 ? "1 hito" : `${n} hitos`);

/** Botón de acceso a un actor: nombre visible y número de hitos. */
function botonActor(actor, etiqueta, onActor) {
  const nombre = elemento("span", { clase: "actor-nombre", texto: etiqueta });
  const total = elemento("span", { clase: "actor-cuenta", texto: cuenta(actor.count) });
  const boton = elemento("button", { clase: "actor", atributos: { type: "button", "data-actor-key": actor.key } });
  boton.append(
    elemento("span", { clase: "solo-lectores", texto: "Primer hito de " }),
    nombre,
    elemento("span", { clase: "solo-lectores", texto: ", " }),
    total,
  );
  boton.addEventListener("click", () => onActor(actor.key));
  return { boton, nombre, total };
}

/**
 * Franja con ventanas de 8 actores. `render` recibe el modelo, las etiquetas
 * y la clave del actor del hito seleccionado; con `seguir`, la ventana se
 * desplaza hasta ese actor.
 */
export function crearFranjaActores({ onActor, onVerTodos }) {
  const raiz = elemento("div", {
    clase: "explorador-actores",
    atributos: { "data-part": "actors", role: "group", "aria-label": "Actores" },
  });
  const lista = elemento("div", { clase: "actores-lista" });
  const pie = elemento("div", { clase: "actores-pie" });
  const rango = elemento("span", { clase: "actores-rango" });
  const anterior = botonAccion("Actores anteriores", () => mover(-1));
  const siguiente = botonAccion("Actores siguientes", () => mover(1));
  const todos = botonAccion("Ver todos los actores", () => onVerTodos());
  const aviso = elemento("p", { clase: "actores-aviso", atributos: { "data-part": "actors-notice", role: "status" } });
  pie.append(rango, anterior, siguiente, todos);
  raiz.append(lista, pie, aviso);

  const cache = new Map();
  let actores = [];
  let etiquetas = new Map();
  let actual = null;
  let inicio = 0;

  function pintar() {
    const total = actores.length;
    const fin = Math.min(inicio + ACTORES_POR_VENTANA, total);
    const nodos = [];
    const vigentes = new Set();
    for (let i = inicio; i < fin; i += 1) {
      const actor = actores[i];
      const etiqueta = etiquetas.get(actor.key) ?? actor.label;
      let entrada = cache.get(actor.key);
      if (!entrada) {
        entrada = botonActor(actor, etiqueta, onActor);
        cache.set(actor.key, entrada);
      }
      entrada.nombre.textContent = etiqueta;
      entrada.total.textContent = cuenta(actor.count);
      if (actor.key === actual) entrada.boton.setAttribute("aria-current", "true");
      else entrada.boton.removeAttribute("aria-current");
      vigentes.add(actor.key);
      nodos.push(entrada.boton);
    }
    for (const clave of [...cache.keys()]) if (!vigentes.has(clave)) cache.delete(clave);
    reconciliarHijos(lista, nodos);
    pie.hidden = total <= ACTORES_POR_VENTANA;
    rango.textContent = `Actores ${total ? inicio + 1 : 0}–${fin} de ${total}`;
    fijarInactivo(anterior, inicio === 0);
    fijarInactivo(siguiente, fin >= total);
  }

  function mover(delta) {
    const ultimo = Math.max(0, Math.floor((actores.length - 1) / ACTORES_POR_VENTANA) * ACTORES_POR_VENTANA);
    inicio = Math.min(Math.max(0, inicio + delta * ACTORES_POR_VENTANA), ultimo);
    pintar();
  }

  return {
    elemento: raiz,
    render(modelo, nuevasEtiquetas, claveActual, { seguir = false } = {}) {
      actores = modelo.actors;
      etiquetas = nuevasEtiquetas;
      actual = claveActual;
      if (seguir && claveActual !== null) {
        const posicion = actores.findIndex((actor) => actor.key === claveActual);
        if (posicion >= 0 && (posicion < inicio || posicion >= inicio + ACTORES_POR_VENTANA)) {
          inicio = Math.floor(posicion / ACTORES_POR_VENTANA) * ACTORES_POR_VENTANA;
        }
      }
      if (inicio >= actores.length) inicio = Math.max(0, Math.floor((actores.length - 1) / ACTORES_POR_VENTANA) * ACTORES_POR_VENTANA);
      pintar();
    },
    /** Explica en la franja por qué un actor no cambió la selección. */
    avisar(texto) {
      aviso.textContent = texto;
    },
  };
}

/**
 * Lista paginada de 50 actores en un `<dialog>` del shell. Elegir uno cierra
 * el diálogo (el foco vuelve al invocador) y lo comunica con `onActor`.
 * Devuelve la función que cierra el diálogo.
 */
export function abrirListaActores(openDialog, { actores, etiquetas, actual, onActor }) {
  const total = actores.length;
  let pagina = 0;
  return openDialog({
    title: `Actores (${total})`,
    build(cuerpo, cerrar) {
      const rango = elemento("p", { clase: "nota" });
      const lista = elemento("ul", { clase: "actores-dialogo" });
      const nav = elemento("div", { clase: "actores-dialogo-nav" });
      const anterior = botonAccion("Página anterior de actores", () => {
        pagina -= 1;
        pintar();
      });
      const siguiente = botonAccion("Página siguiente de actores", () => {
        pagina += 1;
        pintar();
      });
      nav.append(anterior, siguiente);

      function pintar() {
        const inicio = pagina * ACTORES_POR_PAGINA;
        const fin = Math.min(inicio + ACTORES_POR_PAGINA, total);
        const filas = actores.slice(inicio, fin).map((actor) => {
          const { boton } = botonActor(actor, etiquetas.get(actor.key) ?? actor.label, (clave) => {
            cerrar();
            onActor(clave);
          });
          if (actor.key === actual) boton.setAttribute("aria-current", "true");
          const fila = elemento("li");
          fila.append(boton);
          return fila;
        });
        lista.replaceChildren(...filas);
        rango.textContent = `Actores ${total ? inicio + 1 : 0}–${fin} de ${total}, en orden de primera aparición.`;
        fijarInactivo(anterior, pagina === 0);
        fijarInactivo(siguiente, fin >= total);
        nav.hidden = total <= ACTORES_POR_PAGINA;
      }

      pintar();
      cuerpo.append(rango, lista, nav);
    },
  });
}
