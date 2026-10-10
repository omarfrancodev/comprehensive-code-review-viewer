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