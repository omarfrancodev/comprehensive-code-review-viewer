/**
 * Utilidades de construcción de DOM.
 *
 * Todo texto no confiable se escribe con `textContent`. Nunca se interpreta
 * HTML de origen: el contenido del archivo es dato, no instrucción.
 */

/** Crea un elemento con clase, texto y atributos seguros. */
export function elemento(tag, { clase, texto, atributos } = {}) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
  for (const [nombre, valor] of Object.entries(atributos ?? {})) {
    if (valor === undefined || valor === null || valor === false) continue;
    nodo.setAttribute(nombre, valor === true ? "" : String(valor));
  }
  return nodo;
}

/** Etiqueta de campo con su valor, para listas de definición. */
export function campo(etiqueta, valor, opciones = {}) {
  const fila = elemento("div", { clase: "campo" });
  fila.append(elemento("dt", { texto: etiqueta }));
  const cuerpo = elemento("dd");
  if (valor === null || valor === undefined || valor === "") {
    cuerpo.append(elemento("span", { clase: "valor--desconocido", texto: opciones.textoVacio ?? "No identificado" }));
  } else if (typeof valor === "string" || typeof valor === "number") {
    cuerpo.textContent = String(valor);
  } else {
    cuerpo.append(valor);
  }
  if (opciones.nota) cuerpo.append(elemento("p", { clase: "nota", texto: opciones.nota }));
  fila.append(cuerpo);
  return fila;
}

/** Inserta un aviso visible y comprensible sin datos de traza técnica. */
export function seccion(titulo, hijos, clase) {
  const bloque = elemento("section", { clase: clase ?? "seccion" });
  bloque.append(elemento("h2", { texto: titulo }));
  for (const hijo of hijos) if (hijo) bloque.append(hijo);
  return bloque;
}

export function listaDefinitiva(filas) {
  const dl = elemento("dl", { clase: "campos" });
  for (const fila of filas) if (fila) dl.append(fila);
  return dl;
}
/** Valor de la fuente como texto: cadena y números tal cual, el resto como JSON. */
export function textoDe(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return JSON.stringify(valor, null, 2) ?? String(valor);
}

/** `<details>` que conserva el JSON de `valor` sin interpretarlo. */
export function detallesJson(titulo, valor, clase = "json-secundario") {
  const detalles = elemento("details", { clase });
  detalles.append(
    elemento("summary", { texto: titulo }),
    elemento("pre", { clase: "codigo", texto: JSON.stringify(valor, null, 2) ?? String(valor) }),
  );
  return detalles;
}

/**
 * Destino de navegación pendiente para la pestaña `tab`. Lo consume: avisa al
 * almacén para que no se reaplique y devuelve su ID, o `null` si no hay uno.
 */
export function consumirDestino(contexto, dispatch, tab) {
  const destino = contexto?.target;
  if (!destino || destino.tab !== tab || typeof destino.id !== "string") return null;
  if (typeof dispatch === "function") dispatch({ type: "clearTarget" });
  return destino.id;
}

/**
 * Botón de acción. Inactivo se marca con `aria-disabled` (no `disabled`):
 * conserva el foco del teclado y simplemente no actúa.
 */
export function botonAccion(texto, accion, { clase, atributos } = {}) {
  const nodo = elemento("button", { clase, texto, atributos: { type: "button", ...atributos } });
  nodo.addEventListener("click", (evento) => {
    if (nodo.getAttribute("aria-disabled") === "true") return;
    accion(evento);
  });
  return nodo;
}

export function fijarInactivo(nodo, inactivo) {
  if (inactivo) nodo.setAttribute("aria-disabled", "true");
  else nodo.removeAttribute("aria-disabled");
}

/**
 * Deja en `padre` exactamente `nodos`, en ese orden. Solo mueve los que no
 * ocupan ya su sitio: un nodo que no cambia de posición no se reinserta y
 * conserva el foco; los sobrantes se retiran.
 */
export function reconciliarHijos(padre, nodos) {
  let referencia = padre.firstChild;
  for (const nodo of nodos) {
    if (nodo === referencia) {
      referencia = referencia.nextSibling;
      continue;
    }
    padre.insertBefore(nodo, referencia);
  }
  while (referencia) {
    const siguiente = referencia.nextSibling;
    referencia.remove();
    referencia = siguiente;
  }
}

/**
 * Desplaza solo `panel` (nunca la página) para que `nodo` quede visible.
 * Devuelve el `scrollTop` resultante.
 */
export function mostrarEnPanel(panel, nodo, margen = 8) {
  const caja = panel.getBoundingClientRect();
  const destino = nodo.getBoundingClientRect();
  if (destino.top < caja.top) panel.scrollTop += destino.top - caja.top - margen;
  else if (destino.bottom > caja.bottom) panel.scrollTop += destino.bottom - caja.bottom + margen;
  return panel.scrollTop;
}

/**
 * Lleva `nodo` a la vista una vez terminado el redibujo (la aplicación
 * restaura el desplazamiento al final del suyo) y, opcionalmente, le da el foco.
 */
export function traerAVista(nodo, { enfocar = false } = {}) {
  queueMicrotask(() => {
    if (typeof nodo.scrollIntoView === "function") nodo.scrollIntoView({ block: "nearest" });
    if (enfocar && typeof nodo.focus === "function") nodo.focus({ preventScroll: true });
  });
}

// --- Instantánea de interfaz para recargas en vivo --------------------------

/** Atributos que identifican de forma estable un elemento enfocable. */
const ATRIBUTOS_CLAVE = [
  "data-filtro", "data-clave", "data-key", "data-event-id", "data-file-key", "data-detalle",
];

