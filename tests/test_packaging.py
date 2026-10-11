"""Aceptación de empaquetado: la wheel sirve todo lo necesario sin el repositorio."""

from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request
import zipfile
import venv
from pathlib import Path

from ccr_viewer.server import CONTENT_SECURITY_POLICY, STATIC_RESOURCES
from fixtures import build_archive

RAIZ = Path(__file__).resolve().parent.parent


def construir_wheel(destino: Path) -> Path:
    """Construye la wheel desde una copia limpia de las fuentes.

    ``pip wheel .`` en el árbol reutiliza ``build/`` y escribe ``egg-info`` en el
    repositorio: un ``build/lib`` obsoleto (por ejemplo, con un módulo ya retirado)
    contaminaría la wheel y la prueba no reflejaría lo que publica un checkout limpio.
    """

    with tempfile.TemporaryDirectory() as temporal:
        copia = Path(temporal) / "fuentes"
        copia.mkdir()
        for nombre in ("pyproject.toml", "README.md", "LICENSE"):
            shutil.copy2(RAIZ / nombre, copia / nombre)
        shutil.copytree(
            RAIZ / "src",
            copia / "src",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info"),
        )
        subprocess.run(
            [sys.executable, "-m", "pip", "wheel", ".", "--no-deps",
             "--wheel-dir", str(destino)],
            cwd=copia,
            check=True,
            capture_output=True,
        )
    ruedas = sorted(destino.glob("*.whl"))
    if not ruedas:
        raise AssertionError("no se construyó ninguna wheel")
    return ruedas[0]


