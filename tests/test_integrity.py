"""Pruebas de integridad de solo lectura:(bytes, hashes declarados, propiedad y disposición)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ccr_viewer.adapters import Catalog
from ccr_viewer.discovery import RunLocation, run_key
from ccr_viewer.integrity import hash_regular_file, validate_archive
from ccr_viewer.snapshots import read_snapshot

from fixtures import archive_inventory, build_archive, with_overrides


def location_for(run: Path, root: Path) -> RunLocation:
    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


class HashRegularFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")

    def test_hash_matches_the_recorded_value(self) -> None:
        closure = json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))
        expected = closure["hashes"]["evidence/notes.json"]
        self.assertEqual(hash_regular_file(self.run, "evidence/notes.json"), expected)

    def test_large_file_is_hashed_in_bounded_chunks(self) -> None:
        (self.run / "evidence" / "grande.bin").write_bytes(b"z" * (5 * 1024 * 1024))
        import ccr_viewer.integrity as integrity_module

        real_open = integrity_module.open_archive_file
        sizes: list[int] = []

        class Recording:
            """Proxy que anota el tamaño de cada lectura sin tocar el handle real."""

            def __init__(self, manager):
                self._manager = manager
                self._handle = None

            def read(self, size: int = -1):
                sizes.append(size)
                return self._handle.read(size)

            def __enter__(self):
                self._handle = self._manager.__enter__()
                return self

            def __exit__(self, *exc_info):
                return self._manager.__exit__(*exc_info)

        def recording(root: Path, relative: str):
            return Recording(real_open(root, relative))

        with mock.patch.object(integrity_module, "open_archive_file", recording):
            digest = hash_regular_file(self.run, "evidence/grande.bin")
        self.assertEqual(len(digest), 64)
        self.assertTrue(sizes)
        self.assertTrue(all(size == 1024 * 1024 for size in sizes), sizes)

    def test_hashing_does_not_modify_the_archive(self) -> None:
        before = archive_inventory(self.root)
        hash_regular_file(self.run, "evidence/notes.json")
        self.assertEqual(archive_inventory(self.root), before)


class ValidateArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def validate(self, variant: str, *overrides: str) -> tuple[dict, dict, Path, RunLocation]:
        run = with_overrides(variant, *overrides)(self.root)
        location = location_for(run, self.root)
        snapshot = read_snapshot(location)
        return validate_archive(location, snapshot), snapshot, run, location

    def test_canonical_archive_is_verified(self) -> None:
        report, _, _, _ = self.validate("final_v7")
        self.assertEqual(report["status"], "verified")
        self.assertTrue(all(item["status"] == "passed" for item in report["checks"]))

    def test_mismatched_evidence_fails_without_changing_the_source_verdict(self) -> None:
        report, snapshot, _, _ = self.validate("final_v7", "mismatched_evidence")
        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any(
                item["name"] == "evidence/notes.json" and item["status"] == "failed"
                for item in report["checks"]
            )
        )
        self.assertEqual(
            snapshot["files"]["review.json"]["verdict"], "approvable_with_reservations"
        )

    def test_missing_hashed_evidence_fails(self) -> None:
        report, _, _, _ = self.validate("final_v7", "missing_evidence")
        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any(
                item["name"] == "evidence/notes.json" and item["status"] == "failed"
                for item in report["checks"]
            )
        )

    def test_missing_ownership_marker_is_limited_not_verified(self) -> None:
        report, _, _, _ = self.validate("final_v7", "no_ownership")
        self.assertEqual(report["status"], "limited")

    def test_foreign_ownership_marker_fails(self) -> None:
        report, _, _, _ = self.validate("final_v7", "bad_marker")
        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any(item["name"] == ".review-ownership.json" for item in report["checks"])
        )

    def test_schema_less_archive_is_limited_with_valid_individual_hashes(self) -> None:
        report, _, _, _ = self.validate("schema_less")
        self.assertEqual(report["status"], "limited")
        self.assertTrue(
            any(item["name"] == "evidence/notes.json" and item["status"] == "passed"
                for item in report["checks"])
        )

    def test_review_identity_disagreement_fails(self) -> None:
        report, _, _, _ = self.validate("final_v7", "mismatched_review_id")
        self.assertEqual(report["status"], "failed")
        self.assertTrue(any(item["name"] == "review.json" for item in report["checks"]))

    def test_schema_5_binds_ownership_and_trace(self) -> None:
        report, _, _, _ = self.validate("final_v7")
        names = {item["name"] for item in report["checks"]}
        self.assertIn("trazabilidad.jsonl", names)
        self.assertIn(".review-ownership.json", names)
        self.assertEqual(report["status"], "verified")

    def test_coherent_historical_schema_4_archive_is_supported(self) -> None:
        report, _, _, _ = self.validate("complete_archive_v4")
        self.assertEqual(report["status"], "verified")

    def test_invalid_processing_in_schema_4_fails_with_a_version_diagnostic(self) -> None:
        # El esquema 4 prohíbe `processing`: es una contradicción con el contrato
        # declarado, no una limitación de compatibilidad.
        report, _, _, _ = self.validate("invalid_processing_archive_v4")
        self.assertEqual(report["status"], "failed")
        self.assertTrue(
            any("4" in item.get("detail", "") for item in report["checks"] if item["name"] == "cierre.json")
        )

    def test_pending_trace_yields_updating_not_a_final_state(self) -> None:
        report, _, run, _ = self.validate("pending_trace_archive_v5")
        self.assertEqual(report["status"], "updating")
        closure = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
        self.assertIsNotNone(closure["pending_trace"])

    def test_validation_never_consumes_pending_intent(self) -> None:
        report, _, run, _ = self.validate("pending_trace_archive_v5")
        before = archive_inventory(self.root)
        validate_archive(location_for(run, self.root), read_snapshot(location_for(run, self.root)))
        self.assertEqual(archive_inventory(self.root), before)
        closure = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
        self.assertIsNotNone(closure["pending_trace"])

    def test_unparseable_closure_is_reported_not_raised(self) -> None:
        report, _, _, _ = self.validate("final_v7", "bad_closure_json")
        self.assertIn(report["status"], {"failed", "limited"})
        self.assertTrue(report["checks"])

    def test_duplicate_keys_disable_full_verification(self) -> None:
        report, _, _, _ = self.validate("final_v7", "duplicate_keys")
        self.assertNotEqual(report["status"], "verified")

    def test_validation_does_not_modify_the_archive(self) -> None:
        run = with_overrides("final_v7")(self.root)
        location = location_for(run, self.root)
        before = archive_inventory(self.root)
        validate_archive(location, read_snapshot(location))
        self.assertEqual(archive_inventory(self.root), before)

    def test_validation_replaces_no_hash_and_reports_source_verdict_separately(self) -> None:
        report, _, _, _ = self.validate("final_v7", "mismatched_evidence")
        self.assertNotIn("verdict", report)
        self.assertFalse(any("repaired" in item.get("detail", "") for item in report["checks"]))


class NoEagerHashingTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def test_catalog_refresh_never_reads_or_hashes_evidence(self) -> None:
        run = build_archive(self.root, "final_v7")
        (run / "evidence" / "grande.bin").write_bytes(b"q" * (2 * 1024 * 1024))

        import ccr_viewer.snapshots as snapshots_module

        opened: list[str] = []
        real_read = snapshots_module.read_bounded

        def recording(root: Path, relative: str, limit: int):
            opened.append(relative)
            return real_read(root, relative, limit)

        with mock.patch.object(snapshots_module, "read_bounded", recording):
            catalog = Catalog(self.root)
            catalog.refresh()
            catalog.get_run(catalog.locations()[0].key)
        self.assertFalse([name for name in opened if name.startswith("evidence/")], opened)


if __name__ == "__main__":
    unittest.main()