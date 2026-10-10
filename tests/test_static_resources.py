"""Guarda de regresión: todo archivo bajo ``web/`` está registrado y viceversa."""

from __future__ import annotations

import unittest
from pathlib import Path

from ccr_viewer.server import STATIC_RESOURCES, web_root


class StaticResourcesTests(unittest.TestCase):
    def test_los_archivos_de_web_coinciden_con_los_recursos_registrados(self) -> None:
        raiz = Path(web_root())
        presentes = {
            ruta.relative_to(raiz).as_posix()
            for ruta in raiz.rglob("*")
            if ruta.is_file() and "__pycache__" not in ruta.parts
        }
        self.assertEqual(presentes, set(STATIC_RESOURCES))


if __name__ == "__main__":
    unittest.main()
