"""Pruebas de lectura estable: coherencia, límites de entrada y transiciones del productor."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ccr_viewer.discovery import RunLocation
from ccr_viewer.snapshots import read_snapshot

from fixtures import archive_inventory, build_archive, canonical_json_bytes, with_overrides


def location_for(run: Path, root: Path) -> RunLocation:
    from ccr_viewer.discovery import run_key

    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


class SnapshotReadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def snapshot_for(self, variant: str, *overrides: str) -> tuple[RunLocation, dict]:
        run = with_overrides(variant, *overrides)(self.root)
        return location_for(run, self.root), read_snapshot(location_for(run, self.root))

    def test_reads_closure_review_and_report(self) -> None:
        _, snapshot = self.snapshot_for("final_v7")
        self.assertFalse(snapshot["updating"])
        self.assertEqual(snapshot["diagnostics"], [])
        self.assertEqual(snapshot["files"]["cierre.json"]["data"]["schema_version"], 5)
        self.assertEqual(
            snapshot["files"]["review.json"]["verdict"], "approvable_with_reservations"
        )
        self.assertTrue(snapshot["files"]["informe.md"]["present"])
        self.assertTrue(snapshot["files"]["trazabilidad.jsonl"]["present"])

    def test_fingerprint_changes_with_content(self) -> None:
        _, first = self.snapshot_for("final_v7")
        run = build_archive(self.root, "prepared_archive_v5")
        second = read_snapshot(location_for(run, self.root))
        self.assertNotEqual(first["fingerprint"], second["fingerprint"])

    def test_bom_is_removed_for_parsing_only(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "bom")
        parsed = snapshot["files"]["review.json"]["data"]
        self.assertEqual(parsed["schema_version"], 7)
        # El BOM se quita para interpretar, pero los bytes originales se conservan.
        bom = b"\xef\xbb\xbf"
        self.assertEqual(
            snapshot["files"]["review.json"]["size"], len(bom) + len(canonical_json_bytes(parsed))
        )
        self.assertTrue(snapshot["files"]["review.json"]["raw"].startswith(bom))

    def test_nan_constant_is_rejected_with_a_diagnostic(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "nan")
        self.assertIsNone(snapshot["files"]["review.json"]["data"])
        self.assertTrue(
            any(item["code"] == "snapshot.invalid_constant" for item in snapshot["diagnostics"])
        )

    def test_duplicate_keys_are_rejected_with_a_diagnostic(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "duplicate_keys")
        self.assertIsNone(snapshot["files"]["review.json"]["data"])
        self.assertTrue(
            any(item["code"] == "snapshot.duplicate_keys" for item in snapshot["diagnostics"])
        )

    def test_oversized_metadata_is_rejected_before_parsing(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "oversized")
        self.assertIsNone(snapshot["files"]["review.json"]["data"])
        self.assertTrue(
            any(item["code"] == "snapshot.too_large" for item in snapshot["diagnostics"])
        )

    def test_corrupt_json_keeps_the_run_visible(self) -> None:
        _, snapshot = self.snapshot_for("corrupt_json")
        self.assertIsNone(snapshot["files"]["review.json"]["data"])
        self.assertTrue(
            any(item["code"] == "snapshot.invalid_json" for item in snapshot["diagnostics"])
        )
        self.assertEqual(snapshot["files"]["cierre.json"]["data"]["state"], "complete")

    def test_unparseable_closure_is_reported_not_raised(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "bad_closure_json")
        self.assertIsNone(snapshot["files"]["cierre.json"]["data"])
        self.assertTrue(
            any(item["code"] == "snapshot.invalid_json" for item in snapshot["diagnostics"])
        )

    def test_missing_ownership_marker_is_reported(self) -> None:
        _, snapshot = self.snapshot_for("final_v7", "no_ownership")
        self.assertFalse(snapshot["files"][".review-ownership.json"]["present"])
        self.assertTrue(
            any(item["code"] == "snapshot.missing_ownership" for item in snapshot["diagnostics"])
        )

    def test_reading_does_not_modify_the_archive(self) -> None:
        build_archive(self.root, "final_v7")
        before = archive_inventory(self.root)
        for run in self.root.rglob("cierre.json"):
            read_snapshot(location_for(run.parent, self.root))
        self.assertEqual(archive_inventory(self.root), before)

    def test_pending_trace_marks_the_snapshot_as_updating(self) -> None:
        _, snapshot = self.snapshot_for("pending_trace_archive_v5")
        self.assertTrue(snapshot["updating"])
        self.assertTrue(
            any(item["code"] == "snapshot.transition_pending" for item in snapshot["diagnostics"])
        )

    def test_pending_trace_intent_is_never_cleared(self) -> None:
        before_run = build_archive(self.root, "pending_trace_archive_v5")
        before = archive_inventory(self.root)
        read_snapshot(location_for(before_run, self.root))
        after = json.loads((before_run / "cierre.json").read_text(encoding="utf-8"))
        self.assertIsNotNone(after["pending_trace"])
        self.assertEqual(archive_inventory(self.root), before)


class SnapshotTransitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def test_closure_change_during_read_keeps_previous_snapshot(self) -> None:
        run = build_archive(self.root, "processing_archive_v5")
        location = location_for(run, self.root)
        coherent = read_snapshot(location)

        real_open = None

        class Mutating:
            def __init__(self, wrapped: object) -> None:
                self.wrapped = wrapped

            def __call__(self, root: Path, relative: str):
                handle = self.wrapped(root, relative)
                if relative == "trazabilidad.jsonl":
                    (Path(root) / "cierre.json").write_bytes(
                        canonical_json_bytes({"schema_version": 5, "state": "closing"})
                    )
                return handle

        import ccr_viewer.snapshots as snapshots_module

        real_open = snapshots_module.open_archive_file
        with mock.patch.object(snapshots_module, "open_archive_file", Mutating(real_open)):
            with mock.patch.object(snapshots_module.time, "sleep", lambda _seconds: None):
                result = read_snapshot(location, previous=coherent)

        self.assertTrue(result["updating"])
        self.assertTrue(
            any(item["code"] == "snapshot.transition_detected" for item in result["diagnostics"])
        )
        self.assertEqual(result["files"]["cierre.json"]["data"]["state"], "processing")

    def test_retries_are_bounded(self) -> None:
        run = build_archive(self.root, "processing_archive_v5")
        location = location_for(run, self.root)
        import ccr_viewer.snapshots as snapshots_module

        calls = {"count": 0}
        real_open = snapshots_module.open_archive_file

        def counting_open(root: Path, relative: str):
            if relative == "trazabilidad.jsonl":
                calls["count"] += 1
                (Path(root) / "cierre.json").write_bytes(
                    canonical_json_bytes({"schema_version": 5, "state": "closing"})
                )
            return real_open(root, relative)

        with mock.patch.object(snapshots_module, "open_archive_file", counting_open):
            with mock.patch.object(snapshots_module.time, "sleep", lambda _seconds: None):
                read_snapshot(location)
        self.assertEqual(calls["count"], snapshots_module.MAX_STABLE_READ_ATTEMPTS)


if __name__ == "__main__":
    unittest.main()