/**
 * Stub mínimo de DOM para las pruebas unitarias de las vistas.
 *
 * Cubre exactamente lo que las vistas usan: crear elementos, texto, atributos,
 * clases y árbol. Las pruebas de navegador (Playwright) ejercitan el DOM real.
 */

function crearNodo(tag) {
  const nodo = {
    tagName: String(tag).toUpperCase(),
    children: [],
    atributos: {},
    className: "",
    _textContent: "",
    formData: new Map(),
    oyentes: {},
    // Igual que en el DOM real: el texto propio más el de los descendientes.
    get textContent() {
      return this._textContent + this.children.map((hijo) => hijo.textContent).join("");
    },
    set textContent(valor) {
      this.children = [];
      this._textContent = valor === null || valor === undefined ? "" : String(valor);
    },
    replaceChildren(...hijos) {
      this.children = hijos.filter(Boolean);
      this._textContent = "";
    },
    append(...hijos) {
      for (const hijo of hijos) if (hijo) this.children.push(hijo);
    },
    setAttribute(nombre, valor) {
      this.atributos[nombre] = String(valor);
    },
    getAttribute(nombre) {
      return Object.hasOwn(this.atributos, nombre) ? this.atributos[nombre] : null;
    },
    addEventListener(tipo, funcion) {
      (this.oyentes[tipo] ??= []).push(funion);
    },
    dispatch(tipo, evento = {}) {
      for (const funcion of this.oyentes[tipo] ?? []) funcion(evento);
    },
    classList: {
      add(clase) {
        const actuales = new Set(nodo.className.split(/\s+/).filter(Boolean));
        actuales.add(clase);
        nodo.className = [...actuales].join(" ");
      },
      remove(clase) {
        const actuales = new Set(nodo.className.split(/\s+/).filter(Boolean));
        actuales.delete(clase);
        nodo.className = [...actuales].join(" ");
      },
    },
    descendientes() {
      return this.children.flatMap((hijo) => [hijo, ...hijo.descendientes()]);
    },
    textoCompleto() {
      return this.textContent;
    },
    /** Devuelve los nodos cuyo texto exacto coincide con el esperado. */
    conTexto(valor) {
      return this.descendientes().filter((n) => n.textContent === valor);
    },
  };
  Object.defineProperty(nodo.classList, "contains", {
    value: (clase) => nodo.className.split(/\s+/).includes(clase),
  });
  return nodo;
}

/** Instala el stub como `document` global y devuelve el nodo raíz creado. */
export function instalarDom() {
  globalThis.document = {
    createElement: crearNodo,
  };
  return crearNodo("div");
}

export { crearNodo };