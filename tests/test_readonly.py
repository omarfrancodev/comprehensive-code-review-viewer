"""Aceptación de solo lectura: el visor no altera el archivo en ninguna operación."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ccr_viewer.adapters import Catalog
from ccr_viewer.discovery import discover_runs
from ccr_viewer.integrity import validate_archive
from ccr_viewer.live import LiveCollector
from ccr_viewer.references import list_files, read_preview, resolve_reference
from ccr_viewer.snapshots import read_snapshot

from fixtures import advance_fixture, archive_inventory, build_archive

OPERACIONES = ("navegar", "vista_previa", "referencia", "validar", "seguir")


class ReadOnlyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")

    def locations(self):
        return {item.path: item for item in discover_runs(self.root)[0]}

    def test_navegar_no_altera_el_archivo(self) -> None:
        antes = archive_inventory(self.root)
        catalogo = Catalog(self.root)
        catalogo.refresh()
        for item in catalogo.locations():
            catalogo.get_run(item.key)
        self.assertEqual(archive_inventory(self.root), antes)

    def test_vista_previa_no_altera_el_archivo(self) -> None:
        antes = archive_inventory(self.root)
        for location in discover_runs(self.root)[0]:
            for entrada in list_files(location):
                read_preview(location, entrada["key"])
        self.assertEqual(archive_inventory(self.root), antes)

    def test_referencia_no_altera_el_archivo(self) -> None:
        catalogo = Catalog(self.root)
        catalogo.refresh()
        antes = archive_inventory(self.root)
        location = catalogo.locations()[0]
        for bruto in ("notes.json", "evidence/notes.json", "https://ejemplo.invalid/x", "ausente"):
            resolve_reference(bruto, location, catalogo)
        self.assertEqual(archive_inventory(self.root), antes)

    def test_validar_no_altera_el_archivo(self) -> None:
        antes = archive_inventory(self.root)
        for location in discover_runs(self.root)[0]:
            validate_archive(location, read_snapshot(location))
        self.assertEqual(archive_inventory(self.root), antes)

    def test_seguir_no_altera_el_archivo(self) -> None:
        antes = archive_inventory(self.root)
        catalogo = Catalog(self.root)
        catalogo.refresh()
        colector = LiveCollector(catalogo)
        colector.subscribe()
        for _ in range(3):
            colector.poll_once()
        colector.stop()
        self.assertEqual(archive_inventory(self.root), antes)

    def test_no_se_crea_ningun_archivo_nuevo(self) -> None:
        antes = set(archive_inventory(self.root))
        catalogo = Catalog(self.root)
        catalogo.refresh()
        for location in catalogo.locations():
            catalogo.get_run(location.key)
            validate_archive(location, catalogo.snapshot(location.key))
            list_files(location)
        self.assertEqual(set(archive_inventory(self.root)), antes)


class FixtureProducerTests(unittest.TestCase):
    """El productor de prueba escribe; el visor sólo observa."""

    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def test_prepare_to_discovery_publica_processing_con_hito(self) -> None:
        run = build_archive(self.root, "prepared_archive_v5")
        antes = archive_inventory(self.root)
        advance_fixture(run, "prepare_to_discovery")
        self.assertNotEqual(archive_inventory(self.root), antes, "el productor sí escribe")

        catalogo = Catalog(self.root)
        catalogo.refresh()
        vista = catalogo.get_run(catalogo.locations()[0].key)
        self.assertEqual(vista["summary"]["archive_state"], "processing")

    def test_retained_then_closed_cierra_de_verdad(self) -> None:
        run = build_archive(self.root, "prepared_archive_v5")
        advance_fixture(run, "retained_then_closed")
        cierre = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
        self.assertEqual(cierre["state"], "complete")
        self.assertEqual(cierre["cleanup"], "not_needed")

    def test_transient_retention_no_lo_consume_el_visor(self) -> None:
        run = build_archive(self.root, "prepared_archive_v5")
        advance_fixture(run, "transient_retention")
        antes = archive_inventory(self.root)

        catalogo = Catalog(self.root)
        catalogo.refresh()
        for _ in range(3):
            catalogo.refresh()
        colector = LiveCollector(catalogo)
        colector.subscribe()
        colector.poll_once()
        validate_archive(catalogo.locations()[0], catalogo.snapshot(catalogo.locations()[0].key))
        colector.stop()

        # Sólo el productor puede consumirlos; el visor no los toca.
        self.assertEqual(archive_inventory(self.root), antes)
        cierre = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
        self.assertIsNotNone(cierre["pending_trace"])
        self.assertEqual(cierre["planned_hashes"], {"evidence/pendiente.json": "0" * 64})

    def test_el_visor_reporta_updating_mientras_hay_intencion_pendiente(self) -> None:
        run = build_archive(self.root, "prepared_archive_v5")
        advance_fixture(run, "transient_retention")
        location = discover_runs(self.root)[0][0]
        informe = validate_archive(location, read_snapshot(location))
        self.assertEqual(informe["status"], "updating")


if __name__ == "__main__":
    unittest.main()