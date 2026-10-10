"""Generador de archivos de revisión sintéticos y públicos.

Reproduce las formas que declara el productor fijado en v2.9.0
(commit 7828852aaab390ebfeca78b229964f0b04af82d8) sin importar la skill instalada
ni copiar contenido real. Todos los valores son visiblesmente sintéticos.
"""

from __future__ import annotations

import hashlib
import json
import os

from pathlib import Path

__all__ = [
    "VARIANTS",
    "build_archive",
    "with_overrides",
    "archive_inventory",
    "trace_event_bytes",
    "canonical_json_bytes",
    "RUN_ID",
    "REVIEW_ID",
    "OWNER_ID",
]

REVIEW_ID = "CR-1111111111111111aaaa"
RUN_ID = "1111111111111111aaaa"
REPOSITORY_IDENTITY = "git.example.invalid/acme/demo-app.git"
REPOSITORY_KEY = "0123456789abcdef0123"
ARCHIVE_GROUP = "acme-demo-app-0123456789abcdef0123"
SCOPE_SLUG = "pr-42-a1b2c3d4e5f60718"
OWNER_ID = "0123456789abcdef0123456789abcdef"
CREATED_AT = "2026-09-01T12:00:00+00:00"
RUN_DIR_NAME = "20260901T120000-" + RUN_ID

_HELPER_KINDS = {"prepare", "register", "retain", "validation", "handoff", "close"}


def canonical_json_bytes(value: object) -> bytes:
    """Bytes canónicos de metadata del productor: ordenados, indentados y con salto final."""

    text = json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
    return (text + "\n").encode("utf-8")


def trace_encoded(value: object) -> bytes:
    """Serialización canónica de un evento de traza: claves ordenadas, separadores compactos."""

    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def _digest(value: object) -> str:
    return hashlib.sha256(trace_encoded(value)).hexdigest()


def _scope() -> dict:
    return {
        "repository": REPOSITORY_IDENTITY,
        "mode": "pr",
        "base": "main",
        "head": "9f1c2b7d4e5a6f708192a3b4c5d6e7f809102030",
        "snapshot": None,
        "target": "demo-app",
        "reference": "42",
    }


def _milestone(
    kind: str,
    status: str,
    summary: str,
    occurred_at: str | None,
    source: str | None = None,
) -> dict:
    """Hito sintético con la identidad que el productor le asigna a ese tipo de evento."""

    helper = kind in _HELPER_KINDS
    return {
        "kind": kind,
        "status": status,
        "summary": summary,
        "actor": {
            "kind": "helper" if helper else "coordinator",
            "name": "review_artifacts" if helper else "coordinator",
            "provider_id": None,
        },
        "executor": None,
        "provenance": {"kind": "helper" if helper or source else "agent", "source": source},
        "occurred_at": occurred_at,
        "evidence": [],
        "relations": [],
        "authority": None,
    }


def trace_event_bytes(milestones: list[dict], run_id: str = RUN_ID) -> tuple[bytes, dict]:
    """Construye una traza de esquema 1 encadenada y su descriptor de cierre."""

    data = b""
    previous: str | None = None
    descriptor = {"schema_version": 1, "events": 0, "last_sha256": None}
    for sequence, milestone in enumerate(milestones, start=1):
        event = dict(milestone)
        event.update(
            schema_version=1,
            sequence=sequence,
            event_id="E" + str(sequence).zfill(6),
            run_id=run_id,
            review_id="CR-" + run_id,
            recorded_at=CREATED_AT,
            recorder={"kind": "helper", "name": "review_artifacts", "provider_id": None},
            previous_sha256=previous,
        )
        event["sha256"] = _digest(event)
        previous = event["sha256"]
        descriptor = {"schema_version": 1, "events": sequence, "last_sha256": previous}
        data += trace_encoded(event) + b"\n"
    return data, descriptor


def _finding(finding_id: str, status: str, priority: str) -> dict:
    return {
        "id": finding_id,
        "type": "code",
        "status": status,
        "priority": priority,
        "blocking": False,
        "blocking_reason": None,
        "origin": "introduced",
        "title": "Validación de entrada ausente en el borde público sintético",
        "location": {
            "path": "src/demo/handler.py",
            "line": 42,
            "url": None,
            "section": None,
        },
        "scenario": "Una petición externa envía un valor fuera del rango declarado.",
        "impact": "El borde acepta una entrada no prevista y la propaga al lector interno.",
        "evidence": [
            {
                "kind": "static",
                "details": "El parámetro se usa sin comparación previa en el borde.",
                "check_id": None,
            }
        ],
        "correction": "Comparar el valor recibido con el rango declarado antes de usarlo.",
    }


