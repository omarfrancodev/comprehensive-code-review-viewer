/**
 * Superficie de vistas.
 *
 * Reexporta los módulos de pantalla para que el resto de la aplicación importe
 * un único punto estable en lugar de conocer el mapa de archivos.
 */

export { renderLibrary } from "./library.js";
export { renderProfile } from "./profile.js";
export { renderFindings } from "./findings.js";
export { renderValidation } from "./validation.js";