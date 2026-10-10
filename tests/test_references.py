"""Pruebas del resolutor de referencias, del inventario y de las vistas previas."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ccr_viewer.adapters import Catalog
from ccr_viewer.discovery import RunLocation, run_key
from ccr_viewer.references import list_files, read_preview, resolve_reference

from fixtures import archive_inventory, build_archive, with_overrides


def location_for(run: Path, root: Path) -> RunLocation:
    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


class ListFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")
        self.location = location_for(self.run, self.root)

    def test_lists_regular_files_with_opaque_keys(self) -> None:
        entries = list_files(self.location)
        names = {entry["relative_path"] for entry in entries}
        self.assertIn("cierre.json", names)
        self.assertIn("evidence/notes.json", names)
        for entry in entries:
            self.assertEqual(len(entry["key"]), 32)
            self.assertNotIn("/", entry["key"])

    def test_file_keys_are_stable_and_unique(self) -> None:
        first = list_files(self.location)
        second = list_files(self.location)
        self.assertEqual(first, second)
        keys = [entry["key"] for entry in first]
        self.assertEqual(len(keys), len(set(keys)))

    def test_media_kind_is_derived_from_the_name(self) -> None:
        kinds = {entry["relative_path"]: entry["media_kind"] for entry in list_files(self.location)}
        self.assertEqual(kinds["informe.md"], "markdown")
        self.assertEqual(kinds["cierre.json"], "json")
        self.assertEqual(kinds["trazabilidad.jsonl"], "jsonl")

    def test_listing_does_not_modify_the_archive(self) -> None:
        before = archive_inventory(self.root)
        list_files(self.location)
        self.assertEqual(archive_inventory(self.root), before)


class ReadPreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")
        self.location = location_for(self.run, self.root)

    def key_for(self, relative: str) -> str:
        for entry in list_files(self.location):
            if entry["relative_path"] == relative:
                return entry["key"]
        raise AssertionError("archivo no listado: " + relative)

    def test_preview_returns_a_text_envelope(self) -> None:
        preview = read_preview(self.location, self.key_for("evidence/notes.json"))
        self.assertEqual(preview["media_kind"], "json")
        self.assertFalse(preview["truncated"])
        self.assertIn("sintetico", preview["text"])
        self.assertGreater(preview["total_bytes"], 0)

    def test_preview_truncates_at_two_mebibytes(self) -> None:
        (self.run / "evidence" / "grande.txt").write_bytes(b"a" * (3 * 1024 * 1024))
        preview = read_preview(self.location, self.key_for("evidence/grande.txt"))
        self.assertTrue(preview["truncated"])
        self.assertEqual(len(preview["text"].encode("utf-8")), 2 * 1024 * 1024)
        self.assertEqual(preview["total_bytes"], 3 * 1024 * 1024)

    def test_code_is_returned_as_inert_text(self) -> None:
        script = self.run / "evidence" / "repro.py"
        script.write_bytes(b"print('hola')\n")
        preview = read_preview(self.location, self.key_for("evidence/repro.py"))
        self.assertEqual(preview["media_kind"], "code")
        self.assertEqual(preview["text"], "print('hola')\n")
        self.assertNotIn("executable", preview)

    def test_unknown_file_key_is_rejected(self) -> None:
        with self.assertRaises(KeyError):
            read_preview(self.location, "0" * 32)

    def test_preview_does_not_modify_the_archive(self) -> None:
        before = archive_inventory(self.root)
        read_preview(self.location, self.key_for("evidence/notes.json"))
        self.assertEqual(archive_inventory(self.root), before)


class ResolveReferenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")
        self.location = location_for(self.run, self.root)
        self.catalog = Catalog(self.root)
        self.catalog.refresh()

    def resolve(self, raw: str) -> dict:
        return resolve_reference(raw, self.location, self.catalog)

    def test_run_root_file_wins_over_evidence_basename(self) -> None:
        (self.run / "evidence" / "notas.json").write_bytes(b'{"sintetico": true}')
        (self.run / "notas.json").write_bytes(b'{"sintetico": false}')
        result = self.resolve("notas.json")
        self.assertEqual(result["status"], "resolved")
        entry = next(
            item for item in list_files(self.location)
            if item["key"] == result["file_key"]
        )
        self.assertEqual(entry["relative_path"], "notas.json")

    def test_unique_evidence_basename_resolves(self) -> None:
        result = self.resolve("notes.json")
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["run_key"], self.location.key)
        self.assertIsNotNone(result["file_key"])

    def test_two_evidence_matches_are_ambiguous_without_a_file_key(self) -> None:
        (self.run / "evidence" / "otro" / "notes.json").parent.mkdir(parents=True)
        (self.run / "evidence" / "otro" / "notes.json").write_bytes(b'{"sintetico": true}')
        result = self.resolve("notes.json")
        self.assertEqual(result["status"], "ambiguous")
        self.assertIsNone(result["file_key"])
        self.assertEqual(len(result["candidates"]), 2)

    def test_fragment_is_preserved(self) -> None:
        result = self.resolve("notes.json#seccion-2")
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["fragment"], "seccion-2")

    def test_absolute_path_is_outside_root(self) -> None:
        result = self.resolve(str(self.run / "evidence" / "notes.json"))
        self.assertEqual(result["status"], "outside_root")
        self.assertIsNone(result["file_key"])

    def test_former_worktree_path_is_outside_root(self) -> None:
        result = self.resolve("C:/Users/demo/proyecto/.worktrees/code-review-1/notes.json")
        self.assertEqual(result["status"], "outside_root")

    def test_parent_traversal_is_outside_root(self) -> None:
        self.assertEqual(self.resolve("../otra/notes.json")["status"], "outside_root")

    def test_remote_link_is_external_and_never_fetched(self) -> None:
        result = self.resolve("https://example.invalid/revision/notas.json#L10")
        self.assertEqual(result["status"], "external")
        self.assertEqual(result["fragment"], "L10")
        self.assertIsNone(result["file_key"])

    def test_missing_reference_is_missing_not_guessed(self) -> None:
        result = self.resolve("evidence/ausente.json")
        self.assertEqual(result["status"], "missing")
        self.assertIsNone(result["file_key"])

    def test_raw_value_is_always_preserved(self) -> None:
        for raw in ("notes.json", "https://example.invalid/x", "../fuera", "ausente.json"):
            with self.subTest(raw=raw):
                self.assertEqual(self.resolve(raw)["raw"], raw)

    def test_reference_from_another_run_resolves_against_the_catalog(self) -> None:
        other = build_archive(self.root, "prepared")
        other_location = location_for(other, self.root)
        self.catalog.refresh()
        result = resolve_reference(
            other_location.relative_path + "/evidence/context.json", self.location, self.catalog
        )
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["run_key"], other_location.key)

    def test_resolving_does_not_modify_the_archive(self) -> None:
        before = archive_inventory(self.root)
        for raw in ("notes.json", "evidence/notes.json", "https://example.invalid/x"):
            self.resolve(raw)
        self.assertEqual(archive_inventory(self.root), before)


if __name__ == "__main__":
    unittest.main()