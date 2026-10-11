/**
 * Inspector del hito seleccionado (§6.3, §9, §11).
 *
 * Presenta el original completo: ID, secuencia, tipo y estado, resumen,
 * actor/registrador/ejecutor diferenciados, procedencia, autoridad, tiempos
 * (hora local, UTC y original visibles, con su base), relaciones navegables,
 * evidencia por claves del inventario y el JSON original desplegable. Copiar
 * usa siempre el valor completo. A nivel de traza conserva, como dato en un
 * detalle, el orden temporal declarado por la fuente (nunca como lista paralela
 * de tarjetas).
 *
 * Seleccionar nunca mueve el foco al inspector: solo si el foco ya estaba
 * dentro y su nodo desaparece, pasa al encabezado del hito nuevo. Todo texto
 * del archivo se escribe con `textContent`.
 */

import { etiquetasDeActores } from "./actors.js";
import { campo, elemento, textoDe } from "./dom.js";
import { actorKey, actorLabel, basisLabel, formatInstant } from "./present.js";
import { MOTIVOS_EVIDENCIA, classifyRelation, evidenceLink, evidenciasDe } from "./relations.js";

const ESTADOS_RELACION = {
  resolved: "resuelta",
  dangling: "colgante",
  unresolved: "sin resolver",
  ambiguous: "ambigua",
  unavailable: "no disponible",
  cyclic: "ciclo",
};

const EVENTO_LOCAL = /^E[0-9]{6}$/;

/** Identidad declarada; ausente se nombra como tal, sin sustituirla por otra. */
function identidadDe(valor, ausente) {
  if (actorKey(valor) === "∅") return ausente;
  const etiqueta = actorLabel(valor);
  const proveedor = typeof valor?.provider_id === "string" ? valor.provider_id.trim() : "";
  return proveedor && proveedor !== etiqueta ? `${etiqueta} (${proveedor})` : etiqueta;
}

function estadoDeRelacion(estado) {
  if (typeof estado === "string" && Object.hasOwn(ESTADOS_RELACION, estado)) return `${ESTADOS_RELACION[estado]} (${estado})`;
  return typeof estado === "string" && estado ? estado : "sin estado declarado";
}

function codigo(texto, clase) {
  return elemento("code", { clase, texto });
}

/** Copia `valor` completo; un fallo del portapapeles se avisa sin lanzar. */
async function copiar(valor, estado, nombre) {
  try {
    await globalThis.navigator.clipboard.writeText(valor);
    estado.textContent = `${nombre} copiado.`;
  } catch {
    estado.textContent = `No se pudo copiar: el portapapeles no está disponible. ${nombre} sigue visible en el inspector para seleccionarlo.`;
  }
}

/**
 * Monta el inspector en `container` (región del shell).
 *
 * - `getModel()`: modelo de traza vigente; `presenter.state().selectedId` da la selección.
 * - `runKey`: clave opaca de la corrida actual (relaciones locales frente a otras corridas).
 * - `inventory`: lista de archivos, promesa o función que la devuelve; se pide
 *   solo cuando un hito declara evidencia y una vez por modelo. Mientras se
 *   vuelve a pedir tras una recarga, sigue a la vista el último inventario listo.
 * - `onNavigate(destino)`: `{scope:"event"|"finding"|"check", id}`,
 *   `{scope:"run", runKey, id, label}` o `{scope:"file", fileKey, relativePath}`.
 *
 * Devuelve `update()` (refleja modelo y selección), `expand(seccion)`
 * (`"relaciones"`/`"evidencia"`) y `destroy()`.
 *
 * Recargar la fuente (§11) no mueve el foco ni borra la lectura: si el hito
 * seleccionado, sus relaciones, su etiqueta de actor y el inventario visible no
 * cambian, el inspector no se vuelve a pintar. Si algo cambió, se repinta en
 * su sitio conservando los `<details>` abiertos, el foco (por clave), el
 * desplazamiento y la selección de texto que sigan existiendo.
 */
