"""Pruebas de la línea de comandos: argumentos, versión y política de raíz."""

from __future__ import annotations

import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ccr_viewer import __version__
from ccr_viewer.cli import build_config, main, parse_args


def inventory(base: Path) -> dict[str, tuple[int, int]]:
    result: dict[str, tuple[int, int]] = {}
    for path in sorted(base.rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        status = os.lstat(path)
        result[path.relative_to(base).as_posix()] = (status.st_size, status.st_mtime_ns)
    return result


class ParseArgsTests(unittest.TestCase):
    def test_default_port_is_zero(self) -> None:
        self.assertEqual(parse_args([]).port, 0)

    def test_defaults_open_browser_and_no_root(self) -> None:
        args = parse_args([])
        self.assertIsNone(args.root)
        self.assertFalse(args.no_browser)

    def test_host_option_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            with contextlib.redirect_stderr(io.StringIO()):
                parse_args(["--host", "0.0.0.0"])
        self.assertNotEqual(caught.exception.code, 0)

    def test_negative_port_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            with contextlib.redirect_stderr(io.StringIO()):
                parse_args(["--port", "-1"])
        self.assertNotEqual(caught.exception.code, 0)

    def test_port_above_maximum_is_rejected(self) -> None:
        with self.assertRaises(SystemExit) as caught:
            with contextlib.redirect_stderr(io.StringIO()):
                parse_args(["--port", "65536"])
        self.assertNotEqual(caught.exception.code, 0)

    def test_boundary_ports_are_accepted(self) -> None:
        self.assertEqual(parse_args(["--port", "0"]).port, 0)
        self.assertEqual(parse_args(["--port", "65535"]).port, 65535)


class BuildConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.tmp = Path(self._temporary.name)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.root = self.tmp / "reviews"
        self.root.mkdir()

    def test_explicit_root_is_reported_as_selection_source(self) -> None:
        args = parse_args(["--root", str(self.root), "--port", "8123", "--no-browser"])
        config = build_config(args, {}, self.home)
        self.assertEqual(config.root, self.root.resolve())
        self.assertEqual(config.selected_by, "explicit")
        self.assertEqual(config.port, 8123)
        self.assertFalse(config.open_browser)

    def test_environment_root_is_reported_as_selection_source(self) -> None:
        args = parse_args([])
        config = build_config(args, {"CCR_ARTIFACTS_DIR": str(self.root)}, self.home)
        self.assertEqual(config.selected_by, "env")
        self.assertTrue(config.open_browser)


class MainTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.tmp = Path(self._temporary.name)

    def test_version_flag_returns_zero(self) -> None:
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(main(["--version"]), 0)
        self.assertIn("0.1.0", stdout.getvalue())
        self.assertIn(__version__, stdout.getvalue())

    def test_module_entrypoint_reports_the_same_version(self) -> None:
        self.assertEqual(__version__, "0.1.0")

    def test_missing_explicit_root_returns_nonzero_and_creates_nothing(self) -> None:
        missing = self.tmp / "inexistente"
        before = inventory(self.tmp)
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = main(["--root", str(missing), "--no-browser"])
        self.assertNotEqual(code, 0)
        self.assertIn(str(missing), stderr.getvalue())
        self.assertFalse(missing.exists())
        self.assertEqual(inventory(self.tmp), before)

    def test_missing_default_root_returns_nonzero_and_explains_how_to_fix_it(self) -> None:
        home = self.tmp / "home"
        home.mkdir()
        stderr = io.StringIO()
        with mock.patch("pathlib.Path.home", return_value=home):
            with mock.patch.dict(os.environ, {}, clear=True):
                with contextlib.redirect_stderr(stderr):
                    code = main(["--no-browser"])
        self.assertNotEqual(code, 0)
        self.assertIn("CCR_ARTIFACTS_DIR", stderr.getvalue())
        self.assertIn("--root", stderr.getvalue())
        self.assertFalse((home / ".comprehensive-code-review").exists())

    def test_resolved_root_is_displayed(self) -> None:
        root = self.tmp / "reviews"
        root.mkdir()
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = main(["--root", str(root), "--no-browser"])
        self.assertEqual(code, 0)
        self.assertIn(str(root.resolve()), stdout.getvalue())

    def test_invalid_host_argument_returns_nonzero_without_traceback(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            code = main(["--host", "0.0.0.0"])
        self.assertNotEqual(code, 0)
        self.assertNotIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()