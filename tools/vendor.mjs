/**
 * Copia los recursos de navegador fijados desde las dependencias bloqueadas.
 *
 * Es una acción explícita de mantenimiento, no un paso del arranque: copia
 * únicamente archivos y licencias de versiones exactas del lockfile y registra
 * su SHA-256, origen y versión en un inventario reproducible.
 */

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, "..");
const DESTINO = join(RAIZ, "src", "ccr_viewer", "web", "vendor");

const RECURSOS = [
  {
    paquete: "marked",
    origen: ["lib/marked.esm.js"],
    destino: "marked.esm.js",
  },
  {
    paquete: "dompurify",
    origen: ["dist/purify.es.mjs"],
    destino: "purify.es.mjs",
  },
];

const LICENCIAS = [
  { paquete: "marked", archivo: "LICENSE", destino: "LICENSE.marked.txt" },
  { paquete: "dompurify", archivo: "LICENSE", destino: "LICENSE.dompurify.txt" },
];

const sha256 = (datos) => createHash("sha256").update(datos).digest("hex");

async function versionDe(nombre) {
  const archivo = join(RAIZ, "node_modules", nombre, "package.json");
  return JSON.parse(await readFile(archivo, "utf8")).version;
}

async function main() {
  await mkdir(DESTINO, { recursive: true });
  const inventario = { generado_por: "tools/vendor.mjs", recursos: [], licencias: [] };

  for (const recurso of RECURSOS) {
    const version = await versionDe(recurso.paquete);
    const origen = join(RAIZ, "node_modules", recurso.paquete, recurso.origen[0]);
    const destino = join(DESTINO, recurso.destino);
    const datos = await readFile(origen);
    await copyFile(origen, destino);
    inventario.recursos.push({
      paquete: recurso.paquete,
      version,
      archivo: recurso.destino,
      origen: `node_modules/${recurso.paquete}/${recurso.origen[0]}`,
      sha256: sha256(datos),
      bytes: datos.length,
    });
  }

  for (const licencia of LICENCIAS) {
    const version = await versionDe(licencia.paquete);
    const origen = join(RAIZ, "node_modules", licencia.paquete, licencia.archivo);
    const destino = join(DESTINO, licencia.destino);
    const datos = await readFile(origen);
    await copyFile(origen, destino);
    inventario.licencias.push({
      paquete: licencia.paquete,
      version,
      archivo: licencia.destino,
      origen: `node_modules/${licencia.paquete}/${licencia.archivo}`,
      sha256: sha256(datos),
    });
  }

  await writeFile(join(DESTINO, "manifest.json"), `${JSON.stringify(inventario, null, 2)}\n`, "utf8");
  process.stdout.write(`vendor: ${inventario.recursos.length} recursos y ${inventario.licencias.length} licencias\n`);
}

await main();