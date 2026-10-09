"""Punto de entrada equivalente al ejecutable de consola: ``python -m ccr_viewer``."""

from __future__ import annotations

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())