def _check() -> dict:
    return {
        "id": "C001",
        "command": "python -m unittest discover -s tests",
        "revision": "9f1c2b7d4e5a6f708192a3b4c5d6e7f809102030",
        "status": "passed",
        "failure_kind": None,
        "evidence": "Suite sintética: 3 pruebas, 0 fallos.",
        "reused": False,
        "reuse_reason": None,
        "rerun_reason": None,
    }


#: Perfil canónico por generación de esquema (result-contract, campos de sólo registro final).
_PROFILES = {
    3: "economy",
    4: "balanced",
    5: "extended",
    6: "balanced",
    7: "extended",
    99: "extended",
}


def _review(schema_version: int) -> dict:
    """Registro final sintético con los campos exigidos por su generación de esquema."""

    record: dict = {
        "schema_version": schema_version,
        "stage": "final",
        "scope": _scope(),
        "profile": _PROFILES.get(schema_version, "economy"),
        "profile_reason": "Perfil sintético declarado por el plan de revisión.",
        "findings": [_finding("F001", "confirmed", "P2"), _finding("F002", "rejected", "P3")],
        "checks": [_check()],
        "coverage": {
            "flows": ["Petición de lectura pública"],
            "limitations": {"details": "Sin entorno de ejecución real.", "material": False},
            "adequate": True,
            "stale": False,
            "verification": "independent",
            "areas": [
                {
                    "area": letter,
                    "status": "covered",
                    "details": "Revisión estática sintética del área " + letter + ".",
                    "material": False,
                    "finding_ids": ["F001"] if letter == "A" else [],
                }
                for letter in "ABCDE"
            ],
        },
        "verdict": "approvable_with_reservations",
        "verdict_reason": "Hallazgo no bloqueante corregible antes de publicar.",
        "reservations": ["El borde público acepta valores fuera de rango."],
        "responsible": {
            "name": "Persona responsable sintética",
            "username": "usuario.demo",
            "source": "merge_request",
            "verified": True,
        },
        "description": {
            "status": "unverified",
            "identity": None,
            "details": "Descripción no verificada en la revisión sintética.",
        },
        "resources": {
            "cleanup": "not_needed",
            "residuals": [],
            "publication": "not_requested",
        },
        "aliases": {},
    }

    if schema_version >= 3:
        record["change_authors"] = [
            {
                "name": "Autora sintética",
                "username": None,
                "source": "commit",
                "verified": False,
                "commits": ["9f1c2b7d4e5a6f708192a3b4c5d6e7f809102030"],
            }
        ]
    if schema_version >= 4:
        record["presentation"] = {
            "kind": "review",
            "subject": "Revisión sintética de validación de entrada",
        }
    if schema_version >= 6:
        record["checks"][0]["reference"] = "evidence/check-output.txt"
        record["review_id"] = REVIEW_ID
        record["previous_reviews"] = []
        record["grandfathered_ids"] = {"findings": [], "checks": []}
        record["rereview"] = []
    return record


#: Configuración por variante canónica.
_VARIANTS: dict[str, dict] = {
    "final_v7": {"review_schema": 7, "archive_schema": 5, "state": "complete"},
    "legacy_v3": {"review_schema": 3, "archive_schema": 2, "state": "complete"},
    "legacy_v5": {"review_schema": 5, "archive_schema": 3, "state": "complete"},
    "schema_less": {"review_schema": 5, "archive_schema": None, "state": "complete"},
    "unknown_v99": {"review_schema": 99, "archive_schema": 99, "state": "future_state"},
    "corrupt_json": {"review_schema": 7, "archive_schema": 5, "state": "complete"},
    "rereview_v7": {"review_schema": 7, "archive_schema": 5, "state": "complete"},
    "prepared_archive_v5": {"review_schema": None, "archive_schema": 5, "state": "prepared"},
    "processing_archive_v5": {"review_schema": None, "archive_schema": 5, "state": "processing"},
    "legacy_archive_v4": {"review_schema": None, "archive_schema": 4, "state": "prepared"},
    "complete_archive_v4": {"review_schema": 7, "archive_schema": 4, "state": "complete"},
    "invalid_processing_archive_v4": {
        "review_schema": None,
        "archive_schema": 4,
        "state": "processing",
    },
    "pending_trace_archive_v5": {"review_schema": None, "archive_schema": 5, "state": "processing"},
}

