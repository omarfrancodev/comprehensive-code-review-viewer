"""Resolución de referencias, inventario de archivos y vistas previas acotadas.

Una referencia es texto no confiable hasta que se resuelve. Sólo se resuelven
destinos dentro de la raíz seleccionada y contra archivos regulares catalogados;
un destino externo, ambiguo o fuera de la raíz se muestra con su motivo y no
provoca ninguna lectura automática.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath

from .discovery import RunLocation, diagnostic
from .paths import UnsafePathError, is_reparse, open_archive_file, _freeze_root

__all__ = [
    "file_key_for",
    "list_files",
    "read_preview",
    "resolve_reference",
    "media_kind_for",
    "MAX_PREVIEW_BYTES",
    "PREVIEW_CHUNK_BYTES",
]

MAX_PREVIEW_BYTES = 2 * 1024 * 1024
PREVIEW_CHUNK_BYTES = 1024 * 1024

#: Extensiones que se muestran como código inerte, nunca como contenido ejecutable.
_CODE_SUFFIXES = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".java", ".kt", ".kts",
    ".cs", ".go", ".rs", ".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp",
    ".sh", ".bash", ".ps1", ".sql", ".yml", ".yaml", ".toml", ".ini", ".cfg",
    ".gradle", ".tf", ".dockerfile", ".make", ".mk",
}
_TEXT_SUFFIXES = {".txt", ".log", ".csv", ".tsv", ".env.example", ".out"}

_SKIP_DIRECTORIES = {".git", ".worktrees", "node_modules", "__pycache__"}


def media_kind_for(name: str) -> str:
    """Clasifica un archivo por nombre; lo desconocido es texto inerte."""

    suffix = PurePosixPath(name).suffix.lower()
    if name.endswith(".md"):
        return "markdown"
    if name.endswith(".jsonl"):
        return "jsonl"
    if suffix == ".json":
        return "json"
    if suffix in _CODE_SUFFIXES:
        return "code"
    if suffix in _TEXT_SUFFIXES:
        return "text"
    return "other"


def file_key_for(run_key: str, relative: str) -> str:
    """Identidad opaca y estable de un archivo dentro de una corrida.

    No es una ruta: el cliente nunca envía rutas arbitrarias, sólo esta clave.
    """

    digest = hashlib.sha256()
    digest.update(run_key.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(relative.encode("utf-8"))
    return digest.hexdigest()[:32]


def _iter_regular_files(root: Path) -> list[str]:
    """Enumera archivos regulares bajo la corrida, sin seguir enlaces."""

    found: list[str] = []
    stack: list[tuple[Path, str]] = [(root, "")]
    while stack:
        directory, prefix = stack.pop()
        try:
            with os.scandir(directory) as entries:
                children = sorted(entries, key=lambda entry: entry.name)
        except OSError:
            continue
        for entry in children:
            try:
                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if entry.name in _SKIP_DIRECTORIES:
                        continue
                    if is_reparse(Path(entry.path)):
                        continue
                    stack.append((Path(entry.path), f"{prefix}{entry.name}/"))
                    continue
                if not entry.is_file(follow_symlinks=False):
                    continue
            except OSError:
                continue
            found.append(prefix + entry.name)
    return sorted(found)


def list_files(location: RunLocation) -> list[dict]:
    """Devuelve el inventario de archivos regulares de una corrida."""

    root = Path(location.path)
    try:
        _freeze_root(root)
    except (OSError, UnsafePathError):
        return []
    entries: list[dict] = []
    for relative in _iter_regular_files(root):
        try:
            size = (root / relative).stat().st_size
        except OSError:
            continue
        entries.append(
            {
                "key": file_key_for(location.key, relative),
                "name": PurePosixPath(relative).name,
                "relative_path": relative,
                "media_kind": media_kind_for(relative),
                "bytes": size,
                "available": True,
            }
        )
    return entries


def read_preview(location: RunLocation, file_key: str) -> dict:
    """Devuelve una vista previa acotada como texto inerte; nunca contenido ejecutable."""

    entry = next((item for item in list_files(location) if item["key"] == file_key), None)
    if entry is None:
        raise KeyError(file_key)
    relative = entry["relative_path"]
    total = entry["bytes"]

    collected: list[bytes] = []
    read_bytes = 0
    with open_archive_file(Path(location.path), relative) as handle:
        while read_bytes < min(total, MAX_PREVIEW_BYTES):
            chunk = handle.read(min(PREVIEW_CHUNK_BYTES, MAX_PREVIEW_BYTES - read_bytes))
            if not chunk:
                break
            collected.append(chunk)
            read_bytes += len(chunk)

    data = b"".join(collected)
    return {
        "text": data.decode("utf-8", errors="replace"),
        "media_kind": entry["media_kind"],
        "truncated": read_bytes < total,
        "total_bytes": total,
    }


def _split_reference(raw: str) -> tuple[str, str | None]:
    if "#" not in raw:
        return raw, None
    path, _, fragment = raw.partition("#")
    return path, fragment or None


def _is_external(target: str) -> bool:
    return target.lower().startswith(("http://", "https://"))


def _is_escaping(target: str) -> bool:
    if not target:
        return False
    if target.startswith(("/", "\\")):
        return True
    if ":" in target and len(target) > 1 and target[1] == ":":
        return True
    parts = target.replace("\\", "/").split("/")
    return ".." in parts


def _entry_for(relative: str, location: RunLocation, available: dict) -> dict | None:
    key = file_key_for(location.key, relative)
    entry = available.get(key)
    return entry


def resolve_reference(raw: str, current: RunLocation, catalog) -> dict:
    """Resuelve una referencia de origen sin salir de la raíz ni adivinar destinos."""

    result = {
        "raw": raw,
        "status": "missing",
        "run_key": None,
        "file_key": None,
        "fragment": None,
        "candidates": [],
    }
    if not isinstance(raw, str) or not raw.strip():
        return result

    target, fragment = _split_reference(raw.strip())
    result["fragment"] = fragment

    if _is_external(target):
        result["status"] = "external"
        result["candidates"] = [target]
        return result
    if _is_escaping(target):
        result["status"] = "outside_root"
        result["candidates"] = [target]
        return result

    available = {entry["key"]: entry for entry in list_files(current)}

    normalized = target.replace("\\", "/").strip("/")
    direct = _entry_for(normalized, current, available)
    if direct is not None:
        result.update(status="resolved", run_key=current.key, file_key=direct["key"])
        return result

    for location in catalog.locations():
        if location.key == current.key:
            continue
        prefix = location.relative_path + "/"
        if normalized.startswith(prefix):
            inner = _entry_for(normalized[len(prefix) :], location,
                               {entry["key"]: entry for entry in list_files(location)})
            if inner is not None:
                result.update(status="resolved", run_key=location.key, file_key=inner["key"])
                return result

    # El respaldo por nombre base sólo aplica a referencias sin directorio: una ruta
    # con componentes debe apuntar a su destino exacto o quedar sin resolver.
    if "/" not in normalized:
        matches = [
            entry
            for entry in available.values()
            if entry["name"] == PurePosixPath(normalized).name
        ]
        if len(matches) == 1:
            result.update(status="resolved", run_key=current.key, file_key=matches[0]["key"])
            return result
        if len(matches) > 1:
            result["status"] = "ambiguous"
            result["run_key"] = current.key
            result["candidates"] = sorted(entry["relative_path"] for entry in matches)
            return result

    result["candidates"] = [target]
    return result


def lineage_from(review: dict | None, closure: dict | None, catalog,
                 current: RunLocation, resolve) -> list[dict]:
    """Construye la lista de referencias de linaje declaradas por la fuente."""

    entries: list[tuple[str, str]] = []
    if isinstance(review, dict):
        for previous in (review.get("previous_reviews") if isinstance(review.get("previous_reviews"), list) else []):
            if isinstance(previous, dict):
                reference = previous.get("reference")
                if isinstance(reference, str):
                    entries.append((reference, "previous_reviews"))
        for row in (review.get("rereview") if isinstance(review.get("rereview"), list) else []):
            if isinstance(row, dict):
                reference = row.get("previous_reference")
                if isinstance(reference, str):
                    entries.append((reference, "rereview"))
    if isinstance(closure, dict):
        previous = closure.get("previous_run")
        if isinstance(previous, str):
            entries.append((previous, "previous_run"))

    lineage: list[dict] = []
    for raw, source in entries:
        resolved = resolve(raw, current, catalog)
        resolved["source"] = source
        lineage.append(resolved)
    return lineage
