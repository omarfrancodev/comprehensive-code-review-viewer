"""Catálogo de corridas: detección sin escritura y claves de identidad del visor."""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .paths import is_reparse

__all__ = [
    "RunLocation",
    "diagnostic",
    "normalize_relative",
    "run_key",
    "discover_runs",
    "RUN_SENTINELS",
    "SKIPPED_DIRECTORIES",
    "MAX_RUNS",
    "MAX_DEPTH",
]

#: Cualquiera de estos archivos convierte su directorio en una corrida detectable.
RUN_SENTINELS = ("cierre.json", "review.json", "informe.md", "trazabilidad.jsonl")

#: Directorios que nunca se recorren: evidencia de la corrida y árboles de tooling.
SKIPPED_DIRECTORIES = frozenset(
    {
        "evidence",
        ".git",
        ".worktrees",
        "node_modules",
        "__pycache__",
        "build",
        "dist",
        ".venv",
        "venv",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    }
)

MAX_RUNS = 5000
MAX_DEPTH = 6


@dataclass(frozen=True)
class RunLocation:
    """Ubicación de una corrida dentro del archivo seleccionado."""

    key: str
    path: Path
    relative_path: str


def diagnostic(code: str, severity: str, message: str, source: str | None = None) -> dict:
    """Construye un diagnóstico con la forma común de la API."""

    return {"code": code, "severity": severity, "message": message, "source": source}


def normalize_relative(relative: str) -> str:
    """Normaliza una ruta relativa al archivo para compararla entre plataformas."""

    return PurePosixPath(relative.replace("\\", "/")).as_posix()


def run_key(relative_path: str) -> str:
    """Clave estable de la corrida: 32 hexadecimales de SHA-256 sobre su ruta relativa.

    Es una identidad propia del visor y nunca sustituye al ``review_id`` de origen.
    """

    normalized = normalize_relative(relative_path)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def _has_sentinel(directory: Path, names: list[str]) -> bool:
    """Indica si el directorio contiene un centinela regular (sin seguir enlaces)."""

    for name in names:
        if name not in RUN_SENTINELS:
            continue
        try:
            status = os.lstat(directory / name)
        except OSError:
            continue
        if stat.S_ISREG(status.st_mode):
            return True
    return False


def discover_runs(
    root: Path, *, max_runs: int = MAX_RUNS, max_depth: int = MAX_DEPTH
) -> tuple[list[RunLocation], list[dict]]:
    """Recorre la raíz seleccionada y devuelve las corridas detectadas y sus diagnósticos.

    No exige nomenclatura actual, marcador de propiedad ni registro final: una
    corrida mal formada sigue siendo visible con su diagnóstico y no oculta a las
    demás. Nunca desciende dentro de una corrida ni sigue enlaces.
    """

    base = Path(root).resolve()
    found: list[RunLocation] = []
    diagnostics: list[dict] = []
    seen_keys: dict[str, str] = {}
    state = {"runs_truncated": False, "depth_truncated": False}

    def walk(directory: Path, relative: str, depth: int) -> None:
        if state["runs_truncated"]:
            return
        try:
            with os.scandir(directory) as entries:
                names = sorted(entry.name for entry in entries)
        except OSError as error:
            diagnostics.append(
                diagnostic(
                    "discovery.unreadable_directory",
                    "warning",
                    "No se pudo leer el directorio: " + str(error),
                    relative or None,
                )
            )
            return

        if _has_sentinel(directory, names):
            _record(directory, relative)
            return

        if depth >= max_depth:
            state["depth_truncated"] = True
            diagnostics.append(
                diagnostic(
                    "discovery.depth_truncated",
                    "warning",
                    f"La búsqueda se detuvo a {max_depth} niveles: el contenido más profundo "
                    "no forma parte de la biblioteca mostrada.",
                    relative or None,
                )
            )
            return

        for name in names:
            if name in SKIPPED_DIRECTORIES:
                continue
            child = directory / name
            try:
                if not child.is_dir() or is_reparse(child):
                    continue
            except OSError:
                continue
            walk(child, f"{relative}/{name}" if relative else name, depth + 1)

    def _record(directory: Path, relative: str) -> None:
        key = run_key(relative)
        if key in seen_keys:
            if seen_keys[key] != relative:
                diagnostics.append(
                    diagnostic(
                        "discovery.key_collision",
                        "error",
                        "Dos rutas distintas producen la misma clave de corrida: "
                        + relative,
                        relative,
                    )
                )
            return
        if len(found) >= max_runs:
            state["runs_truncated"] = True
            diagnostics.append(
                diagnostic(
                    "discovery.runs_truncated",
                    "warning",
                    f"La biblioteca se limitó a {max_runs} corridas; las restantes no se listan.",
                    relative,
                )
            )
            return
        seen_keys[key] = relative
        found.append(RunLocation(key=key, path=directory, relative_path=relative))

    walk(base, "", 0)
    found.sort(key=lambda item: item.relative_path)
    return found, diagnostics