"""Lecturas coherentes y acotadas de la metadata de una corrida.

Una sustitución atómica de un archivo individual no vuelve transaccional al
directorio completo. Por eso se releen los marcadores de cierre antes y después,
se reintenta un número acotado de veces y, si la transición continúa, se conserva
la última instantánea coherente y se expone ``updating``. Nunca se invoca
recuperación del productor ni se altera su marcador.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

from .discovery import RunLocation, diagnostic
from .paths import UnsafePathError, open_archive_file

__all__ = [
    "read_snapshot",
    "read_bounded",
    "TooLargeError",
    "OWNERSHIP_MARKER",
    "METADATA_FILES",
    "MAX_METADATA_BYTES",
    "MAX_TRACE_BYTES",
    "MAX_TRACE_EVENTS",
    "MAX_STABLE_READ_ATTEMPTS",
    "STABLE_READ_DELAY_SECONDS",
    "READ_CHUNK_BYTES",
]

OWNERSHIP_MARKER = ".review-ownership.json"
CLOSURE_FILE = "cierre.json"
REVIEW_FILE = "review.json"
REPORT_FILE = "informe.md"
TRACE_FILE = "trazabilidad.jsonl"

METADATA_FILES = (OWNERSHIP_MARKER, CLOSURE_FILE, REVIEW_FILE, REPORT_FILE, TRACE_FILE)

MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_TRACE_BYTES = 8 * 1024 * 1024
MAX_TRACE_EVENTS = 10000
MAX_STABLE_READ_ATTEMPTS = 3
STABLE_READ_DELAY_SECONDS = 0.05
READ_CHUNK_BYTES = 1024 * 1024

_LIMITS = {
    REVIEW_FILE: MAX_METADATA_BYTES,
    CLOSURE_FILE: MAX_METADATA_BYTES,
    OWNERSHIP_MARKER: MAX_METADATA_BYTES,
    REPORT_FILE: MAX_METADATA_BYTES,
    TRACE_FILE: MAX_TRACE_BYTES,
}


class TooLargeError(Exception):
    """El archivo supera el límite de entrada permitido; no llega a interpretarse."""

    def __init__(self, relative: str, limit: int) -> None:
        super().__init__(f"{relative} excede {limit} bytes")
        self.relative = relative
        self.limit = limit


def read_bounded(root: Path, relative: str, limit: int) -> bytes | None:
    """Lee un archivo del archivo sin superar ``limit``; ``None`` si no existe."""

    chunks: list[bytes] = []
    total = 0
    try:
        with open_archive_file(root, relative) as handle:
            while True:
                chunk = handle.read(READ_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise TooLargeError(relative, limit)
                chunks.append(chunk)
    except FileNotFoundError:
        return None
    except UnsafePathError:
        raise
    return b"".join(chunks)


class _DuplicateKeys(ValueError):
    pass


class _ConstantNotAllowed(ValueError):
    pass


def _unique_pairs(pairs: list[tuple[str, Any]]) -> dict:
    result: dict = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKeys(key)
        result[key] = value
    return result


def _reject_constant(name: str) -> Any:
    raise _ConstantNotAllowed(name)


def _stat_signature(path: Path) -> tuple | None:
    try:
        status = os.lstat(path)
    except OSError:
        return None
    return (status.st_size, status.st_mtime_ns)


def _file_snapshot(data: bytes | None, parsed: Any) -> dict:
    return {
        "present": data is not None,
        "size": len(data) if data is not None else 0,
        "data": parsed,
        "raw": data,
    }


def _read_one(root: Path, relative: str, *, parse_json: bool) -> tuple[dict, list[dict]]:
    """Lee un archivo de metadata y devuelve su instantánea más sus diagnósticos."""

    diagnostics: list[dict] = []
    try:
        data = read_bounded(root, relative, _LIMITS[relative])
    except TooLargeError:
        diagnostics.append(
            diagnostic(
                "snapshot.too_large",
                "error",
                f"El archivo {relative} excede el límite de {_LIMITS[relative]} bytes "
                "y no se interpretó.",
                relative,
            )
        )
        return _file_snapshot(None, None), diagnostics
    except UnsafePathError as error:
        diagnostics.append(
            diagnostic("snapshot.unreadable_file", "warning", str(error), relative)
        )
        return _file_snapshot(None, None), diagnostics

    if data is None:
        return _file_snapshot(None, None), diagnostics
    if not parse_json:
        return _file_snapshot(data, None), diagnostics

    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        diagnostics.append(
            diagnostic(
                "snapshot.invalid_encoding",
                "error",
                f"El archivo {relative} no es UTF-8 válido.",
                relative,
            )
        )
        return _file_snapshot(data, None), diagnostics

    try:
        parsed = json.loads(
            text,
            parse_constant=_reject_constant,
            object_pairs_hook=_unique_pairs,
        )
    except _DuplicateKeys:
        diagnostics.append(
            diagnostic(
                "snapshot.duplicate_keys",
                "error",
                f"El archivo {relative} repite claves JSON; se desactiva la verificación "
                "de integridad completa de esta corrida.",
                relative,
            )
        )
        return _file_snapshot(data, None), diagnostics
    except _ConstantNotAllowed:
        diagnostics.append(
            diagnostic(
                "snapshot.invalid_constant",
                "error",
                f"El archivo {relative} contiene NaN o Infinity, que JSON no representa.",
                relative,
            )
        )
        return _file_snapshot(data, None), diagnostics
    except ValueError:
        diagnostics.append(
            diagnostic(
                "snapshot.invalid_json",
                "error",
                f"El archivo {relative} no es JSON válido.",
                relative,
            )
        )
        return _file_snapshot(data, None), diagnostics

    return _file_snapshot(data, parsed), diagnostics


def _closure_signature(root: Path) -> tuple:
    return tuple(
        (name, _stat_signature(root / name)) for name in (OWNERSHIP_MARKER, CLOSURE_FILE)
    )


def _transition_marker(files: dict) -> str | None:
    """Detecta los marcadores de transición del productor, sin clearing ni recuperación."""

    closure = files[CLOSURE_FILE]["data"]
    if not isinstance(closure, dict):
        return None
    if closure.get("pending_trace") is not None:
        return "pending_trace"
    planned = closure.get("planned_hashes")
    if isinstance(planned, dict) and planned and closure.get("state") == "retaining":
        return "planned_hashes"
    return None


def _read_metadata(root: Path) -> tuple[dict, list[dict]]:
    files: dict[str, dict] = {}
    diagnostics: list[dict] = []
    for relative in METADATA_FILES:
        snapshot, issues = _read_one(root, relative, parse_json=relative.endswith(".json"))
        files[relative] = snapshot
        diagnostics.extend(issues)

    if not files[OWNERSHIP_MARKER]["present"]:
        diagnostics.append(
            diagnostic(
                "snapshot.missing_ownership",
                "warning",
                "La corrida no tiene marcador de propiedad; la identidad del conjunto "
                "queda sin verificar.",
                OWNERSHIP_MARKER,
            )
        )

    review = files[REVIEW_FILE]["data"]
    verdict = review.get("verdict") if isinstance(review, dict) else None
    files[REVIEW_FILE]["verdict"] = verdict if isinstance(verdict, str) else None
    files[REVIEW_FILE]["schema_version"] = (
        review.get("schema_version") if isinstance(review, dict) else None
    )

    closure = files[CLOSURE_FILE]["data"]
    files[CLOSURE_FILE]["schema_version"] = (
        closure.get("schema_version") if isinstance(closure, dict) else None
    )
    files[CLOSURE_FILE]["state"] = closure.get("state") if isinstance(closure, dict) else None

    if files[TRACE_FILE]["present"]:
        event_count = files[TRACE_FILE]["raw"].count(b"\n")
        if event_count > MAX_TRACE_EVENTS:
            diagnostics.append(
                diagnostic(
                    "snapshot.too_many_events",
                    "warning",
                    f"La traza declara {event_count} eventos; se muestran los "
                    f"{MAX_TRACE_EVENTS} primeros.",
                    TRACE_FILE,
                )
            )
    return files, diagnostics


def _fingerprint(files: dict) -> str:
    digest = hashlib.sha256()
    for name in sorted(METADATA_FILES):
        snapshot = files.get(name, {})
        digest.update(name.encode("utf-8"))
        digest.update(b"\x00")
        digest.update(str(snapshot.get("size", 0)).encode("ascii"))
        digest.update(b"\x00")
        raw = snapshot.get("raw")
        digest.update(hashlib.sha256(raw).digest() if isinstance(raw, bytes) else b"\x00")
    return digest.hexdigest()


def read_snapshot(location: RunLocation, *, previous: dict | None = None) -> dict:
    """Lee la metadata de una corrida devolviendo una instantánea coherente o en transición."""

    root = Path(location.path)
    diagnostics: list[dict] = []
    files: dict[str, dict] = {}

    for attempt in range(MAX_STABLE_READ_ATTEMPTS):
        before = _closure_signature(root)
        attempt_files, attempt_diagnostics = _read_metadata(root)
        after = _closure_signature(root)
        marker = _transition_marker(attempt_files)

        if before == after and marker is None:
            files = attempt_files
            diagnostics = attempt_diagnostics
            return {
                "files": files,
                "fingerprint": _fingerprint(files),
                "updating": False,
                "diagnostics": diagnostics,
            }

        files = attempt_files
        diagnostics = list(attempt_diagnostics)
        if marker is not None:
            diagnostics.append(
                diagnostic(
                    "snapshot.transition_pending",
                    "info",
                    f"La corrida está en una transición declarada por {marker}; "
                    "el visor espera a que el productor la complete.",
                    CLOSURE_FILE,
                )
            )
        else:
            diagnostics.append(
                diagnostic(
                    "snapshot.transition_detected",
                    "info",
                    "Los marcadores de la corrida cambiaron mientras se leía.",
                    CLOSURE_FILE,
                )
            )
        if attempt + 1 < MAX_STABLE_READ_ATTEMPTS:
            time.sleep(STABLE_READ_DELAY_SECONDS)

    if previous is not None:
        retained = dict(previous)
        retained["updating"] = True
        retained["diagnostics"] = list(previous.get("diagnostics", [])) + diagnostics
        return retained

    return {
        "files": files,
        "fingerprint": _fingerprint(files),
        "updating": True,
        "diagnostics": diagnostics,
    }