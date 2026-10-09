/** Punto de entrada de la aplicación: sesión, biblioteca y detalle de revisión. */

import { bootstrapSession, getConfig, getRuns } from "./api.js";

const bibliotecaEstado = document.getElementById("biblioteca-estado");
const raizTexto = document.getElementById("raiz");
const revision = document.getElementById("revision");

function texto(elemento, valor) {
  elemento.textContent = valor ?? "";
  return elemento;
}

function mostrarError(mensaje) {
  bibliotecaEstado.classList.add("estado--error");
  texto(bibliotecaEstado, mensaje);
}

async function cargarConfig() {
  const config = await getConfig();
  texto(raizTexto, `Raíz del archivo (${config.selected_by}): ${config.root}`);
  return config;
}

async function cargarBiblioteca() {
  try {
    const page = await getRuns({}, 0);
    if (page.total === 0) {
      texto(bibliotecaEstado, "No hay revisiones archivadas en esta raíz.");
      return;
    }
    bibliotecaEstado.replaceChildren();
    const lista = document.createElement("ul");
    lista.className = "lista-revisiones";
    for (const item of page.items) {
      const entrada = document.createElement("li");
      const boton = document.createElement("button");
      boton.type = "button";
      boton.textContent = `${item.scope_label ?? "sin alcance"} — ${
        item.verdict ?? "sin veredicto"
      }`;
      boton.dataset.key = item.key;
      boton.addEventListener("click", () => seleccionar(item));
      entrada.append(boton);
      lista.append(entrada);
    }
    bibliotecaEstado.append(lista);
  } catch (error) {
    mostrarError(`No se pudo cargar la biblioteca: ${error.message}`);
  }
}

async function seleccionar(item) {
  const encabezado = document.createElement("h2");
  encabezado.textContent = item.scope_label ?? item.key;
  const detalle = document.createElement("p");
  detalle.className = "estado";
  detalle.textContent = `Veredicto de la fuente: ${item.verdict ?? "no disponible"}`;
  revision.replaceChildren(encabezado, detalle);
}

async function iniciar() {
  try {
    await bootstrapSession(location.hash);
  } catch (error) {
    mostrarError(error.message);
    return;
  }
  await cargarConfig();
  await cargarBiblioteca();
}

iniciar();