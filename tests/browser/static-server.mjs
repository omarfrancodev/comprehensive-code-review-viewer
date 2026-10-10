/**
 * Servidor estático mínimo para las pruebas de navegador.
 *
 * Publica únicamente el directorio de recursos empaquetados, con la misma
 * política de contenido que el servidor real. No toca ningún archivo.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
const WEB = join(aqui, "..", "..", "src", "ccr_viewer", "web");

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const puerto = Number(process.env.CCR_STATIC_PORT ?? 8765);

createServer(async (peticion, respuesta) => {
  const ruta = new URL(peticion.url, "http://127.0.0.1").pathname;
  const relativo = ruta === "/" ? "index.html" : ruta.replace(/^\/assets\//, "");
  const destino = join(WEB, normalize(relativo).replace(/^(\.\.[/\\])+/, ""));
  if (!destino.startsWith(WEB)) {
    respuesta.writeHead(403).end();
    return;
  }
  try {
    const cuerpo = await readFile(destino);
    const extension = destino.slice(destino.lastIndexOf("."));
    respuesta.writeHead(200, {
      "Content-Type": TIPOS[extension] ?? "application/octet-stream",
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    respuesta.end(cuerpo);
  } catch {
    respuesta.writeHead(404, { "Content-Type": "application/json" }).end(
      JSON.stringify({ error: "no encontrado" }),
    );
  }
}).listen(puerto, "127.0.0.1", () => {
  process.stdout.write(`estatico en http://127.0.0.1:${puerto}\n`);
});