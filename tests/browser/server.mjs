/**
 * Arranca el servidor Python real sobre un archivo sintético.
 *
 * No se relaja ninguna comprobación de seguridad: el arranque usa el mismo
 * `ccr_viewer` que se instala, con su token de capacidad y su sesión.
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, "..", "..");

/** Crea un archivo sintético aislado y devuelve su ruta. */
export function crearArchivoSintetico(variant) {
  const base = mkdtempSync(join(tmpdir(), "ccr-aceptacion-"));
  const raiz = join(base, "archivo");
  const resultado = spawnSync(
    "python",
    [
      "-c",
      "import sys; from pathlib import Path; "
        + "sys.path.insert(0, 'tests'); "
        + "from fixtures import build_archive; "
        + "print(build_archive(Path(sys.argv[1]), sys.argv[2]))",
      raiz,
      variant,
    ],
    { cwd: RAIZ, encoding: "utf8" },
  );
  if (resultado.status !== 0) {
    throw new Error(`no se pudo crear el archivo: ${resultado.stderr}`);
  }
  return { raiz, base, run: resultado.stdout.trim() };
}

/** Sólo el productor sintético escribe; se usa para verificar SSE e inmutabilidad. */
export function fixtureOperation(run, operation) {
  const result = spawnSync("python", ["-c",
    "import sys,json; from pathlib import Path; sys.path.insert(0,'tests'); "
    + "from fixtures import advance_fixture,archive_inventory; "
    + "run=Path(sys.argv[1]); op=sys.argv[2]; "
    + "advance_fixture(run,op) if op != 'inventory' else None; "
    + "print(json.dumps(archive_inventory(run),sort_keys=True))", run, operation],
    { cwd: RAIZ, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

/**
 * Arranca el servidor y devuelve `{ url, base, raiz, stop }`.
 * La URL incluye el token de capacidad en el fragmento, como en el uso real.
 */
export async function startFixtureServer(variant) {
  const { raiz, base, run } = crearArchivoSintetico(variant);
  const proceso = spawn("python", ["-m", "ccr_viewer", "--root", raiz, "--no-browser"], {
    cwd: RAIZ,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  const url = await new Promise((resolver, rechazar) => {
    let acumulado = "";
    const limite = Date.now() + 60_000;
    const temporizador = setInterval(() => {
      for (const linea of acumulado.split("\n")) {
        if (linea.startsWith("http://127.0.0.1:")) {
          clearInterval(temporizador);
          resolver(linea.trim());
          return;
        }
      }
      if (Date.now() > limite) {
        clearInterval(temporizador);
        rechazar(new Error(`el servidor no arrancó a tiempo: ${acumulado}`));
      }
    }, 100);
    proceso.stdout.setEncoding("utf8");
    proceso.stdout.on("data", (trozo) => {
      acumulado += trozo;
    });
    proceso.on("error", (error) => {
      clearInterval(temporizador);
      rechazar(error);
    });
  });

  return {
    url,
    raiz,
    base,
    run,
    stop() {
      proceso.kill();
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // La limpieza es un detail; no debe hidingar el resultado de la prueba.
      }
    },
  };
}