VARIANTS = tuple(sorted(_VARIANTS)) + ("prepared",)


def _milestones_for(state: str, variant: str) -> list[dict]:
    milestones = [_milestone("prepare", "completed", "Archivo sintético preparado", None)]
    if variant in {"processing_archive_v5", "pending_trace_archive_v5"}:
        milestones.append(
            _milestone(
                "discovery",
                "started",
                "Descubrimiento estático sintético iniciado",
                "2026-09-01T12:00:05+00:00",
            )
        )
    if state == "complete":
        milestones.append(
            _milestone(
                "check", "passed", "Comprobación sintética ejecutada", "2026-09-01T12:00:09+00:00"
            )
        )
        milestones.append(_milestone("close", "completed", "Cierre sintético observado", None))
    return milestones


def with_overrides(variant: str, *overrides: str):
    """Devuelve un constructor de esa variante con ajustes manuales aplicados."""

    def builder(root: Path) -> Path:
        return build_archive(root, variant, overrides)

    return builder


def build_archive(root: Path, variant: str, overrides: tuple[str, ...] = ()) -> Path:
    """Construye una corrida sintética dentro de ``root`` y devuelve su ruta."""

    if variant == "prepared":
        return _build_legacy_prepared(root)
    config = _VARIANTS.get(variant)
    if config is None:
        raise ValueError("variante sintética desconocida: " + variant)
    overrides = overrides + ("corrupt_review",) if variant == "corrupt_json" else overrides
    previous_run = _override_value(overrides, "previous_run")
    identity = _override_value(overrides, "repository") or REPOSITORY_IDENTITY
    group_name = (
        ARCHIVE_GROUP
        if identity == REPOSITORY_IDENTITY
        else identity.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git") + "-" + REPOSITORY_KEY
    )

    archive_root = Path(root).resolve()
    group = archive_root / group_name / SCOPE_SLUG
    group.mkdir(parents=True, exist_ok=True)
    run = group / RUN_DIR_NAME
    suffix = 0
    while run.exists():
        suffix += 1
        run = group / (RUN_DIR_NAME + "-" + str(suffix))
    run.mkdir()
    (run / "evidence").mkdir()

    scope = {} if "no_scope" in overrides else _scope()
    archive_schema = config["archive_schema"]
    state = config["state"]
    review_schema = config["review_schema"]

    closure: dict = {
        "schema_version": archive_schema,
        "skill_version": "2.9.0",
        "harness": "claude-code",
        "scope": scope,
        "archive_root": str(archive_root),
        "repository_path": str(archive_root),
        "repository_key": REPOSITORY_KEY,
        "repository_identity": identity,
        "previous_run": previous_run,
        "owner_id": OWNER_ID,
        "created_at": CREATED_AT,
        "run_id": RUN_ID,
        "state": state,
        "retained": review_schema is not None,
        "cleanup": "not_needed" if state == "complete" else "pending",
        "residuals": [],
        "temporary_paths": [],
        "temporary_manifests": [],
        "executors": [],
        "hashes": {},
    }

    if archive_schema in (4, 5) and "no_traces" not in overrides:
        data, descriptor = trace_event_bytes(_milestones_for(state, variant))
        (run / "trazabilidad.jsonl").write_bytes(data)
        closure["trace"] = descriptor
        closure["hashes"]["trazabilidad.jsonl"] = hashlib.sha256(data).hexdigest()

    if variant == "pending_trace_archive_v5":
        closure["pending_trace"] = {
            "trace": {"schema_version": 1, "events": 2, "last_sha256": None},
            "sha256": None,
            "event": {"kind": "discovery", "status": "started"},
        }

    if review_schema is not None:
        review = _review(review_schema)
        if variant == "rereview_v7":
            review["rereview"] = [
                {
                    "status": "resolved",
                    "details": "Corregido en la corrida actual.",
                    "previous_review_id": "CR-0000000000000000bbbb",
                    "previous_reference": "archivo/anterior",
                    "previous_finding_id": "F001",
                    "previous_title": "Validación de entrada ausente en el borde público sintético",
                    "previous_url": None,
                    "check_ids": ["C001"],
                }
            ]
            review["previous_reviews"] = [
                {"review_id": "CR-0000000000000000bbbb",
                 "reference": "archivo/anterior",
                 "verified": True}
            ]
        if "mismatched_review_id" in overrides and "review_id" in review:
            review["review_id"] = "CR-9999999999999999zzzz"
        if variant == "unknown_v99":
            review["campo_futuro"] = {"estado": "desconocido"}
            review["presentation"] = {"kind": "revision-futura", "subject": "Asunto futuro"}
        review_bytes = _encode_review(review, overrides)
        (run / "review.json").write_bytes(review_bytes)
        closure["hashes"]["review.json"] = hashlib.sha256(review_bytes).hexdigest()
        (run / "informe.md").write_bytes(b"# Informe de revision sintetica\n\nVeredicto de la fuente.\n")
        closure["hashes"]["informe.md"] = hashlib.sha256((run / "informe.md").read_bytes()).hexdigest()

    for name in ("evidence/context.json", "evidence/notes.json", "evidence/check-output.txt"):
        (run / name).write_bytes(_evidence_file(name))
        closure["hashes"][name] = hashlib.sha256((run / name).read_bytes()).hexdigest()

    if "missing_evidence" in overrides:
        (run / "evidence/notes.json").unlink()
    if "mismatched_evidence" in overrides:
        (run / "evidence/notes.json").write_bytes(b'{"sintetico": true, "alterado": true}')

    if "bad_closure_json" in overrides:
        (run / "cierre.json").write_bytes(b"{ no es json")
        return run

    _write_closure(run, closure, write_marker="no_ownership" not in overrides)
    if "bad_marker" in overrides:
        marker = json.loads((run / ".review-ownership.json").read_text(encoding="utf-8"))
        marker["owner_id"] = "f" * 32
        (run / ".review-ownership.json").write_bytes(canonical_json_bytes(marker))
    return run


