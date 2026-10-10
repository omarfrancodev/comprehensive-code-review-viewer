/** Vista de documentos: informe Markdown y archivos de texto acotados. */

import { getFiles, getPreview } from "./api.js";
import { elemento, seccion } from "./dom.js";
import { renderMarkdown } from "./markdown.js";

/**
 * Dibuja la lista de documentos de la corrida y el informe Markdown.
 * Nada se ejecuta: un archivo de código se muestra como texto inerte.
 */
export async function renderDocuments(contenedor, view, api = { getFiles, getPreview }) {
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

  let archivos = [];
  try {
    archivos = await api.getFiles(runKey);
  } catch (error) {
    contenedor.append(
      seccion("Documentos", [
        elemento("p", { clase: "estado estado--error", texto: `No se pudo leer el inventario: ${error.message}` }),
      ]),
    );
    return;
  }

  const informe = archivos.find((archivo) => archivo.name === "informe.md");
  const markdown = archivos.find((archivo) => archivo.relative_path.endsWith(".md"));

  const panel = elemento("div", { clase: "documentos" });
  panel.addEventListener("open-local-document", event => {
    const entry = archivos.find(file => file.key === event.detail.fileKey);
    if (entry) void mostrarVistaPrevia(panel, entry, event.detail.runKey ?? runKey, api);
  });

  if (informe || markdown) {
    const destino = informe ?? markdown;
    const texto = await cargarTexto(api, runKey, destino);
    const cuerpo = elemento("article", { clase: "documento-texto" });
    panel.append(
      seccion(`Informe · ${destino.name}`, [cuerpo], "seccion seccion--informe"),
    );
    if (texto === null) {
      cuerpo.append(elemento("p", { clase: "estado estado--error", texto: "No se pudo leer el informe." }));
    } else {
      renderMarkdown(texto, cuerpo, (destino) => resolverLocal(archivos, destino));
    }
  } else {
    panel.append(
      seccion("Informe", [
        elemento("p", {
          clase: "estado",
          texto: "Esta corrida aún no conserva un informe Markdown.",
        }),
      ]),
    );
  }

  const otros = archivos.filter((archivo) => archivo.name !== (informe ?? markdown)?.name);
  panel.append(listaArchivos(otros, runKey, api));
  contenedor.append(panel);
}

async function cargarTexto(api, runKey, archivo) {
  try {
    const vista = await api.getPreview(runKey, archivo.key);
    return vista.text + (vista.truncated ? "\n\nVista previa truncada; el archivo completo se conserva en el origen." : "");
  } catch {
    return null;
  }
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

function listaArchivos(archivos, runKey, api) {
  if (archivos.length === 0) {
    return seccion("Archivos", [
      elemento("p", { clase: "estado", texto: "No hay más archivos en esta corrida." }),
    ]);
  }
  const lista = elemento("ul", { clase: "lista-archivos" });
  for (const archivo of archivos) {
    const item = elemento("li");
    const boton = elemento("button", {
      clase: "archivo",
      atributos: { type: "button", "data-file-key": archivo.key },
      texto: `${archivo.relative_path} · ${archivo.bytes} bytes · ${archivo.media_kind}`,
    });
    boton.addEventListener("click", () => mostrarVistaPrevia(item, archivo, runKey, api));
    item.append(boton);
    lista.append(item);
  }
  return seccion("Archivos", [lista]);
}

async function mostrarVistaPrevia(contenedor, archivo, runKey, api) {
  const anterior = contenedor.querySelector(".vista-previa");
  if (anterior) anterior.remove();
  const caja = elemento("div", { clase: "vista-previa" });
  try {
    const vista = await api.getPreview(runKey, archivo.key);
    caja.append(
      elemento("p", {
        clase: "nota",
        texto: vista.truncated
          ? `Vista previa truncada: ${vista.total_bytes} bytes en total.`
          : `Archivo completo: ${vista.total_bytes} bytes.`,
      }),
    );
    if (archivo.relative_path.endsWith(".md")) {
      const markdown = elemento("article", { clase: "documento-texto" });
      renderMarkdown(vista.text, markdown);
      caja.append(markdown);
    } else caja.append(elemento("pre", { clase: "codigo", texto: vista.text }));
  } catch (error) {
    caja.append(elemento("p", { clase: "estado estado--error", texto: `No se pudo leer: ${error.message}` }));
  }
  contenedor.append(caja);
}
