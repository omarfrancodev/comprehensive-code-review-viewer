"""Interpretación de la traza de ciclo de vida: cadena, tiempos y relaciones.

Verificación estricta y presentación limitada son cosas separadas: una traza que
no verifica puede seguir mostrándose con su prefijo válido y una limitación
visible, nunca como un distintivo de "verificada". El orden temporal de
presentación es independiente del orden de grabación y nunca afirma un reloj
global comparable entre agentes.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import datetime
from typing import Any, Mapping, Sequence

from .discovery import RunLocation, diagnostic

__all__ = [
    "parse_trace",
    "temporal_order",
    "resolve_relations",
    "TRACE_SCHEMA_VERSION",
    "MAX_TRACE_EVENTS",
    "MAX_EVENT_BYTES",
    "MAX_RELATIONS_PER_EVENT",
    "RELATION_TYPES",
    "EVENT_FIELDS",
    "SYSTEM_FIELDS",
]

TRACE_SCHEMA_VERSION = 1
MAX_TRACE_EVENTS = 10000
MAX_EVENT_BYTES = 8192
MAX_RELATIONS_PER_EVENT = 24

EVENT_FIELDS = frozenset(
    {
        "kind",
        "status",
        "summary",
        "actor",
        "executor",
        "provenance",
        "evidence",
        "relations",
        "authority",
        "occurred_at",
    }
)
SYSTEM_FIELDS = frozenset(
    {
        "schema_version",
        "sequence",
        "event_id",
        "run_id",
        "review_id",
        "recorded_at",
        "recorder",
        "previous_sha256",
        "sha256",
    }
)
RELATION_TYPES = frozenset(
    {
        "verifies",
        "supports",
        "depends_on",
        "follows",
        "reuses",
        "supersedes",
        "records",
        "generated_from",
    }
)

_LOCAL_EVENT = re.compile(r"\AE[0-9]{6}\Z")
_LOCAL_FINDING = re.compile(r"\AF[0-9]{3,}\Z")
_LOCAL_CHECK = re.compile(r"\AC[0-9]{3,}\Z")
_CROSS_REVIEW = re.compile(
    r"\ACR-(?P<run>[0-9a-f]{20})#(?P<target>E[0-9]{6}|F[0-9]{3,}|C[0-9]{3,})\Z"
)

OCCURRENCE_BASIS = "observed_occurrence"
RECORDING_BASIS = "recording_fallback"
SEQUENCE_BASIS = "sequence_fallback"


def encoded(value: Any) -> bytes:
    """Serialización canónica del productor: claves ordenadas y separadores compactos."""

    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _utc_time(value: Any) -> bool:
    """Indica si el valor es una marca de tiempo UTC válida."""

    if not isinstance(value, str) or len(value) > 50:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    offset = parsed.utcoffset()
    return offset is not None and offset.total_seconds() == 0


def _event_shape_valid(value: Any) -> str | None:
    """Valida la forma de un evento sin aplicar reglas de emisión de ninguna versión."""

    if not isinstance(value, dict) or set(value) != EVENT_FIELDS | SYSTEM_FIELDS:
        return "trace.invalid_event_schema"
    if value["schema_version"] != TRACE_SCHEMA_VERSION:
        return "trace.unsupported_schema"
    if not isinstance(value["sequence"], int) or isinstance(value["sequence"], bool):
        return "trace.invalid_sequence"
    if not isinstance(value["event_id"], str) or not _LOCAL_EVENT.match(value["event_id"]):
        return "trace.invalid_event_id"
    if not isinstance(value["summary"], str) or not value["summary"].strip():
        return "trace.invalid_summary"
    if len(value["summary"]) > 2000:
        return "trace.invalid_summary"
    for field in ("evidence", "relations"):
        items = value[field]
        if not isinstance(items, list) or len(items) > MAX_RELATIONS_PER_EVENT:
            return "trace.unbounded_" + field
    for relation in value["relations"]:
        if not isinstance(relation, dict) or set(relation) != {"relation", "target"}:
            return "trace.invalid_relation"
        if relation["relation"] not in RELATION_TYPES:
            return "trace.invalid_relation_type"
        if not isinstance(relation["target"], str) or not relation["target"].strip():
            return "trace.invalid_relation_target"
    provenance = value["provenance"]
    if not isinstance(provenance, dict) or set(provenance) != {"kind", "source"}:
        return "trace.invalid_provenance"
    if not _utc_time(value["recorded_at"]):
        return "trace.invalid_recorded_at"
    if value["occurred_at"] is not None and not _utc_time(value["occurred_at"]):
        return "trace.invalid_occurred_at"
    return None


def _temporal_key(event: Mapping[str, Any]) -> tuple:
    """Clave de orden temporal: ocurrencia, si no registro, si no secuencia al final."""

    occurred = event.get("occurred_at")
    if _utc_time(occurred):
        return (0, datetime.fromisoformat(occurred.replace("Z", "+00:00")).timestamp(), event.get("sequence") or 0)
    recorded = event.get("recorded_at")
    if _utc_time(recorded):
        return (0, datetime.fromisoformat(recorded.replace("Z", "+00:00")).timestamp(), event.get("sequence") or 0)
    return (1, 0, event.get("sequence") or 0)


def temporal_basis(event: Mapping[str, Any]) -> str:
    occurred = event.get("occurred_at")
    if _utc_time(occurred):
        return OCCURRENCE_BASIS
    if _utc_time(event.get("recorded_at")):
        return RECORDING_BASIS
    return SEQUENCE_BASIS


def temporal_order(events: Sequence[Mapping[str, Any]]) -> list[str]:
    """Ordena los identificadores de evento por tiempo observado y luego por secuencia."""

    return [
        event["event_id"]
        for event in sorted(events, key=_temporal_key)
        if isinstance(event, dict) and isinstance(event.get("event_id"), str)
    ]


def _describe(value: Any) -> dict:
    """Devuelve una copia del evento con su base temporal, sin tocar el original."""

    event = copy.deepcopy(value)
    basis = temporal_basis(event)
    event["temporal_basis"] = basis
    event["temporal_at"] = (
        event.get("occurred_at")
        if basis == OCCURRENCE_BASIS
        else event.get("recorded_at") if basis == RECORDING_BASIS else None
    )
    return event


def parse_trace(
    data: bytes,
    descriptor: Mapping[str, Any] | None,
    run_id: str | None,
    *,
    open_run: bool = False,
) -> dict:
    """Interpreta una traza de esquema 1 y devuelve su vista, sin escribir nada."""

    diagnostics: list[dict] = []
    events: list[dict] = []
    previous: str | None = None
    last_hash: str | None = None
    truncated = False

    if not data:
        return {
            "events": [],
            "valid_prefix_length": 0,
            "chain_status": "limited",
            "temporal_order": [],
            "relations": [],
            "diagnostics": [
                diagnostic("trace.absent", "info", "La corrida no conserva una traza.", None)
            ],
        }

    if not data.endswith(b"\n"):
        diagnostics.append(
            diagnostic(
                "trace.missing_final_newline",
                "error",
                "La traza no termina en salto de línea: puede estar truncada.",
                "trazabilidad.jsonl",
            )
        )
        truncated = True

    lines = data.splitlines()
    if len(lines) > MAX_TRACE_EVENTS:
        diagnostics.append(
            diagnostic(
                "trace.too_many_events",
                "warning",
                f"La traza declara {len(lines)} eventos; sólo se interpretan los "
                f"{MAX_TRACE_EVENTS} primeros.",
                "trazabilidad.jsonl",
            )
        )
        lines = lines[:MAX_TRACE_EVENTS]
        truncated = True

    for index, line in enumerate(lines, start=1):
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            diagnostics.append(
                diagnostic(
                    "trace.invalid_json",
                    "error",
                    f"La línea {index} no es JSON válido.",
                    "trazabilidad.jsonl",
                )
            )
            break

        problem = _event_shape_valid(value)
        if problem is not None:
            diagnostics.append(
                diagnostic(problem, "error", f"La línea {index} no cumple el esquema.", "trazabilidad.jsonl")
            )
            break

        if len(encoded(value)) > MAX_EVENT_BYTES:
            diagnostics.append(
                diagnostic(
                    "trace.event_too_large",
                    "error",
                    f"El evento {value['event_id']} excede {MAX_EVENT_BYTES} bytes.",
                    "trazabilidad.jsonl",
                )
            )
            break

        if value["sequence"] != index or value["event_id"] != "E" + str(index).zfill(6):
            diagnostics.append(
                diagnostic(
                    "trace.sequence_mismatch",
                    "error",
                    f"La línea {index} declara secuencia {value['sequence']} e identificador "
                    f"{value['event_id']}.",
                    "trazabilidad.jsonl",
                )
            )
            break

        if run_id is not None and value["run_id"] != run_id:
            diagnostics.append(
                diagnostic(
                    "trace.identity_mismatch",
                    "error",
                    f"El evento {value['event_id']} pertenece a otra corrida.",
                    "trazabilidad.jsonl",
                )
            )
            break
        if run_id is not None and value["review_id"] != "CR-" + run_id:
            diagnostics.append(
                diagnostic(
                    "trace.identity_mismatch",
                    "error",
                    f"El review_id {value['review_id']!r} no corresponde al run_id del cierre.",
                    "trazabilidad.jsonl",
                )
            )
            break

        if value["previous_sha256"] != previous:
            diagnostics.append(
                diagnostic(
                    "trace.chain_broken",
                    "error",
                    f"El evento {value['event_id']} no encadena con el anterior.",
                    "trazabilidad.jsonl",
                )
            )
            break

        # Se copia antes de extraer el digest: el evento entregado no se modifica.
        claimed = value.get("sha256")
        candidate = {key: item for key, item in value.items() if key != "sha256"}
        if not isinstance(claimed, str) or not re.fullmatch(r"[0-9a-f]{64}", claimed) or (
            digest(encoded(candidate)) != claimed
        ):
            diagnostics.append(
                diagnostic(
                    "trace.hash_mismatch",
                    "error",
                    f"El contenido del evento {value['event_id']} no corresponde a su hash.",
                    "trazabilidad.jsonl",
                )
            )
            break

        events.append(value)
        previous = claimed
        last_hash = claimed

    valid_prefix_length = len(events)

    if descriptor is None:
        chain_status = "limited"
        diagnostics.append(
            diagnostic(
                "trace.descriptor_missing",
                "info",
                "El cierre no declara descriptor de traza; la cadena no se contrasta.",
                "cierre.json",
            )
        )
    elif not isinstance(descriptor, dict) or set(descriptor) != {
        "schema_version",
        "events",
        "last_sha256",
    }:
        chain_status = "limited"
        diagnostics.append(
            diagnostic(
                "trace.descriptor_mismatch",
                "warning",
                "El descriptor de traza del cierre no tiene la forma esperada.",
                "cierre.json",
            )
        )
    else:
        mismatch = (
            descriptor.get("schema_version") != TRACE_SCHEMA_VERSION
            or descriptor.get("events") != valid_prefix_length
            or descriptor.get("last_sha256") != last_hash
        )
        chain_status = "failed" if mismatch else "verified"
        if mismatch:
            diagnostics.append(
                diagnostic(
                    "trace.descriptor_mismatch",
                    "error",
                    "El descriptor del cierre no coincide con la traza interpretada.",
                    "cierre.json",
                )
            )

    if valid_prefix_length < len(lines) and chain_status == "verified":
        chain_status = "failed" if not truncated else "limited"
    if truncated and chain_status == "verified":
        chain_status = "limited"

    described = [_describe(event) for event in events]

    for event in described:
        if event["temporal_basis"] == SEQUENCE_BASIS:
            diagnostics.append(
                diagnostic(
                    "trace.missing_occurrence",
                    "warning",
                    f"El evento {event['event_id']} no tiene tiempo utilizable; se ordena "
                    "por secuencia y no se sintetiza una hora.",
                    "trazabilidad.jsonl",
                )
            )

    starts = [
        (event["event_id"], event["temporal_at"])
        for event in described
        if event["temporal_basis"] != SEQUENCE_BASIS
    ]
    if len(starts) >= 2 and starts[-1][1] < starts[0][1]:
        diagnostics.append(
            diagnostic(
                "trace.time_inconsistent",
                "warning",
                "El último tiempo observado es anterior al primero; la traza no permite "
                "establecer un orden de ejecución global.",
                "trazabilidad.jsonl",
            )
        )

    if open_run:
        diagnostics.append(
            diagnostic(
                "trace.open_run",
                "info",
                "La corrida sigue abierta: la traza aún no está cerrada.",
                "trazabilidad.jsonl",
            )
        )
        if chain_status == "verified":
            chain_status = "updating"

    relations = [dict(relation, event_id=event["event_id"])
                 for event in events for relation in event["relations"]]

    return {
        "events": described,
        "valid_prefix_length": valid_prefix_length,
        "chain_status": chain_status,
        "temporal_order": temporal_order(described),
        "relations": relations,
        "diagnostics": diagnostics,
    }


def _finding_ids(review: Any) -> set[str]:
    if not isinstance(review, dict):
        return set()
    return {
        item["id"]
        for item in (review.get("findings") if isinstance(review.get("findings"), list) else [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def _check_ids(review: Any) -> set[str]:
    if not isinstance(review, dict):
        return set()
    return {
        item["id"]
        for item in (review.get("checks") if isinstance(review.get("checks"), list) else [])
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }


def resolve_relations(
    events: Sequence[Mapping[str, Any]],
    review: dict | None,
    current: RunLocation,
    catalog: Any,
) -> tuple[list[dict], list[dict]]:
    """Resuelve los destinos declarados por el productor sin inferar causalidad.

    Un destino no resoluble es un diagnóstico de referencia: nunca convierte una
    cadena de hashes en corrupción.
    """

    seen_events = {
        event["event_id"] for event in events if isinstance(event.get("event_id"), str)
    }
    findings = _finding_ids(review)
    checks = _check_ids(review)

    relations: list[dict] = []
    diagnostics: list[dict] = []

    for event in events:
        for relation in event.get("relations") or []:
            target = relation.get("target")
            entry = {
                "event_id": event.get("event_id"),
                "relation": relation.get("relation"),
                "raw": target,
                "target": target,
                "status": "unresolved",
                "run_key": None,
                "file_key": None,
            }

            if _LOCAL_EVENT.match(target):
                entry["status"] = "resolved" if target in seen_events else "dangling"
                entry["run_key"] = current.key
                if entry["status"] == "dangling":
                    diagnostics.append(
                        diagnostic(
                            "relation.dangling",
                            "warning",
                            f"El evento {event.get('event_id')} apunta a {target}, que no "
                            "aparece en esta traza.",
                            "trazabilidad.jsonl",
                        )
                    )
            elif _LOCAL_FINDING.match(target):
                if target in findings:
                    entry["status"] = "resolved"
                else:
                    entry["status"] = "unresolved"
                    diagnostics.append(
                        diagnostic(
                            "relation.unresolved",
                            "info",
                            f"El hallazgo {target} no está en el registro final; puede "
                            "haber sido un candidato descartado.",
                            "trazabilidad.jsonl",
                        )
                    )
                entry["run_key"] = current.key
            elif _LOCAL_CHECK.match(target):
                if target in checks:
                    entry["status"] = "resolved"
                else:
                    entry["status"] = "unresolved"
                    diagnostics.append(
                        diagnostic(
                            "relation.unresolved",
                            "info",
                            f"La comprobación {target} no está en el registro final.",
                            "trazabilidad.jsonl",
                        )
                    )
                entry["run_key"] = current.key
            else:
                cross = _CROSS_REVIEW.match(target)
                if cross is None:
                    # Destino heredado o no canónico: se conserva tal cual, sin adivinar.
                    entry["status"] = "unresolved"
                else:
                    matches = [loc for loc in catalog.locations()
                               if catalog.get_run(loc.key).get("summary", {}).get("source_review_id") == "CR-" + cross.group("run")]
                    entry["status"] = "ambiguous" if len(matches) > 1 else "unavailable"
                    if len(matches) == 1:
                        target_location = matches[0]
                        target_view = catalog.get_run(target_location.key)
                        target_snapshot = catalog.snapshot(target_location.key)
                        target_closure = target_view.get("closure") or {}
                        target_trace = parse_trace(target_snapshot["files"].get("trazabilidad.jsonl", {}).get("raw") or b"", target_closure.get("trace"), target_closure.get("run_id"))
                        local_target = cross.group("target")
                        known = {e["event_id"] for e in target_trace["events"]} | _finding_ids(target_view.get("review")) | _check_ids(target_view.get("review"))
                        entry.update(status="resolved" if local_target in known else "unresolved", run_key=target_location.key)
                    if entry["status"] in ("unavailable", "ambiguous", "unresolved"):
                        diagnostics.append(
                            diagnostic(
                                "relation.cross_review_" + entry["status"],
                                "info",
                                f"El destino {target} no corresponde a una revisión "
                                "disponible en la raíz seleccionada; no se buscan rutas "
                                "anteriores.",
                                "trazabilidad.jsonl",
                            )
                        )

            relations.append(entry)

    edges = {}
    for relation in relations:
        if relation["status"] == "resolved" and relation["run_key"] == current.key and _LOCAL_EVENT.match(relation["target"]):
            edges.setdefault(relation["event_id"], []).append(relation["target"])
    # DFS iterativo: una traza acotada puede superar el límite de recursión.
    colors = {}
    cycles = set()
    for node in edges:
        if colors.get(node):
            continue
        stack = [(node, iter(edges.get(node, [])))]
        colors[node] = 1
        while stack:
            parent, children = stack[-1]
            child = next(children, None)
            if child is None:
                colors[parent] = 2
                stack.pop()
            elif colors.get(child) == 1:
                cycles.add((parent, child))
            elif not colors.get(child):
                colors[child] = 1
                stack.append((child, iter(edges.get(child, []))))
    for relation in relations:
        if (relation["event_id"], relation["target"]) in cycles:
            relation["status"] = "cyclic"
            diagnostics.append(diagnostic("relation.cyclic", "warning", "Una relación declarada forma un ciclo.", "trazabilidad.jsonl"))

    return relations, diagnostics
