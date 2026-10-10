"""Pruebas de interpretación de traza: cadena, tiempos y relaciones."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ccr_viewer.adapters import Catalog
from ccr_viewer.discovery import RunLocation, run_key
from ccr_viewer.references import resolve_reference
from ccr_viewer.trace import parse_trace, resolve_relations, temporal_order

from fixtures import RUN_ID, build_archive, canonical_json_bytes, trace_encoded, trace_event_bytes

RUN = RUN_ID


def location_for(run: Path, root: Path) -> RunLocation:
    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


def milestone(
    kind: str,
    status: str,
    summary: str,
    occurred_at: str | None = None,
    source: str | None = None,
    relations: list | None = None,
    actor: dict | None = None,
    executor: dict | None = None,
    provenance_kind: str | None = None,
) -> dict:
    helper = kind in {"prepare", "register", "retain", "validation", "handoff", "close"}
    return {
        "kind": kind,
        "status": status,
        "summary": summary,
        "actor": actor
        or {
            "kind": "helper" if helper else "coordinator",
            "name": "review_artifacts" if helper else "coordinator",
            "provider_id": None,
        },
        "executor": executor,
        "provenance": {"kind": provenance_kind or ("helper" if helper else "agent"), "source": source},
        "occurred_at": occurred_at,
        "evidence": [],
        "relations": relations or [],
        "authority": None,
    }


def parse(data: bytes, descriptor: dict | None = None, **kwargs) -> dict:
    return parse_trace(data, descriptor, RUN, **kwargs)


def tamper(data: bytes, index: int, **changes) -> bytes:
    """Reescribe una línea sin recalcular su hash, para simular una alteración."""

    lines = data.splitlines(keepends=True)
    value = json.loads(lines[index])
    value.update(changes)
    return b"".join(lines[:index] + [trace_encoded(value) + b"\n"] + lines[index + 1 :])


class ChainVerificationTests(unittest.TestCase):
    def build(self, milestones: list[dict]) -> tuple[bytes, dict]:
        return trace_event_bytes(milestones, RUN)

    def test_valid_chain_is_verified(self) -> None:
        data, descriptor = self.build(
            [
                milestone("prepare", "completed", "Preparado"),
                milestone("check", "passed", "Comprobación superada", "2026-09-01T12:00:05+00:00"),
            ]
        )
        view = parse(data, descriptor)
        self.assertEqual(view["chain_status"], "verified")
        self.assertEqual(view["valid_prefix_length"], 2)
        self.assertEqual([event["event_id"] for event in view["events"]], ["E000001", "E000002"])
        self.assertEqual(view["diagnostics"], [])

    def test_ids_sequence_and_source_identity_are_preserved(self) -> None:
        data, descriptor = self.build([milestone("prepare", "completed", "Preparado")])
        view = parse(data, descriptor)
        event = view["events"][0]
        self.assertEqual(event["sequence"], 1)
        self.assertEqual(event["event_id"], "E000001")
        self.assertEqual(event["run_id"], RUN)
        self.assertEqual(event["review_id"], "CR-" + RUN)
        self.assertEqual(event["recorder"], {"kind": "helper", "name": "review_artifacts", "provider_id": None})

    def test_accents_and_sorted_serialization_are_preserved(self) -> None:
        data, descriptor = self.build([milestone("prepare", "completed", "Revisión áéíóú 準備中")])
        view = parse(data, descriptor)
        self.assertEqual(view["events"][0]["summary"], "Revisión áéíóú 準備中")
        self.assertIn("準備中".encode("utf-8"), data)

    def test_changed_summary_breaks_the_chain(self) -> None:
        data, descriptor = self.build(
            [milestone("prepare", "completed", "Preparado"), milestone("check", "passed", "Pasa")]
        )
        altered = tamper(data, 1, summary="Texto distinto")
        view = parse(altered, descriptor)
        self.assertEqual(view["chain_status"], "failed")
        self.assertEqual(view["valid_prefix_length"], 1)
        self.assertTrue(any(item["code"] == "trace.hash_mismatch" for item in view["diagnostics"]))

    def test_missing_final_newline_is_detected(self) -> None:
        data, descriptor = self.build([milestone("prepare", "completed", "Preparado")])
        view = parse(data[:-1], descriptor)
        self.assertNotEqual(view["chain_status"], "verified")
        self.assertTrue(
            any(item["code"] == "trace.missing_final_newline" for item in view["diagnostics"])
        )

    def test_invalid_middle_line_keeps_the_valid_prefix(self) -> None:
        data, descriptor = self.build(
            [
                milestone("prepare", "completed", "Preparado"),
                milestone("check", "passed", "Pasa"),
                milestone("close", "completed", "Cerrado"),
            ]
        )
        lines = data.splitlines(keepends=True)
        broken = b"".join(lines[:1] + [b"{ no es json\n"] + lines[2:])
        view = parse(broken, descriptor)
        self.assertEqual(view["valid_prefix_length"], 1)
        self.assertNotEqual(view["chain_status"], "verified")
        self.assertTrue(any(item["code"] == "trace.invalid_json" for item in view["diagnostics"]))

    def test_descriptor_mismatch_is_reported_separately(self) -> None:
        data, _ = self.build([milestone("prepare", "completed", "Preparado")])
        view = parse(data, {"schema_version": 1, "events": 5, "last_sha256": "0" * 64})
        self.assertNotEqual(view["chain_status"], "verified")
        self.assertTrue(
            any(item["code"] == "trace.descriptor_mismatch" for item in view["diagnostics"])
        )

    def test_missing_descriptor_is_limited_not_failed(self) -> None:
        data, _ = self.build([milestone("prepare", "completed", "Preparado")])
        view = parse(data, None)
        self.assertEqual(view["chain_status"], "limited")
        self.assertEqual(view["valid_prefix_length"], 1)

    def test_oversized_event_is_rejected(self) -> None:
        data, descriptor = self.build(
            [milestone("prepare", "completed", "x" * 4000)]
        )
        view = parse(data, descriptor)
        self.assertNotEqual(view["chain_status"], "verified")

    def test_event_limit_is_enforced(self) -> None:
        milestones = [milestone("prepare", "completed", "Preparado") for _ in range(3)]
        data, descriptor = self.build(milestones)
        data = data * 4000
        view = parse(data, descriptor)
        self.assertTrue(any(item["code"] == "trace.too_many_events" for item in view["diagnostics"]))
        self.assertLessEqual(view["valid_prefix_length"], 10000)

    def test_supplied_events_are_not_mutated(self) -> None:
        data, descriptor = self.build([milestone("prepare", "completed", "Preparado")])
        original = json.loads(data.splitlines()[0])
        before = dict(original)
        parse(data, descriptor)
        self.assertEqual(original, before)

    def test_truncated_input_never_reports_full_verification(self) -> None:
        data, descriptor = self.build(
            [milestone("prepare", "completed", "Preparado"), milestone("check", "passed", "Pasa")]
        )
        first_line = data.splitlines(keepends=True)[0]
        view = parse(first_line, descriptor)
        self.assertNotEqual(view["chain_status"], "verified")
        self.assertEqual(view["valid_prefix_length"], 1)


class TemporalOrderTests(unittest.TestCase):
    def events(self) -> list[dict]:
        data, _ = trace_event_bytes(
            [
                milestone("prepare", "completed", "Preparado"),
                milestone("discovery", "started", "Descubrimiento", "2026-09-01T11:00:00+00:00"),
            ],
            RUN,
        )
        return [json.loads(line) for line in data.splitlines()]

    def test_occurrence_time_wins_over_later_recording_time(self) -> None:
        events = self.events()
        self.assertEqual(temporal_order(events), ["E000002", "E000001"])
        self.assertEqual(events[0]["sequence"], 1)
        self.assertEqual(events[0]["event_id"], "E000001")

    def test_basis_labels_distinguish_occurrence_from_recording_fallback(self) -> None:
        data, descriptor = trace_event_bytes(
            [
                milestone("prepare", "completed", "Preparado"),
                milestone("discovery", "started", "Descubrimiento", "2026-09-01T11:00:00+00:00"),
            ],
            RUN,
        )
        view = parse(data, descriptor)
        basis = {event["event_id"]: event["temporal_basis"] for event in view["events"]}
        self.assertEqual(basis["E000002"], "observed_occurrence")
        self.assertEqual(basis["E000001"], "recording_fallback")

    def test_canonical_recording_order_is_always_available(self) -> None:
        data, descriptor = trace_event_bytes(
            [
                milestone("prepare", "completed", "Preparado"),
                milestone("discovery", "started", "Descubrimiento", "2026-09-01T11:00:00+00:00"),
            ],
            RUN,
        )
        view = parse(data, descriptor)
        self.assertEqual(
            [event["event_id"] for event in view["events"]], ["E000001", "E000002"]
        )
        self.assertEqual(view["temporal_order"], ["E000002", "E000001"])

    def test_missing_occurrence_time_is_never_synthesized(self) -> None:
        data, descriptor = trace_event_bytes(
            [milestone("prepare", "completed", "Preparado")], RUN
        )
        view = parse(data, descriptor)
        self.assertIsNone(view["events"][0]["occurred_at"])
        self.assertEqual(view["events"][0]["temporal_basis"], "recording_fallback")

    def test_sequence_fallback_is_diagnosed_and_ordered_last(self) -> None:
        events = [
            {
                "event_id": "E000001",
                "sequence": 1,
                "occurred_at": None,
                "recorded_at": None,
            },
            {
                "event_id": "E000002",
                "sequence": 2,
                "occurred_at": "2026-09-01T12:00:00+00:00",
                "recorded_at": "2026-09-01T12:00:00+00:00",
            },
        ]
        self.assertEqual(temporal_order(events), ["E000002", "E000001"])

    def test_impossible_end_before_start_is_warned(self) -> None:
        data, descriptor = trace_event_bytes(
            [
                milestone("agent", "started", "Inicio", "2026-09-01T12:00:00+00:00"),
                milestone("agent", "completed", "Fin", "2026-09-01T11:00:00+00:00"),
            ],
            RUN,
        )
        view = parse(data, descriptor)
        self.assertTrue(any(item["code"] == "trace.time_inconsistent" for item in view["diagnostics"]))

    def test_helper_and_runner_provenance_are_kept_distinct(self) -> None:
        data, descriptor = trace_event_bytes(
            [
                milestone(
                    "check", "passed", "Comprobación",
                    "2026-09-01T12:00:00+00:00",
                    source="review_artifacts:retain",
                    provenance_kind="helper",
                ),
                milestone(
                    "agent", "completed", "Ejecución observada",
                    "2026-09-01T12:00:09+00:00",
                    source="review_runner:evidence/run.json",
                    provenance_kind="tool",
                ),
            ],
            RUN,
        )
        view = parse(data, descriptor)
        sources = {event["event_id"]: event["provenance"] for event in view["events"]}
        self.assertEqual(sources["E000001"]["source"], "review_artifacts:retain")
        self.assertEqual(sources["E000002"]["source"], "review_runner:evidence/run.json")
        self.assertEqual(sources["E000002"]["kind"], "tool")

    def test_recorder_actor_and_executor_stay_separate_fields(self) -> None:
        data, descriptor = trace_event_bytes(
            [
                milestone(
                    "agent", "completed", "Delegado",
                    "2026-09-01T12:00:00+00:00",
                    source="runner:evidence/run.json",
                    provenance_kind="tool",
                    actor={"kind": "coordinator", "name": "coordinador", "provider_id": None},
                    executor={"name": "ejecutor-1", "provider_id": "prov-1"},
                )
            ],
            RUN,
        )
        event = parse(data, descriptor)["events"][0]
        self.assertEqual(event["recorder"]["name"], "review_artifacts")
        self.assertEqual(event["actor"]["name"], "coordinador")
        self.assertEqual(event["executor"]["name"], "ejecutor-1")
        self.assertIsNone(event["actor"]["provider_id"])

    def test_historical_event_with_occurrence_and_null_source_stays_valid(self) -> None:
        # Una traza histórica de esquema 1 puede tener ocurrencia sin fuente
        # identificable: las reglas de emisión del esquema 5 no se aplican hacia atrás.
        data, descriptor = trace_event_bytes(
            [
                milestone(
                    "agent", "completed", "Histórico",
                    "2026-09-01T12:00:00+00:00",
                    source=None,
                    provenance_kind="agent",
                )
            ],
            RUN,
        )
        view = parse(data, descriptor)
        self.assertEqual(view["chain_status"], "verified")
        self.assertEqual(view["events"][0]["provenance"]["source"], None)


class RelationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "final_v7")
        self.location = location_for(self.run, self.root)
        self.catalog = Catalog(self.root)
        self.catalog.refresh()

    def events_with(self, relations_per_event: list[list[dict]]) -> list[dict]:
        milestones = [
            milestone("prepare", "completed", "Preparado"),
            milestone("discovery", "started", "Descubrimiento"),
        ]
        for index, relations in enumerate(relations_per_event):
            milestones.append(
                milestone("check", "passed", "Comprobación " + str(index), relations=relations)
            )
        data, _ = trace_event_bytes(milestones, RUN)
        return [json.loads(line) for line in data.splitlines()]

    def resolve(self, events: list[dict], review: dict | None = None):
        return resolve_relations(events, review, self.location, self.catalog)

    def test_local_event_target_resolves(self) -> None:
        events = self.events_with([[{"relation": "follows", "target": "E000001"}]])
        relations, diagnostics = self.resolve(events)
        targets = [item["target"] for item in relations]
        self.assertIn("E000001", targets)
        self.assertTrue(all(item["status"] == "resolved" for item in relations))

    def test_future_local_event_target_is_dangling_not_a_chain_failure(self) -> None:
        events = self.events_with([[{"relation": "depends_on", "target": "E000009"}]])
        relations, diagnostics = self.resolve(events)
        dangling = [item for item in relations if item["status"] == "dangling"]
        self.assertTrue(dangling)
        self.assertTrue(any(item["code"] == "relation.dangling" for item in diagnostics))

    def test_local_finding_and_check_targets_resolve_against_the_record(self) -> None:
        review = json.loads((self.run / "review.json").read_text(encoding="utf-8"))
        events = self.events_with(
            [
                [
                    {"relation": "verifies", "target": "F001"},
                    {"relation": "records", "target": "C001"},
                ]
            ]
        )
        relations, diagnostics = self.resolve(events, review)
        by_target = {item["target"]: item["status"] for item in relations}
        self.assertEqual(by_target["F001"], "resolved")
        self.assertEqual(by_target["C001"], "resolved")

    def test_discarded_finding_candidate_is_unresolved_not_corruption(self) -> None:
        review = json.loads((self.run / "review.json").read_text(encoding="utf-8"))
        events = self.events_with([[{"relation": "supports", "target": "F900"}]])
        relations, diagnostics = self.resolve(events, review)
        self.assertTrue(
            any(item["status"] == "unresolved" for item in relations)
        )
        self.assertTrue(any(item["code"] == "relation.unresolved" for item in diagnostics))
        self.assertFalse(any("hash" in item["code"] for item in diagnostics))

    def test_cross_review_target_resolves_only_against_the_catalog(self) -> None:
        other = build_archive(self.root, "prepared")
        other_location = location_for(other, self.root)
        self.catalog.refresh()
        events = self.events_with(
            [[{"relation": "reuses", "target": "CR-0000000000000000bbbb#F001"}]]
        )
        relations, diagnostics = self.resolve(events)
        self.assertTrue(
            any(item["status"] == "unavailable" for item in relations)
        )

    def test_legacy_raw_target_is_preserved_verbatim(self) -> None:
        events = self.events_with([[{"relation": "follows", "target": "revision anterior"}]])
        relations, diagnostics = self.resolve(events)
        legacy = [item for item in relations if item["raw"] == "revision anterior"]
        self.assertTrue(legacy)
        self.assertEqual(legacy[0]["status"], "unresolved")

    def test_no_relations_means_no_fabricated_edges(self) -> None:
        events = self.events_with([[]])
        relations, diagnostics = self.resolve(events)
        self.assertEqual(relations, [])
        self.assertEqual(diagnostics, [])


if __name__ == "__main__":
    unittest.main()