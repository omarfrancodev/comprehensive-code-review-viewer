"""Pruebas de selección de raíz y de la política de acceso de solo lectura."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import ccr_viewer.paths
from ccr_viewer.paths import (
    RootSelectionError,
    UnsafePathError,
    open_archive_file,
    resolve_root,
    safe_regular_file,
)


def inventory(base: Path) -> dict[str, tuple[int, int]]:
    """Huella de archivos regulares bajo ``base`` para detectar cualquier escritura."""

    result: dict[str, tuple[int, int]] = {}
    for path in sorted(base.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        status = os.lstat(path)
        result[path.relative_to(base).as_posix()] = (status.st_size, status.st_mtime_ns)
    return result


def make_link(link: Path, target: Path) -> bool:
    """Crea un enlace de directorio; devuelve False si la plataforma no lo permite."""

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


class ResolveRootTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.tmp = Path(self._temporary.name)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.explicit = self.tmp / "explicito"
        self.explicit.mkdir()
        self.other = self.tmp / "otro"
        self.other.mkdir()

    def test_explicit_root_wins_over_environment(self) -> None:
        self.assertEqual(
            resolve_root(str(self.explicit), {"CCR_ARTIFACTS_DIR": str(self.other)}, self.home),
            self.explicit.resolve(),
        )

    def test_environment_root_is_used_without_explicit_root(self) -> None:
        self.assertEqual(
            resolve_root(None, {"CCR_ARTIFACTS_DIR": str(self.other)}, self.home),
            self.other.resolve(),
        )

    def test_default_root_is_relative_to_home(self) -> None:
        expected = self.home / ".comprehensive-code-review" / "reviews"
        expected.mkdir(parents=True)
        self.assertEqual(resolve_root(None, {}, self.home), expected.resolve())

    def test_parent_containing_reviews_child_resolves_that_child(self) -> None:
        parent = self.tmp / "contenedor"
        child = parent / "reviews"
        child.mkdir(parents=True)
        self.assertEqual(resolve_root(str(parent), {}, self.home), child.resolve())

    def test_direct_run_sentinel_keeps_the_selected_directory(self) -> None:
        run_root = self.tmp / "corrida"
        (run_root / "evidence").mkdir(parents=True)
        (run_root / "cierre.json").write_text("{}", encoding="utf-8")
        self.assertEqual(resolve_root(str(run_root), {}, self.home), run_root.resolve())

    def test_empty_directory_is_used_as_archive_root(self) -> None:
        self.assertEqual(resolve_root(str(self.other), {}, self.home), self.other.resolve())

    def test_missing_explicit_root_raises_without_creating_anything(self) -> None:
        missing = self.tmp / "inexistente"
        before = inventory(self.tmp)
        with self.assertRaises(RootSelectionError) as caught:
            resolve_root(str(missing), {"CCR_ARTIFACTS_DIR": str(self.other)}, self.home)
        self.assertIn(str(missing), str(caught.exception))
        self.assertEqual(inventory(self.tmp), before)
        self.assertFalse(missing.exists())

    def test_missing_default_root_raises_with_instructions(self) -> None:
        with self.assertRaises(RootSelectionError) as caught:
            resolve_root(None, {}, self.home)
        message = str(caught.exception)
        self.assertIn("CCR_ARTIFACTS_DIR", message)
        self.assertIn("--root", message)
        self.assertFalse((self.home / ".comprehensive-code-review").exists())

    def test_root_that_is_a_file_is_rejected(self) -> None:
        as_file = self.tmp / "archivo.txt"
        as_file.write_text("no soy un directorio", encoding="utf-8")
        with self.assertRaises(RootSelectionError):
            resolve_root(str(as_file), {}, self.home)

    def test_resolution_never_creates_directories(self) -> None:
        before = inventory(self.tmp)
        resolve_root(str(self.explicit), {}, self.home)
        resolve_root(None, {"CCR_ARTIFACTS_DIR": str(self.other)}, self.home)
        self.assertEqual(inventory(self.tmp), before)


class SafeRegularFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.tmp = Path(self._temporary.name)
        self.root = self.tmp / "reviews"
        (self.root / "evidence").mkdir(parents=True)
        (self.root / "evidence" / "notas.json").write_text('{"ok": true}', encoding="utf-8")
        (self.root / "informe.md").write_text("# Informe\n", encoding="utf-8")

    def test_regular_file_inside_root_is_accepted(self) -> None:
        self.assertEqual(
            safe_regular_file(self.root, "evidence/notas.json"),
            (self.root / "evidence" / "notas.json").resolve(),
        )

    def test_parent_traversal_is_rejected(self) -> None:
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "../fuera.txt")

    def test_nested_parent_traversal_is_rejected(self) -> None:
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "evidence/../../fuera.txt")

    def test_absolute_path_is_rejected(self) -> None:
        outside = self.tmp / "fuera.txt"
        outside.write_text("secreto", encoding="utf-8")
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, str(outside))

    def test_drive_letter_path_is_rejected(self) -> None:
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "C:/Windows/System32/drivers/etc/hosts")

    def test_empty_relative_path_is_rejected(self) -> None:
        for value in ("", ".", "./", "   "):
            with self.subTest(value=value):
                with self.assertRaises(UnsafePathError):
                    safe_regular_file(self.root, value)

    def test_directory_is_rejected(self) -> None:
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "evidence")

    def test_missing_file_is_rejected(self) -> None:
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "evidence/ausente.json")

    def test_reparse_point_escape(self) -> None:
        outside = self.tmp / "secreto"
        outside.mkdir()
        (outside / "notas.txt").write_text("secreto", encoding="utf-8")
        link = self.root / "evidence" / "enlace"
        if not make_link(link, outside):
            self.skipTest(
                "La plataforma no permite crear enlaces o junctions en esta sesión; "
                "la variante determinista sigue vigente."
            )
        with self.assertRaises(UnsafePathError):
            safe_regular_file(self.root, "evidence/enlace/notas.txt")
        with self.assertRaises(UnsafePathError):
            with open_archive_file(self.root, "evidence/enlace/notas.txt") as handle:
                handle.read()

    def test_reparse_component_is_rejected_deterministically(self) -> None:
        real = ccr_viewer.paths._is_reparse

        def fake(path: Path) -> bool:
            return Path(path).name == "evidence" or real(path)

        with mock.patch("ccr_viewer.paths._is_reparse", side_effect=fake):
            with self.assertRaises(UnsafePathError):
                safe_regular_file(self.root, "evidence/notas.json")


class OpenArchiveFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.tmp = Path(self._temporary.name)
        self.root = self.tmp / "reviews"
        (self.root / "evidence").mkdir(parents=True)
        self.target = self.root / "evidence" / "notas.json"
        self.target.write_text('{"ok": true}', encoding="utf-8")

    def test_reads_bytes_of_a_regular_file(self) -> None:
        with open_archive_file(self.root, "evidence/notas.json") as handle:
            self.assertEqual(handle.read(), b'{"ok": true}')

    def test_traversal_is_rejected_before_opening(self) -> None:
        before = inventory(self.tmp)
        with self.assertRaises(UnsafePathError):
            with open_archive_file(self.root, "../fuera.txt") as handle:
                handle.read()
        self.assertEqual(inventory(self.tmp), before)

    def test_handle_outside_root_is_rejected_before_reading(self) -> None:
        with mock.patch("ccr_viewer.paths._handle_is_within", return_value=False):
            with self.assertRaises(UnsafePathError):
                with open_archive_file(self.root, "evidence/notas.json") as handle:
                    handle.read()

    def test_opening_does_not_modify_the_archive(self) -> None:
        before = inventory(self.root)
        with open_archive_file(self.root, "evidence/notas.json") as handle:
            handle.read()
        self.assertEqual(inventory(self.root), before)


if __name__ == "__main__":
    unittest.main()