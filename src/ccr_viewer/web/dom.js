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
 * Lleva `nodo` a la vista una vez terminado el redibujo (la aplicación
 * restaura el desplazamiento al final del suyo) y, opcionalmente, le da el foco.
 */
export function traerAVista(nodo, { enfocar = false } = {}) {
  queueMicrotask(() => {
    if (typeof nodo.scrollIntoView === "function") nodo.scrollIntoView({ block: "nearest" });
    if (enfocar && typeof nodo.focus === "function") nodo.focus({ preventScroll: true });
  });
}