/** Descriptor estable de un elemento: atributo de clave o, si no, rol y nombre. */
function descriptorDe(nodo) {
  for (const atributo of ATRIBUTOS_CLAVE) {
    const valor = nodo.getAttribute(atributo);
    if (valor !== null) return { etiqueta: nodo.tagName, atributo, valor };
  }
  const nombre = nodo.getAttribute("aria-label") ?? nodo.textContent ?? "";
  return { etiqueta: nodo.tagName, atributo: null, valor: nombre.trim().slice(0, 120), rol: nodo.getAttribute("role") };
}

/** Descriptor de un contenedor con desplazamiento: sin texto, que cambia al recargar. */
function descriptorDeScroll(nodo) {
  return { etiqueta: nodo.tagName, clase: nodo.className, nombre: nodo.getAttribute("aria-label") ?? "" };
}

function coincideFoco(nodo, d) {
  if (nodo.tagName !== d.etiqueta) return false;
  if (d.atributo) return nodo.getAttribute(d.atributo) === d.valor;
  return descriptorDe(nodo).valor === d.valor && nodo.getAttribute("role") === d.rol;
}

function coincideScroll(nodo, d) {
  const otro = descriptorDeScroll(nodo);
  return otro.etiqueta === d.etiqueta && otro.clase === d.clase && otro.nombre === d.nombre;
}

const resumenDe = (detalles) => detalles.querySelector("summary")?.textContent?.trim() ?? "";

function coincideDetalles(nodo, d) {
  return nodo.className === d.clase && resumenDe(nodo) === d.resumen;
}

/** Elementos de `raiz` que cumplen `filtro`, en orden de documento. */
function iguales(raiz, selector, filtro) {
  return [...raiz.querySelectorAll(selector)].filter(filtro);
}

/**
 * Instantánea de la interfaz dentro de `raiz`: foco (con caret), desplazamiento
 * de cada contenedor con scroll, desplazamiento de la ventana y `<details>`
 * abiertos. Los elementos se identifican por claves estables, no por posición
 * en el árbol, para poder reencontrarlos tras redibujar.
 */
export function capturarInterfaz(raiz, doc = document) {
  const instantanea = { foco: null, scrolls: [], detalles: [], ventana: { x: 0, y: 0 }, raiz: null };
  const win = doc.defaultView;
  if (win) instantanea.ventana = { x: win.scrollX, y: win.scrollY };

  const activo = doc.activeElement;
  if (activo && activo !== raiz && raiz.contains(activo)) {
    const d = descriptorDe(activo);
    const foco = { d, ordinal: iguales(raiz, d.etiqueta, (n) => coincideFoco(n, d)).indexOf(activo), seleccion: null };
    try {
      if (typeof activo.selectionStart === "number") {
        foco.seleccion = [activo.selectionStart, activo.selectionEnd, activo.selectionDirection ?? "none"];
      }
    } catch {
      // Algunos tipos de campo no exponen su selección.
    }
    if (foco.ordinal >= 0) instantanea.foco = foco;
  }

  for (const nodo of raiz.querySelectorAll("*")) {
    if (nodo.scrollTop <= 0 && nodo.scrollLeft <= 0) continue;
    const d = descriptorDeScroll(nodo);
    const ordinal = iguales(raiz, d.etiqueta, (n) => coincideScroll(n, d)).indexOf(nodo);
    if (ordinal >= 0) instantanea.scrolls.push({ d, ordinal, top: nodo.scrollTop, left: nodo.scrollLeft });
  }
  if (raiz.scrollTop > 0 || raiz.scrollLeft > 0) {
    instantanea.raiz = { top: raiz.scrollTop, left: raiz.scrollLeft };
  }

  for (const nodo of raiz.querySelectorAll("details")) {
    if (!nodo.open) continue;
    const d = { clase: nodo.className, resumen: resumenDe(nodo) };
    instantanea.detalles.push({ d, ordinal: iguales(raiz, "details", (n) => coincideDetalles(n, d)).indexOf(nodo) });
  }
  return instantanea;
}

/**
 * Restaura una instantánea sobre el DOM nuevo. Solo actúa sobre lo que
 * reencuentra: no inventa foco ni se lo quita a quien lo movió entretanto.
 */
export function restaurarInterfaz(raiz, instantanea, doc = document) {
  if (!instantanea) return;
  for (const { d, ordinal } of instantanea.detalles) {
    const nodo = iguales(raiz, "details", (n) => coincideDetalles(n, d))[ordinal];
    if (nodo) nodo.open = true;
  }
  if (instantanea.raiz) {
    raiz.scrollTop = instantanea.raiz.top;
    raiz.scrollLeft = instantanea.raiz.left;
  }
  for (const { d, ordinal, top, left } of instantanea.scrolls) {
    const nodo = iguales(raiz, d.etiqueta, (n) => coincideScroll(n, d))[ordinal];
    if (nodo) {
      nodo.scrollTop = top;
      nodo.scrollLeft = left;
    }
  }
  const win = doc.defaultView;
  if (win && (instantanea.ventana.x > 0 || instantanea.ventana.y > 0)) {
    win.scrollTo(instantanea.ventana.x, instantanea.ventana.y);
  }
  const { foco } = instantanea;
  const activo = doc.activeElement;
  // Solo si el foco quedó en el cuerpo: nunca se roba a quien lo movió.
  if (foco && (!activo || activo === doc.body)) {
    const nodo = iguales(raiz, foco.d.etiqueta, (n) => coincideFoco(n, foco.d))[foco.ordinal];
    if (nodo && typeof nodo.focus === "function") {
      nodo.focus({ preventScroll: true });
      if (foco.seleccion && typeof nodo.setSelectionRange === "function") {
        try {
          nodo.setSelectionRange(...foco.seleccion);
        } catch {
          // El campo no admite selección.
        }
      }
    }
  }
}
