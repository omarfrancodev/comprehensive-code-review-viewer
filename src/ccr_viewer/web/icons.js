/**
 * Iconos SVG construidos con DOM.
 *
 * No hay archivos de imagen ni marcado como cadena: cada icono se crea con
 * `createElementNS` a partir de trazos fijos de este módulo. Son decorativos
 * (`aria-hidden`): el nombre accesible lo da siempre el texto del control.
 */

const SVG = "http://www.w3.org/2000/svg";

/** Trazos de 24 × 24 con línea de 2 px (estilo contorno). */
const TRAZOS = {
  biblioteca: ["M4 5h16", "M4 12h16", "M4 19h16"],
  carpeta: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  ajustes: ["M4 6h16", "M4 12h16", "M4 18h16", "M9 4v4", "M15 10v4", "M7 16v4"],
  cerrar: ["M6 6l12 12", "M18 6L6 18"],
  volver: ["M15 6l-6 6 6 6"],
};

/** Crea el icono `nombre` (`biblioteca`, `carpeta`, `ajustes`, `cerrar`, `volver`, `punto`). */
export function icono(nombre, doc = document) {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icono icono--${nombre}`);
  if (nombre === "punto") {
    // Indicador de estado: el color lo decide la hoja de estilos.
    const circulo = doc.createElementNS(SVG, "circle");
    circulo.setAttribute("cx", "12");
    circulo.setAttribute("cy", "12");
    circulo.setAttribute("r", "5");
    svg.append(circulo);
    return svg;
  }
  for (const d of TRAZOS[nombre] ?? []) {
    const trazo = doc.createElementNS(SVG, "path");
    trazo.setAttribute("d", d);
    svg.append(trazo);
  }
  return svg;
}