def _encode_review(review: dict, overrides: tuple[str, ...]) -> bytes:
    """Serializa el registro final aplicando, si se piden, las variantes de entrada."""

    if "oversized" in overrides:
        return b'{"pad": "' + b"x" * (9 * 1024 * 1024) + b'"}'
    if "corrupt_review" in overrides:
        return b'{"schema_version": 7, "findings": [ '
    data = canonical_json_bytes(review)
    if "bom" in overrides:
        return b"\xef\xbb\xbf" + data
    if "nan" in overrides:
        return data.replace(b'"material": false', b'"material": NaN', 1)
    if "duplicate_keys" in overrides:
        return data.replace(
            b'"schema_version": 7,', b'"schema_version": 7,\n  "schema_version": 7,', 1
        )
    return data


def _override_value(overrides: tuple[str, ...], name: str) -> str | None:
    """Devuelve el valor de un override con forma ``nombre=valor``."""

    prefix = name + "="
    for override in overrides:
        if override.startswith(prefix):
            return override[len(prefix) :]
    return None


def _evidence_file(name: str) -> bytes:
    return json.dumps(
        {"sintetico": True, "archivo": name},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _write_closure(run: Path, closure: dict, *, write_marker: bool = True) -> None:
    data = canonical_json_bytes(closure)
    (run / "cierre.json").write_bytes(data)
    if not write_marker:
        return
    (run / ".review-ownership.json").write_bytes(
        canonical_json_bytes(
            {
                "owner_id": closure["owner_id"],
                "run_dir": str(run),
                "archive_root": closure["archive_root"],
                "repository_key": closure["repository_key"],
                "scope_sha256": hashlib.sha256(canonical_json_bytes(closure["scope"])).hexdigest(),
                "manifest_sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    )


def _build_legacy_prepared(root: Path) -> Path:
    """Corrida histórica con nombre de carpeta antiguo y sin registro final."""

    archive_root = Path(root).resolve()
    target = archive_root / "demo-app-20260901-120000"
    suffix = 0
    while target.exists():
        suffix += 1
        target = archive_root / ("demo-app-20260901-120000-" + str(suffix))
    target.mkdir(parents=True)
    (target / "evidence").mkdir()

    data, descriptor = trace_event_bytes(
        [_milestone("prepare", "completed", "Archivo historico sintetico preparado", None)]
    )
    (target / "trazabilidad.jsonl").write_bytes(data)
    closure = {
        "version": "2.9.0",
        "harness": "claude-code",
        "repository": REPOSITORY_IDENTITY,
        "repository_key": REPOSITORY_KEY,
        "owner_id": OWNER_ID,
        "run_id": RUN_ID,
        "review_id": None,
        "scope": _scope(),
        "created_at": CREATED_AT,
        "state": "prepared",
        "cleanup": "pending",
        "archive_root": str(archive_root),
        "trace": descriptor,
    }
    _write_closure(target, closure)
    (target / "evidence/context.json").write_bytes(_evidence_file("evidence/context.json"))
    return target


def archive_inventory(root: Path) -> dict[str, tuple[int, str, int]]:
    """Huella de cada archivo: tamaño en bytes, SHA-256 del contenido y ``mtime_ns``."""

    inventory: dict[str, tuple[int, str, int]] = {}
    for path in sorted(Path(root).rglob("*")):
        if path.is_symlink() or not path.is_file():
            continue
        data = path.read_bytes()
        status = os.lstat(path)
        inventory[path.relative_to(root).as_posix()] = (
            len(data),
            hashlib.sha256(data).hexdigest(),
            status.st_mtime_ns,
        )
    return inventory

# --- Transiciones del productor de prueba ----------------------------------
#
# Estas funciones escriben en el archivo sintético como lo haría el productor.
# Son un productor de prueba, no lógica del visor: el visor nunca llama a esto.

_TRANSICIONES = ("prepare_to_discovery", "add_check", "transient_retention",
                 "retained_then_closed")


def _leer_cierre(run: Path) -> dict:
    return json.loads((run / "cierre.json").read_text(encoding="utf-8"))


def _escribir_cierre(run: Path, closure: dict) -> None:
    data = canonical_json_bytes(closure)
    (run / "cierre.json").write_bytes(data)
    marker_path = run / ".review-ownership.json"
    if not marker_path.exists():
        return
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    marker["manifest_sha256"] = hashlib.sha256(data).hexdigest()
    marker.pop("previous_manifest_sha256", None)
    marker_path.write_bytes(canonical_json_bytes(marker))


def _anexar_hito(run: Path, closure: dict, milestone: dict) -> dict:
    """Añade un hito a la traza y actualiza el descriptor del cierre."""

    data = run / "trazabilidad.jsonl"
    existente = data.read_bytes() if data.exists() else b""
    data_nuevo, descriptor = trace_event_bytes(
        _leer_hitos(existente) + [milestone], RUN_ID
    )
    data.write_bytes(data_nuevo)
    closure["trace"] = descriptor
    closure["hashes"]["trazabilidad.jsonl"] = hashlib.sha256(data_nuevo).hexdigest()
    return closure


def _leer_hitos(data: bytes) -> list[dict]:
    """Quita los campos de sistema para volver a la forma de entrada del productor."""

    hitos = []
    for linea in data.splitlines():
        if not linea.strip():
            continue
        valor = json.loads(linea)
        hitos.append({clave: valor[clave] for clave in valor
                      if clave not in {"schema_version", "sequence", "event_id", "run_id",
                                       "review_id", "recorded_at", "recorder",
                                       "previous_sha256", "sha256"}})
    return hitos


def advance_fixture(run: Path, transition: str) -> None:
    """Aplica una transición sintética del productor sobre la corrida indicada."""

    if transition not in _TRANSICIONES:
        raise ValueError("transición desconocida: " + transition)
    closure = _leer_cierre(run)

    if transition == "prepare_to_discovery":
        closure["state"] = "processing"
        _anexar_hito(run, closure, _milestone(
            "discovery", "started", "Descubrimiento estático sintético iniciado",
            "2026-09-01T12:05:00+00:00"))
    elif transition == "add_check":
        closure["state"] = "processing"
        _anexar_hito(run, closure, _milestone(
            "check", "passed", "Comprobación sintética ejecutada",
            "2026-09-01T12:06:00+00:00"))
    elif transition == "transient_retention":
        # Declara una intención pendiente sin ejecutarla: el visor no debe
        # consumarla ni recuperarla.
        closure["state"] = "retaining"
        closure["planned_hashes"] = {"evidence/pendiente.json": "0" * 64}
        closure["pending_trace"] = {
            "trace": closure.get("trace", {"schema_version": 1, "events": 0, "last_sha256": None}),
            "sha256": None,
            "event": {"kind": "retain", "status": "completed"},
        }
    elif transition == "retained_then_closed":
        # Se observan las dos fases por separado: cerrar no es completar.
        closure.pop("planned_hashes", None)
        closure.pop("pending_trace", None)
        closure["state"] = "closing"
        closure["cleanup"] = "pending"
        _escribir_cierre(run, closure)
        closure["state"] = "complete"
        closure["cleanup"] = "not_needed"
        closure["retained"] = True
        _anexar_hito(run, closure, _milestone(
            "close", "completed", "Cierre sintético observado", None))
        _escribir_cierre(run, closure)
        return

    _escribir_cierre(run, closure)