export function mountInspector(container, { getModel, presenter, runKey, inventory, onNavigate } = {}) {
  const raiz = elemento("div", { clase: "inspector", atributos: { "data-part": "inspector", "data-event-id": "" } });
  const rotulo = elemento("p", { clase: "inspector-rotulo", texto: "Hito seleccionado" });
  let cuerpo = elemento("div", { clase: "inspector-cuerpo", atributos: { "data-part": "inspector-body" } });
  let orden = null;
  let ordenFirma = null;
  let ordenIds = [];
  let ordenLleno = false;
  raiz.append(rotulo, cuerpo);
  container.replaceChildren(raiz);
  container.hidden = false;

  // Secciones desplegadas por la persona: se conservan entre selecciones.
  const abiertas = { relaciones: false, evidencia: false, json: false };
  let inventario = { modelo: null, estado: "idle", archivos: null, error: null };
  let pintado = { id: undefined, firma: undefined };
  let etiquetas = { modelo: null, mapa: new Map() };
  let destruido = false;
  // Solo una navegación explícita desde el inspector a otro hito lleva el foco a su encabezado.
  let navegacionExplicita = null;

  const navegar = (destino) => {
    if (destruido) return;
    navegacionExplicita = destino?.scope === "event" ? destino.id : null;
    onNavigate?.(destino);
    navegacionExplicita = null;
  };

  function etiquetasDe(modelo) {
    if (etiquetas.modelo !== modelo) etiquetas = { modelo, mapa: etiquetasDeActores(modelo?.actors ?? []) };
    return etiquetas.mapa;
  }

  // --- Inventario (solo para evidencia) ------------------------------------

  /** Lo que el inventario aporta a la vista: cambia solo si cambia lo que se muestra. */
  function firmaDeInventario(estado) {
    if (estado.estado === "ready") {
      return `ready:${JSON.stringify(estado.archivos.map((archivo) => [archivo?.key, archivo?.relative_path]))}`;
    }
    return estado.estado === "error" ? `error:${estado.error}` : estado.estado;
  }

  function asegurarInventario(modelo) {
    if (inventario.modelo === modelo && inventario.estado !== "idle") return;
    // Tras una recarga se revalida en segundo plano: el último inventario listo
    // sigue a la vista y la evidencia enlazada nunca pasa a «comprobando».
    const listo = inventario.estado === "ready" ? inventario : null;
    const actual = listo ? { ...listo, modelo } : { modelo, estado: "loading", archivos: null, error: null };
    inventario = actual;
    const terminar = (estado, archivos, error) => {
      if (destruido || inventario !== actual) return;
      // Un fallo al revalidar conserva el inventario listo de esta misma corrida.
      if (estado === "error" && listo) return;
      inventario = { ...actual, estado, archivos, error };
      update();
    };
    let fuente;
    try {
      fuente = typeof inventory === "function" ? inventory() : inventory;
    } catch (error) {
      fuente = Promise.reject(error);
    }
    if (Array.isArray(fuente)) {
      inventario = { ...actual, estado: "ready", archivos: fuente };
      return;
    }
    if (!fuente || typeof fuente.then !== "function") {
      if (!listo) inventario = { ...actual, estado: "error", error: "el inventario no está disponible" };
      return;
    }
    fuente.then(
      (archivos) => (Array.isArray(archivos)
        ? terminar("ready", archivos, null)
        : terminar("error", null, "la respuesta del inventario no es una lista")),
      (error) => terminar("error", null, textoDe(error?.message) ?? "error desconocido"),
    );
  }

  // --- Secciones -------------------------------------------------------------

  function accion(texto, clave, alPulsar, extra) {
    const boton = elemento("button", { clase: "inspector-accion", atributos: { type: "button", "data-accion": clave } });
    boton.append(elemento("span", { texto }));
    if (extra) boton.append(elemento("span", { clase: "solo-lectores", texto: extra }));
    boton.addEventListener("click", alPulsar);
    return boton;
  }

  function filaCampo(nombre, etiqueta, valor, opciones) {
    const fila = campo(etiqueta, valor, opciones);
    fila.setAttribute("data-campo", nombre);
    return fila;
  }

  function seccionCopiar(id, evento) {
    const bloque = elemento("div", { clase: "inspector-copiar" });
    const estado = elemento("p", { clase: "inspector-copia-estado", atributos: { role: "status", "data-part": "copy-status" } });
    const botones = elemento("div", { clase: "inspector-acciones" });
    botones.append(accion("Copiar ID", "copiar-id", () => copiar(id, estado, "El ID")));
    const resumen = typeof evento.summary === "string" && evento.summary !== "" ? evento.summary : null;
    if (resumen !== null) botones.append(accion("Copiar resumen", "copiar-resumen", () => copiar(resumen, estado, "El resumen")));
    const json = JSON.stringify(evento, null, 2) ?? String(evento);
    botones.append(accion("Copiar JSON", "copiar-json", () => copiar(json, estado, "El JSON original")));
    bloque.append(botones, estado);
    return bloque;
  }

  function seccionCampos(evento, modelo) {
    const datos = elemento("dl", { clase: "campos inspector-campos" });
    const vacio = { textoVacio: "No declarado" };
    const sinActor = actorKey(evento.actor) === "∅";
    const actor = sinActor ? "Actor no declarado" : (etiquetasDe(modelo).get(actorKey(evento.actor)) ?? actorLabel(evento.actor));
    const filaActor = filaCampo("actor", "Actor", actor);
    if (sinActor) {
      filaActor.querySelector("dd").append(elemento("p", {
        clase: "nota",
        texto: "La fuente no declara actor para este hito; no se sustituye por el registrador ni por el ejecutor.",
        atributos: { "data-vacio": "actor" },
      }));
    } else {
      const completa = identidadDe(evento.actor, "");
      if (completa && completa !== actor) filaActor.querySelector("dd").append(elemento("p", { clase: "nota", texto: `Identidad declarada: ${completa}` }));
    }
    const procedencia = evento.provenance;
    let textoProcedencia = null;
    if (procedencia && typeof procedencia === "object" && !Array.isArray(procedencia)) {
      textoProcedencia = `${textoDe(procedencia.kind) ?? "tipo no declarado"} · ${textoDe(procedencia.source) ?? "origen no declarado"}`;
    } else {
      textoProcedencia = textoDe(procedencia);
    }
    const autoridad = textoDe(evento.authority);
    datos.append(
      filaCampo("secuencia", "Secuencia", textoDe(evento.sequence), vacio),
      filaCampo("tipo", "Tipo", textoDe(evento.kind), vacio),
      filaCampo("estado", "Estado original", textoDe(evento.status), vacio),
      filaActor,
      filaCampo("registrador", "Registrador", identidadDe(evento.recorder, "Registrador no declarado")),
      filaCampo("ejecutor", "Ejecutor", identidadDe(evento.executor, "Ejecutor no declarado")),
      filaCampo("procedencia", "Procedencia", textoProcedencia, { textoVacio: "Procedencia no declarada" }),
      filaCampo("autoridad", "Autoridad", autoridad === null ? null : codigo(autoridad, "inspector-valor-json"), { textoVacio: "Autoridad no declarada" }),
    );
    return datos;
  }

  function filaTiempo(nombre, etiqueta, valor) {
    const fila = campo(etiqueta, valor, { textoVacio: "No declarado" });
    fila.querySelector("dd").setAttribute("data-tiempo", nombre);
    return fila;
  }

  function seccionTiempo(evento) {
    const bloque = elemento("section", { clase: "inspector-seccion", atributos: { "data-part": "inspector-time" } });
    bloque.append(elemento("h3", { texto: "Tiempo" }));
    const instante = formatInstant(evento.temporal_at);
    const datos = elemento("dl", { clase: "campos inspector-campos" });
    datos.append(filaTiempo("base", "Base temporal", basisLabel(evento.temporal_basis)));
    if (instante.original === null) {
      bloque.append(elemento("p", {
        clase: "estado",
        texto: "Este hito no declara hora; se ubica solo por su secuencia y no se fabrica un instante.",
        atributos: { "data-vacio": "tiempo" },
      }));
    } else if (instante.local === null) {
      datos.append(
        filaTiempo("local", "Hora local", elemento("span", { clase: "valor--desconocido", texto: "Sin interpretar" })),
        filaTiempo("original", "Original", codigo(instante.original)),
      );
    } else {
      datos.append(
        filaTiempo("local", "Hora local", elemento("time", { texto: instante.local, atributos: { datetime: instante.original } })),
        filaTiempo("utc", "UTC", codigo(instante.utc)),
        filaTiempo("original", "Original", codigo(instante.original)),
      );
    }
    const ocurrencia = textoDe(evento.occurred_at);
    const registro = textoDe(evento.recorded_at);
    datos.append(
      filaTiempo("ocurrencia", "Ocurrencia declarada", ocurrencia === null ? null : codigo(ocurrencia)),
      filaTiempo("registro", "Registro", registro === null ? null : codigo(registro)),
    );
    bloque.append(datos);
    return bloque;
  }

  function detalle(seccion, parte, titulo) {
    const detalles = elemento("details", { clase: "inspector-detalle", atributos: { "data-part": parte, open: abiertas[seccion] } });
    detalles.append(elemento("summary", { texto: titulo, atributos: { "data-accion": `sumario-${seccion}` } }));
    detalles.addEventListener("toggle", () => {
      abiertas[seccion] = detalles.open;
    });
    return detalles;
  }

  /** Botón de navegación de una relación, o su explicación si no navega. */
  function salidaDeRelacion(relacion, direccion, posicion, modelo) {
    const clasificacion = classifyRelation(relacion, runKey);
    const clave = `relacion-${direccion}-${posicion}`;
    if (direccion === "incoming") {
      // La otra punta es el origen, un hito de esta traza.
      const origen = relacion.event_id;
      if (clasificacion.navigable && clasificacion.scope === "event" && EVENTO_LOCAL.test(origen) && modelo.byId.has(origen)) {
        return accion(`Abrir ${origen}`, clave, () => navegar({ scope: "event", id: origen }));
      }
    } else if (clasificacion.navigable) {
      if (clasificacion.scope === "run") {
        const revision = String(relacion.target).split("#")[0];
        return accion(`Abrir revisión ${revision}`, clave, () => navegar({ scope: "run", runKey: clasificacion.runKey, id: clasificacion.id, label: revision }), ` (destino ${clasificacion.id})`);
      }
      if (clasificacion.scope !== "event" || modelo.byId.has(clasificacion.id)) {
        return accion(`Abrir ${clasificacion.id}`, clave, () => navegar({ scope: clasificacion.scope, id: clasificacion.id }));
      }
      return elemento("p", { clase: "relacion-motivo", texto: "El hito de destino no está en el prefijo aceptado de esta traza; no se navega." });
    }
    const motivo = clasificacion.navigable
      ? "El origen no está en el prefijo aceptado de esta traza; no se navega."
      : clasificacion.reason;
    return elemento("p", { clase: "relacion-motivo", texto: motivo });
  }

  function itemRelacion(relacion, direccion, posicion, modelo) {
    const estado = typeof relacion.status === "string" ? relacion.status : "";
    const li = elemento("li", {
      clase: "inspector-relacion",
      atributos: { "data-relation-status": estado, "data-relation-direction": direccion },
    });
    const linea = elemento("p", { clase: "relacion-linea" });
    const destino = textoDe(relacion.raw) ?? textoDe(relacion.target) ?? "destino no declarado";
    linea.append(
      codigo(textoDe(relacion.event_id) ?? "origen no declarado", "relacion-extremo"),
      " ",
      elemento("span", { clase: "relacion-tipo", texto: textoDe(relacion.relation) ?? "vínculo no declarado" }),
      " → ",
      codigo(destino, "relacion-extremo"),
    );
    const meta = elemento("p", { clase: "relacion-estado", texto: `Resolución: ${estadoDeRelacion(relacion.status)}` });
    if (estado === "cyclic") meta.prepend(elemento("span", { clase: "relacion-ciclo", texto: "Ciclo declarado" }), " · ");
    li.append(linea, meta, salidaDeRelacion(relacion, direccion, posicion, modelo));
    return li;
  }

  function seccionRelaciones(id, modelo) {
    const { outgoing, incoming } = modelo.relationsOf(id);
    const total = outgoing.length + incoming.length;
    if (total === 0) {
      return elemento("p", { clase: "estado", texto: "Este hito no declara relaciones.", atributos: { "data-vacio": "relaciones" } });
    }
    const detalles = detalle("relaciones", "relations", `Relaciones (${total})`);
    const origen = elemento("p", { clase: "relaciones-origen", atributos: { "data-part": "relations-origin" } });
    origen.append("Origen: ", codigo(id));
    detalles.append(origen);
    if (outgoing.length > 0) {
      const lista = elemento("ul", { clase: "inspector-relaciones-lista", atributos: { "aria-label": `Destinos declarados por ${id}` } });
      outgoing.forEach((relacion, i) => lista.append(itemRelacion(relacion, "outgoing", i, modelo)));
      detalles.append(elemento("p", { clase: "inspector-subtitulo", texto: "Destinos declarados" }), lista);
    }
    if (incoming.length > 0) {
      const lista = elemento("ul", { clase: "inspector-relaciones-lista", atributos: { "aria-label": `Hitos que apuntan a ${id}` } });
      incoming.forEach((relacion, i) => lista.append(itemRelacion(relacion, "incoming", i, modelo)));
      detalles.append(elemento("p", { clase: "inspector-subtitulo", texto: "Hitos que apuntan a este" }), lista);
    }
    return detalles;
  }

  function itemEvidencia(item, posicion) {
    const sinInventario = evidenceLink(item, null);
    let enlace = sinInventario;
    let motivo = null;
    if (sinInventario.code === "not_in_inventory") {
      if (inventario.estado === "ready") enlace = evidenceLink(item, inventario.archivos);
      else if (inventario.estado === "error") motivo = "Sin inventario: no se puede comprobar la coincidencia exacta; se muestra como texto.";
      else motivo = "Comprobando el inventario de la corrida…";
    }
    if (enlace.kind === "file") {
      const li = elemento("li", { clase: "inspector-evidencia", atributos: { "data-evidence-kind": "file" } });
      li.append(
        codigo(enlace.relativePath),
        accion("Abrir en Documentos", `evidencia-${posicion}`, () => navegar({ scope: "file", fileKey: enlace.fileKey, relativePath: enlace.relativePath }), `: ${enlace.relativePath}`),
      );
      return li;
    }
    const pendiente = inventario.estado === "loading" && motivo !== null;
    const li = elemento("li", {
      clase: "inspector-evidencia",
      atributos: pendiente ? { "data-evidence-pending": "" } : { "data-evidence-code": enlace.code },
    });
    li.append(
      codigo(enlace.text),
      elemento("p", { clase: "evidencia-motivo", texto: motivo ?? MOTIVOS_EVIDENCIA[enlace.code] }),
    );
    return li;
  }

  function seccionEvidencia(evento, modelo) {
    const items = evidenciasDe(evento);
    if (items.length === 0) {
      return elemento("p", { clase: "estado", texto: "Este hito no declara evidencia.", atributos: { "data-vacio": "evidencia" } });
    }
    asegurarInventario(modelo);
    const detalles = detalle("evidencia", "evidence", `Evidencia (${items.length})`);
    detalles.append(elemento("p", {
      clase: "nota",
      texto: "Solo se enlazan archivos del inventario de esta corrida con la misma ruta relativa exacta.",
    }));
    if (inventario.estado === "error") {
      detalles.append(elemento("p", {
        clase: "estado estado--error",
        texto: `No se pudo leer el inventario de la corrida: ${inventario.error}. La evidencia se muestra como texto, sin enlace.`,
      }));
    }
    const lista = elemento("ul", { clase: "inspector-evidencia-lista" });
    items.forEach((item, i) => lista.append(itemEvidencia(item, i)));
    detalles.append(lista);
    return detalles;
  }

  function seccionJson(evento) {
    const detalles = detalle("json", "original-json", "JSON original del hito");
    detalles.append(
      elemento("p", { clase: "nota", texto: "Incluye los campos que el visor no presenta; nada se descarta." }),
      elemento("pre", { clase: "codigo", texto: JSON.stringify(evento, null, 2) ?? String(evento), atributos: { "data-texto": "json" } }),
    );
    return detalles;
  }

  function seccion(titulo, contenido) {
    const bloque = elemento("section", { clase: "inspector-seccion" });
    bloque.append(elemento("h3", { texto: titulo }), contenido);
    return bloque;
  }

  function contenidoDe(modelo, id, evento) {
    if (!evento) return [elemento("p", { clase: "estado", texto: "Sin hito seleccionado." })];
    const resumen = textoDe(evento.summary);
    return [
      elemento("h2", { clase: "inspector-id", texto: id, atributos: { tabindex: "-1" } }),
      seccionCopiar(id, evento),
      elemento("p", {
        clase: resumen === null ? "inspector-resumen valor--desconocido" : "inspector-resumen",
        texto: resumen ?? "Sin resumen declarado.",
        atributos: { "data-texto": "resumen" },
      }),
      seccionCampos(evento, modelo),
      seccionTiempo(evento),
      seccion("Relaciones", seccionRelaciones(id, modelo)),
      seccion("Evidencia", seccionEvidencia(evento, modelo)),
      seccionJson(evento),
    ];
  }

  // --- Orden temporal declarado (nivel de traza) ----------------------------

  /**
   * Detalle persistente: una recarga solo cambia su contenido si cambió el
   * orden declarado, sin reemplazar el `<details>` ni su `<summary>` (foco y
   * estado abierto se conservan).
   */
  function pintarOrden(modelo) {
    const hay = Boolean(modelo && modelo.events.length > 0);
    const ids = hay ? modelo.temporalOrder.filter((valor) => typeof valor === "string") : [];
    const firma = hay ? JSON.stringify(ids) : null;
    if (firma === ordenFirma) return;
    ordenFirma = firma;
    ordenIds = ids;
    if (!hay) {
      orden?.remove();
      orden = null;
      return;
    }
    if (!orden) {
      orden = elemento("details", { clase: "inspector-detalle inspector-orden-temporal", atributos: { "data-part": "temporal-order" } });
      orden.append(elemento("summary", { texto: "Orden temporal declarado por la fuente", atributos: { "data-accion": "sumario-orden" } }));
      // Se rellena al desplegarlo: una traza de 10 000 hitos no lo pinta de antemano.
      orden.addEventListener("toggle", () => {
        if (orden?.open) llenarOrden();
      });
      raiz.append(orden);
    }
    ordenLleno = false;
    while (orden.lastChild && orden.lastChild !== orden.firstChild) orden.lastChild.remove();
    if (orden.open) llenarOrden();
  }

  function llenarOrden() {
    if (!orden || ordenLleno) return;
    ordenLleno = true;
    orden.append(elemento("p", {
      clase: "nota",
      texto: "Dato de la fuente (hora observada y luego secuencia). No sustituye el orden de secuencia de las tarjetas ni indica duración o dependencia.",
    }));
    if (ordenIds.length === 0) {
      orden.append(elemento("p", { clase: "estado", texto: "La fuente no declaró un orden temporal para esta traza." }));
      return;
    }
    const linea = elemento("p", { clase: "inspector-orden-ids" });
    linea.append(codigo(ordenIds.join(" → ")));
    orden.append(linea);
  }

  // --- Estado de lectura (selección de texto y desplazamiento) --------------

  /** Selección de texto dentro de un elemento con `data-texto` del cuerpo, como desplazamientos. */
  function capturarSeleccion() {
    const seleccion = globalThis.getSelection?.();
    if (!seleccion || seleccion.rangeCount === 0 || seleccion.isCollapsed) return null;
    const rango = seleccion.getRangeAt(0);
    const nodo = rango.commonAncestorContainer;
    const dueno = (nodo.nodeType === 1 ? nodo : nodo.parentElement)?.closest?.("[data-texto]");
    if (!dueno || !cuerpo.contains(dueno)) return null;
    const previo = document.createRange();
    previo.selectNodeContents(dueno);
    previo.setEnd(rango.startContainer, rango.startOffset);
    const inicio = previo.toString().length;
    return { clave: dueno.getAttribute("data-texto"), texto: dueno.textContent, inicio, fin: inicio + rango.toString().length };
  }

  /** Punto (nodo de texto, desplazamiento) del carácter `posicion` dentro de `raizTexto`. */
  function puntoEn(raizTexto, posicion) {
    const caminante = document.createTreeWalker(raizTexto, NodeFilter.SHOW_TEXT);
    let restante = posicion;
    let ultimo = null;
    for (let nodo = caminante.nextNode(); nodo; nodo = caminante.nextNode()) {
      if (restante <= nodo.length) return [nodo, restante];
      restante -= nodo.length;
      ultimo = nodo;
    }
    return ultimo ? [ultimo, ultimo.length] : null;
  }

  function restaurarSeleccion(guardada) {
    if (!guardada) return;
    const dueno = cuerpo.querySelector(`[data-texto="${guardada.clave}"]`);
    // Solo si el texto es el mismo: nunca se selecciona otra cosa.
    if (!dueno || dueno.textContent !== guardada.texto) return;
    const inicio = puntoEn(dueno, guardada.inicio);
    const fin = puntoEn(dueno, guardada.fin);
    if (!inicio || !fin) return;
    const rango = document.createRange();
    rango.setStart(...inicio);
    rango.setEnd(...fin);
    const seleccion = globalThis.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  }

  /** Desplazamientos de la región, de la ventana y de los bloques con `data-texto` (p. ej. el JSON). */
  function capturarDesplazamiento() {
    const bloques = [...cuerpo.querySelectorAll("[data-texto]")]
      .filter((nodo) => nodo.scrollTop > 0 || nodo.scrollLeft > 0)
      .map((nodo) => ({ clave: nodo.getAttribute("data-texto"), top: nodo.scrollTop, left: nodo.scrollLeft }));
    return { region: container.scrollTop, ventana: [globalThis.scrollX ?? 0, globalThis.scrollY ?? 0], bloques };
  }

  function restaurarDesplazamiento(guardado) {
    if (container.scrollTop !== guardado.region) container.scrollTop = guardado.region;
    for (const { clave, top, left } of guardado.bloques) {
      const nodo = cuerpo.querySelector(`[data-texto="${clave}"]`);
      if (nodo) {
        nodo.scrollTop = top;
        nodo.scrollLeft = left;
      }
    }
    const [x, y] = guardado.ventana;
    if (globalThis.scrollX !== x || globalThis.scrollY !== y) globalThis.scrollTo?.(x, y);
  }

  // --- Actualización ---------------------------------------------------------

  /**
   * Todo lo que el cuerpo muestra para el hito: el original, sus relaciones,
   * la etiqueta de actor y, si declara evidencia, el inventario visible.
   */
  function firmaDe(modelo, id, evento) {
    if (!evento) return "sin-hito";
    const { outgoing, incoming } = modelo.relationsOf(id);
    const etiqueta = etiquetasDe(modelo).get(actorKey(evento.actor)) ?? null;
    const conEvidencia = evidenciasDe(evento).length > 0;
    return JSON.stringify([evento, outgoing, incoming, etiqueta, conEvidencia ? firmaDeInventario(inventario) : null]);
  }

  function update() {
    if (destruido) return;
    const modelo = typeof getModel === "function" ? getModel() : null;
    const seleccion = presenter?.state?.().selectedId;
    const evento = modelo && typeof seleccion === "string" ? modelo.byId.get(seleccion) : undefined;
    const id = evento ? seleccion : null;
    pintarOrden(modelo);
    // El inventario se pide (o revalida) antes de comparar: forma parte de lo visible.
    if (evento && evidenciasDe(evento).length > 0) asegurarInventario(modelo);
    const firma = firmaDe(modelo, id, evento);
    // Mismo hito con el mismo contenido (p. ej. una recarga de la fuente): nada se repinta.
    if (id === pintado.id && firma === pintado.firma) return;
    const mismoHito = id === pintado.id && pintado.id !== undefined;
    pintado = { id, firma };
    raiz.setAttribute("data-event-id", id ?? "");

    const activo = document.activeElement;
    const focoDentro = Boolean(activo && cuerpo.contains(activo));
    const claveFoco = focoDentro ? activo.closest("[data-accion]")?.getAttribute("data-accion") : null;
    if (mismoHito) {
      // Mismo hito con cambios: en su sitio, sin transición y conservando la lectura.
      const seleccionGuardada = capturarSeleccion();
      const desplazamiento = capturarDesplazamiento();
      cuerpo.replaceChildren(...contenidoDe(modelo, id, evento));
      restaurarDesplazamiento(desplazamiento);
      restaurarSeleccion(seleccionGuardada);
      // El control enfocado vuelve si sigue existiendo; si no, el foco no se lleva a otro sitio.
      if (claveFoco) cuerpo.querySelector(`[data-accion="${claveFoco}"]`)?.focus({ preventScroll: true });
      return;
    }
    // Hito nuevo: un cuerpo nuevo entra con la transición corta del inspector.
    const nuevo = elemento("div", { clase: "inspector-cuerpo", atributos: { "data-part": "inspector-body" } });
    nuevo.append(...contenidoDe(modelo, id, evento));
    cuerpo.replaceWith(nuevo);
    cuerpo = nuevo;
    // Solo la navegación explícita desde el inspector lleva el foco al encabezado del hito.
    if (focoDentro && navegacionExplicita === id) cuerpo.querySelector(".inspector-id")?.focus({ preventScroll: true });
  }

  return {
    update,
    /** Despliega una sección del hito actual (acción explícita); no mueve el foco. */
    expand(seccionPedida) {
      if (destruido || (seccionPedida !== "relaciones" && seccionPedida !== "evidencia")) return;
      abiertas[seccionPedida] = true;
      const parte = seccionPedida === "relaciones" ? "relations" : "evidence";
      const detalles = cuerpo.querySelector(`details[data-part="${parte}"]`);
      if (!detalles) return;
      detalles.open = true;
      detalles.scrollIntoView?.({ block: "nearest" });
    },
    destroy() {
      if (destruido) return;
      destruido = true;
      container.replaceChildren();
      container.hidden = true;
    },
  };
}