def terminar(proceso: subprocess.Popen) -> None:
    """Detiene el servidor y, en Windows, también al proceso hijo del lanzador."""

    if proceso.poll() is None:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(proceso.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
        else:
            proceso.terminate()
    try:
        proceso.wait(timeout=15)
    finally:
        if proceso.stdout is not None:
            proceso.stdout.close()


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
        prefijo = "ccr_viewer/web/"
        empaquetados = {
            nombre[len(prefijo):]
            for nombre in self.nombres
            if nombre.startswith(prefijo) and not nombre.endswith("/")
        }
        for recurso in sorted(STATIC_RESOURCES):
            with self.subTest(recurso=recurso):
                self.assertIn(recurso, empaquetados)
        # Todo archivo de web/ que viaja en la wheel debe estar registrado: un
        # recurso empaquetado pero no listado nunca se serviría.
        self.assertEqual(sorted(empaquetados - set(STATIC_RESOURCES)), [])
        self.assertNotIn("lifecycle.js", empaquetados)

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
    """Instala la wheel en un entorno limpio y arranca el paquete instalado."""

    @classmethod
    def setUpClass(cls) -> None:
        cls._temporal = tempfile.TemporaryDirectory()
        base = Path(cls._temporal.name) / "verificacion"
        base.mkdir()
        cls.archivo = base / "archivo"
        cls.archivo.mkdir()
        build_archive(cls.archivo, "final_v7")
        cls.trabajo = base / "otro-directorio"
        cls.trabajo.mkdir()
        wheel = construir_wheel(base)
        cls.entorno = base / "entorno-limpio"
        venv.EnvBuilder(with_pip=True).create(cls.entorno)
        binarios = cls.entorno / ("Scripts" if os.name == "nt" else "bin")
        cls.interprete = binarios / ("python.exe" if os.name == "nt" else "python")
        cls.entrypoint = binarios / ("ccr-viewer.exe" if os.name == "nt" else "ccr-viewer")
        cls.entorno_limpio = {
            clave: valor
            for clave, valor in os.environ.items()
            if clave not in {"PYTHONPATH", "PYTHONHOME"}
        }
        subprocess.run(
            [str(cls.interprete), "-I", "-m", "pip", "install", "--no-index",
             "--no-deps", str(wheel)],
            check=True, capture_output=True, env=cls.entorno_limpio,
        )

    @classmethod
    def tearDownClass(cls) -> None:
        cls._temporal.cleanup()

    @contextlib.contextmanager
    def servidor(self, comando: list):
        """Arranca ``comando`` fuera del repositorio y entrega origen y cookie."""

        proceso = subprocess.Popen(
            comando,
            cwd=str(self.trabajo),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=self.entorno_limpio,
        )
        try:
            url = proceso.stdout.readline().strip()
            self.assertTrue(url.startswith("http://127.0.0.1:"), url)
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
            yield origen, cookie
        finally:
            terminar(proceso)

    def verificar_sesion_y_api(self, origen: str, cookie: str) -> None:
        def pedir(ruta: str) -> bytes:
            peticion = urllib.request.Request(
                origen + ruta, headers={"Cookie": cookie, "Origin": origen}
            )
            with urllib.request.urlopen(peticion, timeout=15) as respuesta:
                self.assertEqual(respuesta.status, 200)
                return respuesta.read()

        configuracion = json.loads(pedir("/api/config").decode("utf-8"))
        self.assertEqual(configuracion["data"]["root"], str(self.archivo.resolve()))
        biblioteca = json.loads(pedir("/api/runs").decode("utf-8"))
        self.assertEqual(biblioteca["data"]["total"], 1)

    def verificar_recursos(self, origen: str) -> None:
        """Cada recurso de la lista finita se sirve con su tipo y la CSP vigente."""

        # La lista de la wheel instalada coincide con la del código fuente.
        instalada = json.loads(subprocess.check_output(
            [str(self.interprete), "-I", "-c",
             "import json; from ccr_viewer.server import STATIC_RESOURCES; "
             "print(json.dumps(STATIC_RESOURCES))"],
            cwd=self.trabajo, env=self.entorno_limpio, text=True,
        ))
        self.assertEqual(instalada, STATIC_RESOURCES)

        def pedir(ruta: str):
            peticion = urllib.request.Request(origen + ruta)
            try:
                with urllib.request.urlopen(peticion, timeout=15) as respuesta:
                    return respuesta.status, respuesta.headers, respuesta.read()
            except urllib.error.HTTPError as error:
                with error:
                    return error.code, error.headers, error.read()

        for recurso, tipo in STATIC_RESOURCES.items():
            with self.subTest(recurso=recurso):
                estado, cabeceras, cuerpo = pedir("/assets/" + recurso)
                self.assertEqual(estado, 200)
                self.assertEqual(cabeceras.get("Content-Type"), tipo)
                self.assertEqual(
                    cabeceras.get("Content-Security-Policy"), CONTENT_SECURITY_POLICY
                )
                self.assertEqual(cabeceras.get("X-Content-Type-Options"), "nosniff")
                self.assertGreater(len(cuerpo), 0)

        self.assertNotIn("unsafe-inline", CONTENT_SECURITY_POLICY)
        self.assertNotIn("unsafe-eval", CONTENT_SECURITY_POLICY)

        estado, cabeceras, cuerpo = pedir("/")
        self.assertEqual(estado, 200)
        self.assertEqual(cabeceras.get("Content-Security-Policy"), CONTENT_SECURITY_POLICY)
        indice = cuerpo.decode("utf-8")
        self.assertNotIn("unsafe-inline", indice)
        self.assertIsNone(re.search(r"<style", indice, re.IGNORECASE))
        self.assertIsNone(re.search(r"\sstyle\s*=", indice, re.IGNORECASE))
        self.assertIsNone(re.search(r"\son[a-z]+\s*=", indice, re.IGNORECASE))
        etiquetas = re.findall(r"<script\b[^>]*>", indice, re.IGNORECASE)
        self.assertTrue(etiquetas)
        for etiqueta in etiquetas:
            with self.subTest(etiqueta=etiqueta):
                self.assertRegex(etiqueta, r"\ssrc=\"/assets/[^\"]+\"")
        # Ningún script con contenido propio dentro del HTML.
        self.assertIsNone(
            re.search(r"<script\b[^>]*>\s*(?!</script)\S", indice, re.IGNORECASE)
        )
        # Un recurso fuera de la lista finita no se publica.
        estado, _, _ = pedir("/assets/lifecycle.js")
        self.assertEqual(estado, 404)

    def test_arranca_fuera_del_repositorio_sin_importar_la_skill(self) -> None:
        modulo = subprocess.check_output(
            [str(self.interprete), "-I", "-c",
             "import ccr_viewer; print(ccr_viewer.__file__)"],
            cwd=self.trabajo, env=self.entorno_limpio, text=True,
        )
        self.assertTrue(Path(modulo.strip()).resolve().is_relative_to(self.entorno.resolve()))
        comando = [str(self.interprete), "-I", "-m", "ccr_viewer",
                   "--root", str(self.archivo), "--no-browser"]
        with self.servidor(comando) as (origen, cookie):
            self.verificar_sesion_y_api(origen, cookie)
            with urllib.request.urlopen(
                urllib.request.Request(origen + "/assets/app.js"), timeout=15
            ) as respuesta:
                self.assertEqual(respuesta.status, 200)

    def test_la_wheel_instalada_sirve_todos_los_recursos(self) -> None:
        comando = [str(self.interprete), "-I", "-m", "ccr_viewer",
                   "--root", str(self.archivo), "--no-browser"]
        with self.servidor(comando) as (origen, _):
            self.verificar_recursos(origen)

    def test_el_entrypoint_instalado_sirve_todos_los_recursos(self) -> None:
        self.assertTrue(self.entrypoint.is_file(), str(self.entrypoint))
        comando = [str(self.entrypoint), "--root", str(self.archivo), "--no-browser"]
        with self.servidor(comando) as (origen, cookie):
            self.verificar_sesion_y_api(origen, cookie)
            self.verificar_recursos(origen)


if __name__ == "__main__":
    unittest.main()
