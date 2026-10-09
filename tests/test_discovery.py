"""Pruebas de descubrimiento del catálogo: corridas, límites y aislamiento."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from ccr_viewer.discovery import discover_runs, run_key

import fixtures
from fixtures import archive_inventory, build_archive, with_overrides


def make_link(link: Path, target: Path) -> bool:
    try:
        os.symlink(target, link, target_is_directory=True)
        return True
    except (OSError, NotImplementedError, AttributeError, ValueError):
        pass
    if os.name != "nt":
        return False
    try:
        completed = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


class RunKeyTests(unittest.TestCase):
    def test_key_is_stable_and_uses_posix_separators(self) -> None:
        self.assertEqual(run_key("a/b/c"), run_key("a/b/c"))
        self.assertEqual(run_key("a/b/c"), run_key("a\\b\\c"))
        self.assertNotEqual(run_key("a/b"), run_key("b/a"))

    def test_key_is_32_lowercase_hex_characters(self) -> None:
        key = run_key("acme/demo/pr-42/20260901T120000-abc")
        self.assertEqual(len(key), 32)
        self.assertTrue(all(char in "0123456789abcdef" for char in key))


class DiscoverRunsTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def locations(self, **kwargs) -> list:
        found, diagnostics = discover_runs(self.root, **kwargs)
        self.assertIsInstance(diagnostics, list)
        return found

    def test_finds_a_canonical_run(self) -> None:
        run = build_archive(self.root, "final_v7")
        found = self.locations()
        expected = run.resolve().relative_to(self.root.resolve()).as_posix()
        self.assertEqual([item.relative_path for item in found], [expected])
        self.assertEqual(len(found[0].key), 32)

    def test_finds_a_legacy_flat_run(self) -> None:
        run = build_archive(self.root, "prepared")
        found = self.locations()
        self.assertEqual([item.path for item in found], [run.resolve()])

    def test_finds_a_prepared_run_without_final_record(self) -> None:
        build_archive(self.root, "processing_archive_v5")
        build_archive(self.root, "prepared_archive_v5")
        self.assertEqual(len(self.locations()), 2)

    def test_malformed_run_stays_visible_next_to_a_readable_one(self) -> None:
        readable = build_archive(self.root, "final_v7")
        broken = build_archive(self.root, "corrupt_json")
        found = self.locations()
        paths = {item.path for item in found}
        self.assertIn(readable, paths)
        self.assertIn(broken, paths)

    def test_nested_sentinel_inside_evidence_is_not_a_run(self) -> None:
        run = build_archive(self.root, "final_v7")
        nested = run / "evidence" / "sub" / "review.json"
        nested.parent.mkdir(parents=True, exist_ok=True)
        nested.write_text("{}", encoding="utf-8")
        found = self.locations()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].path, run)

    def test_runs_with_similar_repository_names_stay_separate(self) -> None:
        build_archive(self.root, "final_v7")
        build_archive(
            self.root,
            "final_v7",
            overrides=("repository=git.otro.invalid/acme/demo-app.git",),
        )
        found = self.locations()
        self.assertEqual(len(found), 2)
        self.assertEqual(len({item.key for item in found}), 2)

    def test_linked_directory_is_not_followed(self) -> None:
        target = build_archive(self.root, "final_v7")
        link = self.root / "enlazado"
        if not make_link(link, target.parent):
            self.skipTest("La plataforma no permite crear enlaces o junctions en esta sesión.")
        found = self.locations()
        self.assertEqual([item.path for item in found], [target.resolve()])

    def test_depth_bound_is_reported_as_truncation(self) -> None:
        deep = self.root / "a" / "b" / "c" / "d" / "e" / "f" / "g"
        deep.mkdir(parents=True)
        (deep / "review.json").write_text("{}", encoding="utf-8")
        found, diagnostics = discover_runs(self.root, max_depth=6)
        self.assertEqual(found, [])
        self.assertTrue(any(item["code"] == "discovery.depth_truncated" for item in diagnostics))

    def test_depth_bound_keeps_content_at_the_limit(self) -> None:
        target = self.root / "a" / "b" / "c" / "d"
        target.mkdir(parents=True)
        (target / "review.json").write_text("{}", encoding="utf-8")
        found, diagnostics = discover_runs(self.root, max_depth=6)
        self.assertEqual(len(found), 1)
        self.assertFalse(any(item["code"] == "discovery.depth_truncated" for item in diagnostics))

    def test_run_bound_is_reported_as_truncation(self) -> None:
        build_archive(self.root, "final_v7")
        build_archive(self.root, "prepared_archive_v5")
        found, diagnostics = discover_runs(self.root, max_runs=1)
        self.assertEqual(len(found), 1)
        self.assertTrue(any(item["code"] == "discovery.runs_truncated" for item in diagnostics))

    def test_discovery_does_not_modify_the_archive(self) -> None:
        build_archive(self.root, "final_v7")
        before = archive_inventory(self.root)
        self.locations()
        self.assertEqual(archive_inventory(self.root), before)

    def test_discovery_is_deterministic(self) -> None:
        build_archive(self.root, "final_v7")
        build_archive(self.root, "prepared")
        first = [(item.key, item.relative_path) for item in self.locations()]
        second = [(item.key, item.relative_path) for item in self.locations()]
        self.assertEqual(first, second)

    def test_parent_with_reviews_child_is_still_scanned(self) -> None:
        container = self.root / "contenedor"
        build_archive(container / "reviews", "final_v7")
        found, _ = discover_runs(self.root)
        self.assertEqual(len(found), 1)


if __name__ == "__main__":
    unittest.main()