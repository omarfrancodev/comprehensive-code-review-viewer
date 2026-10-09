"""Línea de comandos del visor.

``main`` sólo importa el servidor cuando hace falta: ``--version`` y la política
de raíz se resuelven sin cargar los módulos de HTTP de la Tarea 5.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Mapping, Sequence

from . import __version__
from .paths import CcrViewerError, RootConfig, resolve_root_source

__all__ = ["parse_args", "build_config", "main"]

_PROGRAM = "ccr-viewer"

_DESCRIPTION = (
    "Visor web local de solo lectura para explorar revisiones de Comprehensive Code Review."
)


def _port(value: str) -> int:
    """Valida un puerto dentro del rango 0..65535."""

    try:
        number = int(value, 10)
    except ValueError:
        raise argparse.ArgumentTypeError(f"El puerto debe ser un entero: {value!r}") from None
    if not 0 <= number <= 65535:
        raise argparse.ArgumentTypeError("El puerto debe estar entre 0 y 65535.")
    return number


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    """Construye el analizador de argumentos del visor."""

    parser = argparse.ArgumentParser(prog=_PROGRAM, description=_DESCRIPTION)
    parser.add_argument(
        "--root",
        metavar="PATH",
        default=None,
        help="Archivo de revisiones que se debe explorar.",
    )
    parser.add_argument(
        "--port",
        type=_port,
        default=0,
        metavar="INTEGER",
        help="Puerto local de escucha (0 elige uno libre). Por omisión: 0.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="No abrir el navegador; sólo imprimir la dirección de acceso.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"{_PROGRAM} {__version__}",
        help="Mostrar la versión del paquete y terminar.",
    )
    return parser.parse_args(list(argv))


def build_config(
    args: argparse.Namespace, env: Mapping[str, str], home: Path
) -> RootConfig:
    """Convierte los argumentos en una configuración de raíz verificada."""

    root, selected_by = resolve_root_source(args.root, env, home)
    return RootConfig(
        root=root,
        selected_by=selected_by,
        port=args.port,
        open_browser=not args.no_browser,
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Punto de entrada común al ejecutable de consola y a ``python -m ccr_viewer``."""

    arguments = sys.argv[1:] if argv is None else list(argv)
    try:
        args = parse_args(arguments)
    except SystemExit as exit_request:
        return int(exit_request.code or 0)

    try:
        config = build_config(args, os.environ, Path.home())
    except CcrViewerError as error:
        print(f"{_PROGRAM}: {error}", file=sys.stderr)
        return 1

    print(f"Raíz del archivo ({config.selected_by}): {config.root}")
    return 0