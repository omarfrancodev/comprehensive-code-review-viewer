"""Adaptador de presentación y catálogo en memoria.

Conserva los objetos de origen tal cual y sólo expone un modelo estable para la
interfaz. Una versión de esquema desconocida permanece en la respuesta y obliga a
compatibilidad ``limited``: nunca se descarta ni se reinterpreta.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Mapping

from .discovery import RunLocation, diagnostic, discover_runs
from .snapshots import read_snapshot

__all__ = [
    "API_VERSION",
    "Catalog",
    "adapt_run",
    "normalize_repository_identity",
    "finding_counts",
    "REVIEW_SCHEMAS",
    "CLOSURE_SCHEMAS",
    "CLOSURE_STATES",
    "CLOSURE_STATES_SCHEMA_5",
    "PAGE_SIZE",
]

API_VERSION = 1

REVIEW_SCHEMAS = (1, 2, 3, 4, 5, 6, 7)
CURRENT_REVIEW_SCHEMA = 7
CLOSURE_SCHEMAS = (1, 2, 3, 4, 5)
CURRENT_CLOSURE_SCHEMA = 5
CLOSURE_STATES = ("prepared", "retaining", "closing", "complete")
CLOSURE_STATES_SCHEMA_5 = ("processing",)
PRIORITIES = ("P0", "P1", "P2", "P3")
PAGE_SIZE = 50

FINAL_ARCHIVE_STATES = ("closing", "complete")


def normalize_repository_identity(identity: str | None) -> str | None:
    """Prepara una identidad de repositorio sólo para comparar, nunca para mostrar.

    Se quita el esquema HTTPS opcional y el sufijo terminal ``.git``. Se conservan
    el host y el espacio de nombres completo: dos repositorios nunca se agrupan
    sólo por el nombre base.
    """

    if not isinstance(identity, str):
        return None
    value = identity.strip()
    for scheme in ("https://", "http://", "ssh://", "git://"):
        if value.lower().startswith(scheme):
            value = value[len(scheme) :]
            break
    if value.endswith(".git"):
        value = value[: -len(".git")]
    return value.rstrip("/") or None


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def finding_counts(review: dict | None) -> dict:
    """Cuenta hallazgos confirmados por prioridad y separa los demás estados."""

    counts = {
        "confirmed": {priority: 0 for priority in PRIORITIES},
        "confirmed_unknown_priority": 0,
        "unresolved": 0,
        "rejected": 0,
        "candidate": 0,
    }
    if not isinstance(review, dict):
        return counts
    findings = review.get("findings")
    if not isinstance(findings, list):
        return counts
    for finding in findings:
        if not isinstance(finding, dict):
            continue
        status = finding.get("status")
        if status == "confirmed":
            priority = finding.get("priority")
            if priority in counts["confirmed"]:
                counts["confirmed"][priority] += 1
            else:
                counts["confirmed_unknown_priority"] += 1
        elif status in counts and status != "confirmed":
            counts[status] += 1
    return counts


def _scope_label(scope: Any) -> str | None:
    scope = _as_dict(scope)
    mode = scope.get("mode")
    if not isinstance(mode, str) or not mode:
        return None
    reference = scope.get("reference")
    if isinstance(reference, str) and reference:
        return f"{mode} {reference}"
    target = scope.get("target")
    if isinstance(target, str) and target:
        return f"{mode} {target}"
    return mode


def _allowed_states(schema: int) -> tuple[str, ...]:
    if schema == CURRENT_CLOSURE_SCHEMA:
        return CLOSURE_STATES + CLOSURE_STATES_SCHEMA_5
    return CLOSURE_STATES


def _closure_state_issue(closure: Any) -> dict | None:
    """Valida el estado frente a la versión real del archivo, no a la actual."""

    closure = _as_dict(closure)
    if not closure:
        return None
    schema = closure.get("schema_version")
    state = closure.get("state")
    if not isinstance(schema, int) or isinstance(schema, bool):
        return None
    if schema not in CLOSURE_SCHEMAS:
        return None
    if not isinstance(state, str) or state in _allowed_states(schema):
        return None
    return diagnostic(
        "closure.invalid_state",
        "error",
        f"El estado {state!r} no es válido para el esquema de archivo {schema}; "
        f"los estados admitidos son {', '.join(_allowed_states(schema))}.",
        "cierre.json",
    )


def _compatibility(
    review: dict | None, closure: Any, state_issue: dict | None
) -> str:
    review_schema = review.get("schema_version") if isinstance(review, dict) else None
    closure = _as_dict(closure)
    closure_schema = closure.get("schema_version")

    if closure and not isinstance(closure_schema, int):
        return "limited"
    if isinstance(closure_schema, int) and closure_schema not in CLOSURE_SCHEMAS:
        return "limited"
    if review is not None:
        if not isinstance(review_schema, int) or review_schema not in REVIEW_SCHEMAS:
            return "limited"
    if state_issue is not None:
        return "limited"
    if review_schema == CURRENT_REVIEW_SCHEMA and closure_schema == CURRENT_CLOSURE_SCHEMA:
        return "supported"
    return "historical"


def _display_state(archive_state: Any) -> str:
    if archive_state == "complete":
        return "closed"
    if archive_state == "closing":
        return "result_available_closure_pending"
    return "open_activity_unknown"


def adapt_run(location: RunLocation, snapshot: Mapping[str, Any]) -> dict:
    """Construye la ``ReviewView`` de una corrida preservando todos los valores de origen."""

    files = _as_dict(snapshot.get("files"))
    review = files.get("review.json", {}).get("data")
    review = review if isinstance(review, dict) else None
    closure = files.get("cierre.json", {}).get("data")
    closure = closure if isinstance(closure, dict) else None

    diagnostics: list[dict] = list(snapshot.get("diagnostics", []))
    state_issue = _closure_state_issue(closure)
    if state_issue is not None:
        diagnostics.append(state_issue)

    review_schema = review.get("schema_version") if review else None
    closure_schema = closure.get("schema_version") if closure else None
    trace_descriptor = _as_dict(closure.get("trace")) if closure else {}
    trace_schema = trace_descriptor.get("schema_version")

    presentation = _as_dict(review.get("presentation")) if review else {}
    presentation_kind = presentation.get("kind")
    if not isinstance(presentation_kind, str):
        presentation_kind = None

    archive_state = closure.get("state") if closure else None
    if not isinstance(archive_state, str):
        archive_state = None

    source_review_id = review.get("review_id") if review else None
    if not isinstance(source_review_id, str) or not source_review_id:
        source_review_id = None

    repository_identity = None
    if closure:
        for field in ("repository_identity", "repository"):
            value = closure.get(field)
            if isinstance(value, str) and value:
                repository_identity = value
                break

    verdict = review.get("verdict") if review else None
    if not isinstance(verdict, str):
        verdict = None

    profile = review.get("profile") if review else None
    if not isinstance(profile, str):
        profile = None

    summary = {
        "key": location.key,
        "repository_label": repository_identity or location.relative_path,
        "repository_identity": normalize_repository_identity(repository_identity),
        "scope_label": _scope_label(closure.get("scope") if closure else None),
        "created_at": closure.get("created_at") if closure else None,
        "source_review_id": source_review_id,
        "profile": profile,
        "verdict": verdict,
        "archive_state": archive_state,
        "display_state": _display_state(archive_state),
        "phase": None,
        "last_recorded_at": None,
        "recently_observed_change": False,
        "presentation_kind": presentation_kind,
        "finding_counts": finding_counts(review),
        "capabilities": {
            "has_closure": closure is not None,
            "has_review": review is not None,
            "has_report": bool(files.get("informe.md", {}).get("present")),
            "has_trace": bool(files.get("trazabilidad.jsonl", {}).get("present")),
            "has_ownership_marker": bool(files.get(".review-ownership.json", {}).get("present")),
            "has_coverage_areas": bool(_as_dict(review.get("coverage")).get("areas"))
            if review
            else False,
            "has_rereview": bool(review.get("rereview")) if review else False,
        },
        "diagnostics": diagnostics,
    }

    return {
        "api_version": API_VERSION,
        "summary": summary,
        "source_versions": {
            "review": review_schema,
            "closure": closure_schema,
            "trace": trace_schema,
        },
        "compatibility": _compatibility(review, closure, state_issue),
        "review": review,
        "closure": closure,
        "lineage": [],
        "files": [],
        "updating": bool(snapshot.get("updating")),
        "diagnostics": diagnostics,
    }


class Catalog:
    """Biblioteca en memoria con caché por firma de archivos, sin escrituras."""

    def __init__(self, root: Path) -> None:
        self._root = Path(root).resolve()
        self._lock = threading.RLock()
        self._locations: dict[str, RunLocation] = {}
        self._signatures: dict[str, tuple] = {}
        self._snapshots: dict[str, dict] = {}
        self._views: dict[str, dict] = {}
        self._diagnostics: list[dict] = []

    def locations(self) -> list[RunLocation]:
        with self._lock:
            return sorted(self._locations.values(), key=lambda item: item.relative_path)

    def refresh(self) -> None:
        """Vuelve a descubrir las corridas y sólo relee las que cambiaron."""

        locations, diagnostics = discover_runs(self._root)
        discovered = {location.key: location for location in locations}
        with self._lock:
            self._diagnostics = diagnostics
            for key in list(self._locations):
                if key not in discovered:
                    self._drop(key)
            for key, location in discovered.items():
                self._locations[key] = location
                signature = self._signature(location)
                if signature != self._signatures.get(key):
                    self._read(key, location)

    def get_run(self, key: str) -> dict:
        """Devuelve la ``ReviewView`` de una corrida; clave desconocida es un error."""

        with self._lock:
            location = self._locations[key]
            view = self._views.get(key)
            if view is None:
                self._read(key, location)
                view = self._views[key]
            return view

    def snapshot(self, key: str) -> dict:
        with self._lock:
            location = self._locations[key]
            snapshot = self._snapshots.get(key)
            if snapshot is None:
                self._read(key, location)
                snapshot = self._snapshots[key]
            return snapshot

    def list_runs(
        self, filters: Mapping[str, str], offset: int = 0, limit: int = PAGE_SIZE
    ) -> dict:
        """Lista corridas con filtros de origen, orden estable y paginación acotada."""

        if offset < 0:
            raise ValueError("el desplazamiento no puede ser negativo")
        page_size = max(1, min(int(limit), PAGE_SIZE))
        with self._lock:
            views = [self._get_or_read(key) for key in sorted(self._locations)]
            items = [view for view in views if _matches(view["summary"], filters)]

        items.sort(key=_sort_key)
        total = len(items)
        window = items[offset : offset + page_size]
        return {
            "items": [view["summary"] for view in window],
            "total": total,
            "offset": offset,
            "limit": page_size,
            "truncated": offset + page_size < total,
            "diagnostics": list(self._diagnostics),
        }

    def _get_or_read(self, key: str) -> dict:
        location = self._locations.get(key)
        if location is None:
            raise KeyError(key)
        view = self._views.get(key)
        if view is None:
            self._read(key, location)
            view = self._views[key]
        return view

    def _read(self, key: str, location: RunLocation) -> None:
        snapshot = read_snapshot(location, previous=self._snapshots.get(key))
        self._snapshots[key] = snapshot
        self._views[key] = adapt_run(location, snapshot)
        self._signatures[key] = self._signature(location)

    def _drop(self, key: str) -> None:
        self._locations.pop(key, None)
        self._signatures.pop(key, None)
        self._snapshots.pop(key, None)
        self._views.pop(key, None)

    @staticmethod
    def _signature(location: RunLocation) -> tuple:
        root = Path(location.path)
        signature: list[tuple] = []
        for name in ("cierre.json", "review.json", "informe.md", "trazabilidad.jsonl",
                     ".review-ownership.json"):
            try:
                status = (root / name).stat()
            except OSError:
                signature.append((name, None))
                continue
            signature.append((name, (status.st_size, status.st_mtime_ns)))
        return tuple(signature)


def _sort_key(view: Mapping[str, Any]) -> tuple:
    """Más reciente primero; las fechas ausentes van al final y se desempata por clave."""

    summary = view.get("summary", {})
    created = summary.get("created_at")
    return (created is None, _descending(created or ""), summary.get("key") or "")


def _descending(value: str) -> str:
    """Invierte el orden lexicográfico para poder ordenar ascendentemente."""

    return "".join(chr(0x10FFFF - ord(char)) for char in value)


def _matches(summary: Mapping[str, Any], filters: Mapping[str, str]) -> bool:
    text = (filters.get("q") or "").strip().lower()
    if text:
        haystack = " ".join(
            str(summary.get(field) or "")
            for field in ("repository_label", "scope_label", "source_review_id", "key")
        ).lower()
        if text not in haystack:
            return False
    for field, expected in (
        ("repository", summary.get("repository_identity")),
        ("mode", summary.get("scope_label")),
        ("kind", summary.get("presentation_kind")),
        ("profile", summary.get("profile")),
        ("verdict", summary.get("verdict")),
    ):
        wanted = filters.get(field)
        if not wanted:
            continue
        if str(expected or "") != wanted:
            return False
    if str(filters.get("open") or "").lower() in {"1", "true", "yes"}:
        if summary.get("display_state") == "closed":
            return False
    return True