"""Aceptación de empaquetado: la wheel sirve todo lo necesario sin el repositorio."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile
import venv
from pathlib import Path

from fixtures import build_archive

RAIZ = Path(__file__).resolve().parent.parent


def construir_wheel(destino: Path) -> Path:
    """Construye la wheel del paquete en ``destino``."""

    subprocess.run(
        [sys.executable, "-m", "pip", "wheel", ".", "--no-deps", "--wheel-dir", str(destino)],
        cwd=RAIZ,
        check=True,
        capture_output=True,
    )
    ruedas = sorted(destino.glob("*.whl"))
    if not ruedas:
        raise AssertionError("no se construyó ninguna wheel")
    return ruedas[0]


class WheelContentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._temporal = tempfile.TemporaryDirectory()
        cls.destino = Path(cls._temporal.name)
        cls.rueda = construir_wheel(cls.destino)
        cls.nombres = set(zipfile.ZipFile(cls.rueda).namelist())

    @classmethod
    def tearDownClass(cls) -> None:
        cls._temporal.cleanup()

    def test_incluye_todos_los_modulos_de_python(self) -> None:
        for modulo in (
            "__init__", "__main__", "cli", "paths", "discovery", "snapshots",
            "adapters", "references", "integrity", "trace", "live", "server",
        ):
            with self.subTest(modulo=modulo):
                self.assertIn(f"ccr_viewer/{modulo}.py", self.nombres)

    def test_incluye_los_recursos_estaticos(self) -> None:
        for recurso in ("index.html", "styles.css", "app.js", "api.js", "store.js",
                        "library.js", "profile.js", "findings.js", "validation.js",
                        "documents.js", "markdown.js", "lifecycle.js", "playback.js"):
            with self.subTest(recurso=recurso):
                self.assertIn(f"ccr_viewer/web/{recurso}", self.nombres)

    def test_incluye_los_recursos_de_browser_con_su_inventario(self) -> None:
        for recurso in ("vendor/marked.esm.js", "vendor/purify.es.mjs",
                        "vendor/manifest.json"):
            with self.subTest(recurso=recurso):
                self.assertIn(f"ccr_viewer/web/{recurso}", self.nombres)

    def test_incluye_las_licencias_de_terceros(self) -> None:
        self.assertIn("ccr_viewer/web/vendor/LICENSE.marked.txt", self.nombres)
        self.assertIn("ccr_viewer/web/vendor/LICENSE.dompurify.txt", self.nombres)

    def test_incluye_los_contratos_de_compatibilidad(self) -> None:
        self.assertIn("ccr_viewer/contracts/compatibility.json", self.nombres)

    def test_excluye_pruebas_y_arboles_de_desarrollo(self) -> None:
        prohibido = ("tests/", "node_modules/", ".worktrees/", "playwright-report/",
                     "test-results/", ".superpowers/", "dist/")
        for nombre in self.nombres:
            for fragmento in prohibido:
                with self.subTest(nombre=nombre):
                    self.assertFalse(nombre.startswith(fragmento))

    def test_el_inventario_de_vendor_coincide_con_los_bytes_incluidos(self) -> None:
        import hashlib

        with zipfile.ZipFile(self.rueda) as archivo:
            inventario = json.loads(
                archivo.read("ccr_viewer/web/vendor/manifest.json").decode("utf-8")
            )
            for recurso in inventario["recursos"]:
                with self.subTest(recurso=recurso["archivo"]):
                    datos = archivo.read(f"ccr_viewer/web/vendor/{recurso['archivo']}")
                    self.assertEqual(hashlib.sha256(datos).hexdigest(), recurso["sha256"])
                    self.assertEqual(len(datos), recurso["bytes"])

    def test_el_paquete_no_declara_dependencias_de_ejecucion(self) -> None:
        with zipfile.ZipFile(self.rueda) as archivo:
            metadatos = archivo.read(
                "comprehensive_code_review_viewer-0.1.0.dist-info/METADATA"
            ).decode("utf-8")
        self.assertIn("Requires-Python: >=3.10", metadatos)
        self.assertNotIn("Requires-Dist:", metadatos)


class InstalledRunTests(unittest.TestCase):
    """Arranca el paquete instalado fuera del repositorio y comprueba la sesión."""

    def test_arranca_fuera_del_repositorio_sin_importar_la_skill(self) -> None:
        with tempfile.TemporaryDirectory() as temporal:
            base = Path(temporal) / "verificacion"
            base.mkdir()
            archivo = base / "archivo"
            archivo.mkdir()
            build_archive(archivo, "final_v7")
            trabajo = base / "otro-directorio"
            trabajo.mkdir()
            wheel = construir_wheel(base)
            environment = base / "entorno-limpio"
            venv.EnvBuilder(with_pip=True).create(environment)
            interpreter = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            clean_env = {key: value for key, value in os.environ.items() if key not in {"PYTHONPATH", "PYTHONHOME"}}
            subprocess.run([str(interpreter), "-I", "-m", "pip", "install", "--no-index", "--no-deps", str(wheel)], check=True, capture_output=True, env=clean_env)
            module = subprocess.check_output([str(interpreter), "-I", "-c", "import ccr_viewer; print(ccr_viewer.__file__)"], cwd=trabajo, env=clean_env, text=True)
            self.assertTrue(Path(module.strip()).resolve().is_relative_to(environment.resolve()))

            proceso = subprocess.Popen(
                [str(interpreter), "-I", "-m", "ccr_viewer", "--root", str(archivo), "--no-browser"],
                cwd=str(trabajo),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=clean_env,
            )
            try:
                url = proceso.stdout.readline().strip()
                self.assertTrue(url.startswith("http://127.0.0.1:"))
                origen, _, fragmento = url.partition("#")
                origen = origen.rstrip("/")
                token = fragmento.split("=", 1)[1]

                peticion = urllib.request.Request(
                    origen + "/api/session",
                    data=json.dumps({"token": token}).encode("utf-8"),
                    method="POST",
                    headers={"Content-Type": "application/json", "Origin": origen},
                )
                with urllib.request.urlopen(peticion, timeout=15) as respuesta:
                    self.assertEqual(respuesta.status, 200)
                    cookie = respuesta.headers.get("Set-Cookie").split(";")[0]

                def pedir(ruta: str) -> bytes:
                    peticion = urllib.request.Request(
                        origen + ruta, headers={"Cookie": cookie, "Origin": origen}
                    )
                    with urllib.request.urlopen(peticion, timeout=15) as respuesta:
                        self.assertEqual(respuesta.status, 200)
                        return respuesta.read()

                configuracion = json.loads(pedir("/api/config").decode("utf-8"))
                self.assertEqual(configuracion["data"]["root"], str(archivo.resolve()))
                biblioteca = json.loads(pedir("/api/runs").decode("utf-8"))
                self.assertEqual(biblioteca["data"]["total"], 1)

                with urllib.request.urlopen(
                    urllib.request.Request(origen + "/assets/app.js"), timeout=15
                ) as respuesta:
                    self.assertEqual(respuesta.status, 200)
            finally:
                proceso.terminate()
                proceso.wait(timeout=15)
                proceso.stdout.close()


if __name__ == "__main__":
    unittest.main()
