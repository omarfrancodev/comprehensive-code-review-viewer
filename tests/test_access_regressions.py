"""Regresiones del límite de confianza del archivo, con fuentes sintéticas."""

import os
import tempfile
import json
import unittest
from pathlib import Path
from unittest import mock

from ccr_viewer import paths
from ccr_viewer.discovery import RunLocation
from ccr_viewer.integrity import validate_archive
from ccr_viewer.references import list_files
from ccr_viewer.snapshots import read_snapshot
from fixtures import build_archive
from test_paths import make_link


class AccessRegressions(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def test_posix_descriptor_compares_file_identity_separately_from_root(self):
        target = self.root / "notes.txt"
        target.write_text("synthetic", encoding="utf-8")
        frozen = paths._freeze_root(self.root)
        with target.open("rb") as handle, mock.patch.object(paths.os, "name", "posix"):
            self.assertTrue(paths._handle_is_within(frozen, handle, target))

    def test_replaced_run_is_not_promoted_to_a_new_trusted_root(self):
        run = build_archive(self.root / "archive", "final_v7")
        location = RunLocation("a" * 32, run, run.relative_to(self.root / "archive").as_posix())
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "review.json").write_text('{"secret": "outside"}', encoding="utf-8")
        moved = run.with_name(run.name + "-saved")
        run.rename(moved)
        if not make_link(run, outside):
            self.skipTest("La sesión no permite crear enlaces/junctions.")
        snapshot = read_snapshot(location)
        self.assertIsNone(snapshot["files"]["review.json"]["data"])
        self.assertEqual(list_files(location), [])

    def test_integrity_uses_snapshot_closure_not_an_unprotected_reread(self):
        run = build_archive(self.root, "final_v7")
        location = RunLocation("a" * 32, run, run.relative_to(self.root).as_posix())
        snapshot = read_snapshot(location)
        original = Path.read_bytes

        def deny_closure(path):
            if path == run / "cierre.json":
                self.fail("La validación relee cierre.json fuera del opener protegido")
            return original(path)

        with mock.patch.object(Path, "read_bytes", deny_closure):
            self.assertEqual(validate_archive(location, snapshot)["status"], "verified")

    def test_integrity_rechecks_transaction_after_hashing(self):
        import ccr_viewer.integrity as module
        run = build_archive(self.root, "final_v7")
        location = RunLocation("a" * 32, run, run.relative_to(self.root).as_posix())
        snapshot = read_snapshot(location)
        original = module.hash_regular_file
        def writing(root, relative):
            digest = original(root, relative)
            closure = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
            closure["pending_trace"] = {"synthetic": True}
            (run / "cierre.json").write_text(json.dumps(closure), encoding="utf-8")
            return digest
        with mock.patch.object(module, "hash_regular_file", writing):
            self.assertEqual(validate_archive(location, snapshot)["status"], "updating")
