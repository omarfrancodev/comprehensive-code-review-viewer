"""Verificación explícita y de solo lectura del archivo retenido.

Se comprueban hechos que el productor registró: marcador de propiedad, disposición
de versión, estados admitidos, inventario y hashes declarados, y el enlace con la
traza. Nada se repara, nada se reescribe y un hash ausente no se sustituye por el
calculado. La veracidad semántica de un hallazgo nunca se declara aquí.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

from .adapters import CLOSURE_SCHEMAS, CLOSURE_STATES, CLOSURE_STATES_SCHEMA_5
from .discovery import RunLocation, diagnostic
from .paths import UnsafePathError, open_archive_file
from .trace import parse_trace

__all__ = ["hash_regular_file", "validate_archive", "HASH_CHUNK_BYTES"]

HASH_CHUNK_BYTES = 1024 * 1024
_OWNERSHIP_MARKER = ".review-ownership.json"
_LAYOUT_FIELDS = ("repository_identity", "repository_key", "scope", "created_at", "run_id")
_TRACE_ARCHIVE_SCHEMAS = (4, 5)


def hash_regular_file(root: Path, relative: str) -> str:
    """Calcula el SHA-256 de un archivo leyéndolo en trozos acotados y verificados."""

    digest = hashlib.sha256()
    with open_archive_file(Path(root), relative) as handle:
        while True:
            chunk = handle.read(HASH_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _check(name: str, status: str, detail: str) -> dict:
    return {"name": name, "status": status, "detail": detail}


def _canonical(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
            + "\n").encode("utf-8")


def _allowed_states(schema: int) -> tuple[str, ...]:
    if schema == 5:
        return CLOSURE_STATES + CLOSURE_STATES_SCHEMA_5
    return CLOSURE_STATES


def _validate_ownership(root: Path, closure: dict, marker: Any) -> dict:
    name = _OWNERSHIP_MARKER
    if marker is None:
        return _check(name, "limited", "La corrida no conserva marcador de propiedad.")
    if not isinstance(marker, dict):
        return _check(name, "failed", "El marcador de propiedad no es un objeto válido.")

    problems: list[str] = []
    if marker.get("owner_id") != closure.get("owner_id"):
        problems.append("owner_id no coincide con el cierre")
    if marker.get("repository_key") != closure.get("repository_key"):
        problems.append("repository_key no coincide con el cierre")
    if marker.get("archive_root") != closure.get("archive_root"):
        problems.append("archive_root no coincide con el cierre")
    if marker.get("run_dir") != str(root):
        problems.append("run_dir no apunta a esta corrida")

    scope_digest = marker.get("scope_sha256")
    if scope_digest is not None and "scope" in closure:
        if scope_digest != hashlib.sha256(_canonical(closure.get("scope"))).hexdigest():
            problems.append("scope_sha256 no corresponde al alcance registrado")

    try:
        digest = hashlib.sha256((root / "cierre.json").read_bytes()).hexdigest()
    except OSError as error:
        return _check(name, "failed", "No se pudo leer cierre.json: " + str(error))
    recorded = {marker.get("manifest_sha256"), marker.get("previous_manifest_sha256")}
    if digest not in recorded:
        problems.append("cierre.json no coincide con el hash del marcador")

    if problems:
        return _check(name, "failed", "; ".join(problems))
    return _check(name, "passed", "El marcador de propiedad coincide con el cierre.")


def _validate_layout(closure: dict) -> dict:
    schema = closure.get("schema_version")
    missing = [field for field in _LAYOUT_FIELDS if not closure.get(field)]
    if missing:
        return _check(
            "layout",
            "failed",
            "Faltan campos de disposición del archivo: " + ", ".join(missing) + ".",
        )
    if isinstance(schema, int) and schema >= 3:
        return _check(
            "layout",
            "passed",
            f"El esquema de archivo {schema} vincula el directorio con su identidad.",
        )
    return _check(
        "layout",
        "limited",
        "El esquema de archivo no vincula la disposición al registro almacenado.",
    )


def _validate_state(closure: dict) -> dict:
    schema = closure.get("schema_version")
    state = closure.get("state")
    if not isinstance(schema, int) or schema not in CLOSURE_SCHEMAS:
        return _check(
            "cierre.json",
            "limited",
            f"Versión de archivo {schema!r} fuera del rango soportado; el estado "
            f"{state!r} se conserva sin validar.",
        )
    if not isinstance(state, str):
        return _check("cierre.json", "failed", "El cierre no declara un estado.")
    if state not in _allowed_states(schema):
        return _check(
            "cierre.json",
            "failed",
            f"El estado {state!r} no es válido para el esquema de archivo {schema}; "
            f"admitidos: {', '.join(_allowed_states(schema))}.",
        )
    return _check(
        "cierre.json",
        "passed",
        f"Estado {state!r} válido para el esquema de archivo {schema}.",
    )


def _validate_identity(closure: dict, review: Any) -> dict:
    run_id = closure.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        return _check("review.json", "limited", "El cierre no declara run_id verificable.")
    if review is None:
        return _check("review.json", "limited", "La corrida no tiene registro final.")
    if not isinstance(review, dict):
        return _check("review.json", "failed", "El registro final no es un objeto válido.")
    review_id = review.get("review_id")
    if review_id is None:
        return _check(
            "review.json",
            "limited",
            "El registro final no declara review_id (esquemas anteriores a 6).",
        )
    if review_id != "CR-" + run_id:
        return _check(
            "review.json",
            "failed",
            f"El review_id {review_id!r} no corresponde al run_id {run_id!r} del cierre.",
        )
    return _check("review.json", "passed", "El registro final está enlazado con la corrida.")


def _validate_inventory(root: Path, closure: dict) -> list[dict]:
    hashes = closure.get("hashes")
    if not isinstance(hashes, dict):
        return [_check("hashes", "limited", "El cierre no declara un inventario de hashes.")]
    checks = [_check("hashes", "passed", f"{len(hashes)} archivos declarados en el cierre.")]
    for name in sorted(hashes):
        expected = hashes[name]
        try:
            actual = hash_regular_file(root, name)
        except FileNotFoundError:
            checks.append(_check(name, "failed", "El archivo declarado no existe en la corrida."))
            continue
        except (UnsafePathError, OSError) as error:
            checks.append(_check(name, "failed", "No se pudo leer el archivo declarado: " + str(error)))
            continue
        if actual == expected:
            checks.append(_check(name, "passed", "El hash coincide con el declarado."))
        else:
            checks.append(
                _check(
                    name,
                    "failed",
                    "El hash calculado difiere del declarado; el visor no lo sustituye.",
                )
            )
    return checks


def _validate_trace(root: Path, closure: dict, data: bytes | None) -> dict:
    schema = closure.get("schema_version")
    name = "trazabilidad.jsonl"
    if not isinstance(schema, int) or schema not in _TRACE_ARCHIVE_SCHEMAS:
        return _check(name, "limited", "Este esquema no exige traza obligatoria.")
    if data is None:
        return _check(name, "failed", "La traza es obligatoria y no está presente.")
    descriptor = closure.get("trace")
    view = parse_trace(data, descriptor if isinstance(descriptor, dict) else None,
                       closure.get("run_id") if isinstance(closure.get("run_id"), str) else None)
    status = view["chain_status"]
    if status == "failed":
        return _check(name, "failed", f"La cadena de la traza no verifica: prefijo válido de {view['valid_prefix_length']} evento(s).")
    if status == "updating":
        return _check(name, "limited", "La traza pertenece a una corrida aún abierta.")
    if status == "limited":
        return _check(name, "limited", f"La traza se muestra con limitaciones ({view['valid_prefix_length']} evento(s) verificados).")
    return _check(name, "passed", f"Traza verificada con {view['valid_prefix_length']} evento(s).")


def validate_archive(location: RunLocation, snapshot: Mapping[str, Any]) -> dict:
    """Valida los hechos declarados por el archivo y devuelve un informe por niveles."""

    root = Path(location.path)
    files = snapshot.get("files") if isinstance(snapshot.get("files"), dict) else {}
    closure_raw = files.get("cierre.json", {}).get("data")
    marker_raw = files.get(".review-ownership.json", {}).get("data")
    review_raw = files.get("review.json", {}).get("data")

    checks: list[dict] = []
    diagnostics: list[dict] = []

    if not isinstance(closure_raw, dict):
        checks.append(_check("cierre.json", "failed", "El cierre no se pudo interpretar."))
        diagnostics.append(
            diagnostic("integrity.unreadable_closure", "error",
                       "La corrida no expone un cierre interpretable.", "cierre.json")
        )
        return {"status": "failed", "checks": checks, "diagnostics": diagnostics}

    closure = closure_raw
    schema = closure.get("schema_version")
    limited = False

    if not isinstance(schema, int):
        limited = True
        checks.append(
            _check("cierre.json", "limited", "Cierre histórico sin schema_version.")
        )
    else:
        checks.append(_validate_state(closure))

    checks.append(_validate_ownership(root, closure, marker_raw))
    checks.append(_validate_layout(closure))
    checks.append(_validate_identity(closure, review_raw))
    if isinstance(schema, int) and schema in _TRACE_ARCHIVE_SCHEMAS:
        raw_trace = files.get("trazabilidad.jsonl", {}).get("raw")
        checks.append(_validate_trace(root, closure, raw_trace if isinstance(raw_trace, bytes) else None))
    checks.extend(_validate_inventory(root, closure))

    if any(item["status"] == "failed" for item in checks):
        status = "failed"
    elif any(item["status"] == "limited" for item in checks) or limited:
        status = "limited"
    else:
        status = "verified"

    snapshot_codes = {item.get("code") for item in snapshot.get("diagnostics", [])}
    pending = closure.get("pending_trace") is not None or any(
        isinstance(closure.get("planned_hashes"), dict) and closure["planned_hashes"]
        and closure.get("state") == "retaining"
        for _ in (0,)
    )
    if pending or "snapshot.transition_pending" in snapshot_codes or snapshot.get("updating"):
        diagnostics.append(
            diagnostic(
                "integrity.updating",
                "info",
                "La corrida está en una transición declarada; el resultado no es un "
                "veredicto final sobre el archivo.",
                "cierre.json",
            )
        )
        status = "updating"

    if any(item.get("code") == "snapshot.duplicate_keys" for item in snapshot.get("diagnostics", [])):
        status = "limited" if status == "verified" else status
        diagnostics.append(
            diagnostic(
                "integrity.repeated_keys",
                "warning",
                "La metadata repite claves JSON; la verificación de integridad completa "
                "queda desactivada.",
                "cierre.json",
            )
        )

    return {"status": status, "checks": checks, "diagnostics": diagnostics}