/**
 * Documentos: inventario seleccionable y vista previa local (maestro-detalle).
 *
 * Nada se ejecuta: un archivo de código se muestra como texto inerte y el
 * Markdown pasa por el sanitizador de `markdown.js`. Tres situaciones tienen
 * mensajes propios: informe ausente, inventario vacío y lectura fallida; un
 * fallo de la vista previa conserva el inventario y la selección.
 */

import { getFiles, getPreview } from "./api.js";
import { elemento, seccion, textoDe } from "./dom.js";
import { renderMarkdown } from "./markdown.js";

function esObjeto(valor) {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor);
}

function esMarkdown(archivo) {
  return archivo.media_kind === "markdown" || String(archivo.relative_path ?? "").toLowerCase().endsWith(".md");
}

const rutaDe = (archivo) => textoDe(archivo.relative_path) ?? textoDe(archivo.name) ?? "Sin ruta";

/**
 * Dibuja el inventario de la corrida con la vista previa del informe (o del
 * archivo elegido). `api` es inyectable para las pruebas; `contexto.memoria`
 * conserva el archivo elegido entre recargas en vivo de la misma revisión.
 */
export async function renderDocuments(contenedor, view, api = { getFiles, getPreview }, contexto = {}) {
  contenedor.replaceChildren();
  const runKey = view?.summary?.key;
  if (!runKey) {
    contenedor.append(
      seccion("Documentos", [
        elemento("p", { clase: "estado", texto: "Selecciona una revisión para ver sus documentos." }),
      ]),
    );
    return;
  }

  const raiz = elemento("div", { clase: "documentos" });
  contenedor.append(raiz);
  const recuerdo = contexto?.memoria ? (contexto.memoria.documentos ??= {}) : {};
  // Cada carga y cada vista previa descartan a las anteriores en vuelo.
  let cargas = 0;
  // Un enlace local del Markdown selecciona ese archivo del inventario.
  let abrirLocal = () => {};
  raiz.addEventListener("open-local-document", (event) => abrirLocal(event.detail?.fileKey));

  async function cargarInventario() {
    const actual = ++cargas;
    raiz.replaceChildren(elemento("p", { clase: "estado", texto: "Cargando el inventario…" }));
    let archivos;
    try {
      const respuesta = await api.getFiles(runKey);
      if (!Array.isArray(respuesta)) throw new Error("la respuesta del inventario no es una lista");
      archivos = respuesta.filter(esObjeto);
    } catch (error) {
      if (actual !== cargas) return;
      const reintentar = elemento("button", { texto: "Reintentar", atributos: { type: "button" } });
      reintentar.addEventListener("click", () => cargarInventario());
      raiz.replaceChildren(
        seccion("Documentos", [
          elemento("p", { clase: "estado estado--error", texto: `No se pudo leer el inventario: ${error.message}` }),
          reintentar,
        ]),
      );
      return;
    }
    if (actual !== cargas) return;
    await mostrarInventario(archivos);
  }

  async function mostrarInventario(archivos) {
    if (archivos.length === 0) {
      raiz.replaceChildren(
        seccion("Documentos", [
          elemento("p", { clase: "estado", texto: "El inventario está vacío: la corrida no conserva documentos." }),
        ]),
      );
      return;
    }

    let solicitud = 0;
    let seleccionado = null;
    const filas = [];
    const lista = elemento("ul", { clase: "lista-archivos", atributos: { "aria-label": "Archivos de la corrida" } });
    const detalle = elemento("div", { clase: "detalle" });

    function marcar() {
      for (const { archivo, boton } of filas) boton.setAttribute("aria-pressed", String(archivo === seleccionado));
    }

    function vistaPrevia(archivo, vista) {
      const caja = elemento("section", {
        clase: "vista-previa",
        atributos: { "data-vista-previa": "true", "aria-label": "Vista previa del archivo" },
      });
      const formato = textoDe(vista?.media_kind) ?? textoDe(archivo.media_kind) ?? "formato no declarado";
      const total = vista?.total_bytes ?? archivo.bytes;
      caja.append(
        elemento("h3", { clase: "vista-previa-ruta", texto: rutaDe(archivo) }),
        elemento("p", {
          clase: "nota",
          texto: `Formato: ${formato}${total !== undefined && total !== null ? ` · ${total} bytes` : ""}`,
        }),
      );
      if (vista?.truncated) {
        caja.append(
          elemento("p", {
            clase: "estado estado--aviso",
            texto: `Vista previa truncada: el archivo completo tiene ${total} bytes y se conserva en el origen.`,
          }),
        );
      }
      const texto = typeof vista?.text === "string" ? vista.text : "";
      if (esMarkdown(archivo)) {
        const articulo = elemento("article", { clase: "documento-texto" });
        renderMarkdown(texto, articulo, (destino) => resolverLocal(archivos, destino));
        caja.append(articulo);
      } else {
        caja.append(elemento("pre", { clase: "codigo", texto }));
      }
      return caja;
    }

    function fallo(archivo, error) {
      const reintentar = elemento("button", { texto: "Reintentar", atributos: { type: "button" } });
      reintentar.addEventListener("click", () => seleccionar(archivo));
      const caja = elemento("section", {
        clase: "vista-previa",
        atributos: { "data-vista-previa": "true", "aria-label": "Vista previa del archivo" },
      });
      caja.append(
        elemento("h3", { clase: "vista-previa-ruta", texto: rutaDe(archivo) }),
        elemento("p", { clase: "estado estado--error", texto: `No se pudo leer: ${error.message}` }),
        reintentar,
      );
      return caja;
    }

    async function seleccionar(archivo) {
      seleccionado = archivo;
      recuerdo.clave = archivo.key;
      const actual = ++solicitud;
      marcar();
      detalle.replaceChildren(elemento("p", { clase: "estado", texto: "Cargando la vista previa…" }));
      try {
        const vista = await api.getPreview(runKey, archivo.key);
        if (actual !== solicitud) return;
        detalle.replaceChildren(vistaPrevia(archivo, vista));
      } catch (error) {
        if (actual !== solicitud) return;
        detalle.replaceChildren(fallo(archivo, error));
      }
    }

    for (const archivo of archivos) {
      const boton = elemento("button", {
        clase: "fila-archivo",
        atributos: { type: "button", "aria-pressed": "false", "data-file-key": textoDe(archivo.key) },
      });
      const meta = elemento("span", { clase: "fila-meta" });
      meta.append(
        elemento("span", { texto: textoDe(archivo.media_kind) ?? "formato no declarado" }),
        elemento("span", { texto: archivo.bytes === undefined || archivo.bytes === null ? "tamaño no declarado" : `${archivo.bytes} bytes` }),
      );
      boton.append(elemento("span", { clase: "fila-ruta", texto: rutaDe(archivo) }), meta);
      boton.addEventListener("click", () => seleccionar(archivo));
      filas.push({ archivo, boton });
      const item = elemento("li");
      item.append(boton);
      lista.append(item);
    }

    abrirLocal = (clave) => {
      const entrada = archivos.find((archivo) => archivo.key === clave);
      if (entrada) void seleccionar(entrada);
    };

    const maestro = elemento("div", { clase: "maestro" });
    maestro.append(
      elemento("p", { clase: "conteo-filtro", texto: `${archivos.length} archivo(s) en el inventario` }),
      lista,
    );
    const rejilla = elemento("div", { clase: "maestro-detalle" });
    rejilla.append(maestro, detalle);
    raiz.replaceChildren(elemento("h2", { texto: "Documentos" }), rejilla);

    // Se restaura el archivo elegido; si no, el informe. Sin informe se declara
    // y el resto del inventario sigue a mano.
    const informe = archivos.find((archivo) => archivo.name === "informe.md") ?? archivos.find(esMarkdown);
    const inicial = archivos.find((archivo) => recuerdo.clave !== undefined && archivo.key === recuerdo.clave) ?? informe;
    if (inicial) {
      await seleccionar(inicial);
    } else {
      detalle.append(
        elemento("p", {
          clase: "estado",
          texto: "Esta corrida no conserva un informe Markdown; elige un archivo del inventario para ver su vista previa.",
        }),
      );
    }
  }

  await cargarInventario();
}

function resolverLocal(archivos, destino) {
  const limpio = String(destino ?? "").split("#")[0];
  const directo = archivos.find((archivo) => archivo.relative_path === limpio);
  if (directo) return { fileKey: directo.key, runKey: null };
  const porNombre = archivos.filter((archivo) => archivo.name === limpio);
  if (porNombre.length === 1) return { fileKey: porNombre[0].key, runKey: null };
  if (porNombre.length > 1) {
    // Nunca se elige un destino ambiguo en silencio.
    return { fileKey: null, reason: "varios archivos comparten ese nombre" };
  }
  return { fileKey: null, reason: "la referencia no existe en esta corrida" };
}
