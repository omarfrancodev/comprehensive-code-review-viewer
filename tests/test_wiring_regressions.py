import json
import tempfile
import unittest
from pathlib import Path

from ccr_viewer.adapters import Catalog
from ccr_viewer.live import LiveCollector
from ccr_viewer.trace import temporal_order, resolve_relations
from fixtures import build_archive, trace_event_bytes
from test_server import ServerTestCase
from test_trace import milestone


class ModelRegressions(unittest.TestCase):
    def test_creation_sort_uses_instants_instead_of_timezone_text(self):
        from ccr_viewer.adapters import _sort_key
        values = [{"summary": {"key": "new", "created_at": "2026-09-01T09:00:00-06:00"}},
                  {"summary": {"key": "old", "created_at": "2026-09-01T14:00:00+00:00"}}]
        self.assertEqual(sorted(values, key=_sort_key)[0]["summary"]["key"], "new")

    def test_expired_sse_cursor_requests_resync(self):
        from ccr_viewer.live import REPLAY_BUFFER_NOTICES
        with tempfile.TemporaryDirectory() as temporary:
            collector = LiveCollector(Catalog(Path(temporary)))
            self.addCleanup(collector.stop)
            for _ in range(REPLAY_BUFFER_NOTICES + 2):
                collector._make_notice("run_changed", "synthetic", "fingerprint")
            notices = collector.subscribe(0)
            self.assertEqual(notices.get_nowait()["kind"], "resync")

    def test_snapshot_detects_content_changes_with_identical_stat_signatures(self):
        from unittest import mock
        from ccr_viewer.discovery import RunLocation
        from ccr_viewer.snapshots import read_snapshot
        import ccr_viewer.snapshots as module
        with tempfile.TemporaryDirectory() as temporary:
            run = build_archive(Path(temporary), "processing_archive_v5")
            location = RunLocation("synthetic", run, "synthetic")
            coherent = read_snapshot(location)
            original = module.open_archive_file
            def changing(root, relative):
                if relative == "trazabilidad.jsonl":
                    data = json.loads((run / "cierre.json").read_text(encoding="utf-8"))
                    data["race"] = data.get("race", 0) + 1
                    (run / "cierre.json").write_text(json.dumps(data), encoding="utf-8")
                return original(root, relative)
            with mock.patch.object(module, "_stat_signature", return_value=(100, 100)), mock.patch.object(module, "open_archive_file", changing), mock.patch.object(module.time, "sleep", return_value=None):
                snapshot = read_snapshot(location, previous=coherent)
            self.assertTrue(snapshot["updating"])
            self.assertEqual(snapshot["fingerprint"], coherent["fingerprint"])

    def test_source_filters_include_mode_closed_and_date(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build_archive(root, "final_v7")
            build_archive(root, "prepared")
            catalog = Catalog(root)
            catalog.refresh()
            self.assertEqual(catalog.list_runs({"mode": "pr"})["total"], 2)
            self.assertEqual(catalog.list_runs({"open": "false"})["total"], 1)
            self.assertEqual(catalog.list_runs({"date_from": "2026-10-01"})["total"], 0)
            self.assertEqual(catalog.list_runs({"date_to": "2026-08-31"})["total"], 0)

    def test_temporal_order_compares_effective_instants_across_bases(self):
        events = [
            {"event_id": "E000001", "sequence": 1, "occurred_at": "2026-09-01T15:00:00+00:00"},
            {"event_id": "E000002", "sequence": 2, "occurred_at": None, "recorded_at": "2026-09-01T10:00:00+00:00"},
        ]
        self.assertEqual(temporal_order(events), ["E000002", "E000001"])

    def test_wrong_field_types_do_not_hide_other_runs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = build_archive(root, "final_v7")
            build_archive(root, "prepared")
            review = json.loads((run / "review.json").read_text(encoding="utf-8"))
            review["findings"] = [{"status": "confirmed", "priority": []}, {"status": {}}]
            review["rereview"] = 42
            review["previous_reviews"] = 42
            (run / "review.json").write_text(json.dumps(review), encoding="utf-8")
            catalog = Catalog(root)
            catalog.refresh()
            self.assertEqual(catalog.list_runs({})["total"], 2)
            bad = next(v for v in catalog.list_runs({})["items"] if v["source_review_id"])
            self.assertTrue(bad["diagnostics"])

    def test_first_observation_does_not_claim_recent_activity(self):
        with tempfile.TemporaryDirectory() as temporary:
            catalog = Catalog(Path(temporary))
            build_archive(Path(temporary), "processing_archive_v5")
            catalog.refresh()
            collector = LiveCollector(catalog)
            self.addCleanup(collector.stop)
            collector.poll_once()
            self.assertFalse(collector.recently_observed(catalog.locations()[0].key))

    def test_cross_review_relation_resolves_source_identity_and_finding(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build_archive(root, "final_v7")
            current = build_archive(root, "prepared")
            catalog = Catalog(root)
            catalog.refresh()
            location = next(loc for loc in catalog.locations() if loc.path == current)
            events = [{"event_id": "E000001", "relations": [{"relation": "reuses", "target": "CR-1111111111111111aaaa#F001"}]}]
            relations, _ = resolve_relations(events, None, location, catalog)
            self.assertEqual(relations[0]["status"], "resolved")
            self.assertNotEqual(relations[0]["run_key"], location.key)

    def test_interruption_is_observed_and_later_work_supersedes_it(self):
        from ccr_viewer.live import derive_display_state
        view = {"summary": {"archive_state": "processing", "phase": "interrupted"}}
        self.assertEqual(derive_display_state(view, False)[0], "interruption_recorded")
        view["summary"]["phase"] = "discovery"
        self.assertEqual(derive_display_state(view, False)[0], "open_activity_unknown")


class TraceEndpointRegressions(ServerTestCase):
    def test_non_object_closure_is_limited_instead_of_crashing_trace(self):
        self.bootstrap()
        key = self.run_key()
        (self.run / "cierre.json").write_text('["unknown", "metadata"]', encoding="utf-8")
        self.catalog.refresh()
        status, _, payload = self.json_api(f"/api/runs/{key}/trace")
        self.assertEqual(status, 200)
        self.assertIn(payload["data"]["chain_status"], ("limited", "failed"))

    def test_trace_uses_coherent_snapshot_during_pending_transition(self):
        self.bootstrap()
        key = self.run_key()
        original = (self.run / "trazabilidad.jsonl").read_bytes()
        closure = json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))
        closure["pending_trace"] = {"synthetic": True}
        (self.run / "cierre.json").write_text(json.dumps(closure), encoding="utf-8")
        (self.run / "trazabilidad.jsonl").write_bytes(b"broken-new-transaction\n")
        self.catalog.refresh()
        status, _, payload = self.json_api(f"/api/runs/{key}/trace")
        self.assertEqual(status, 200)
        self.assertEqual(payload["data"]["chain_status"], "updating")
        self.assertEqual(len(payload["data"]["events"]), len(original.splitlines()))

    def test_trace_resolves_local_relations(self):
        closure = json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))
        trace, descriptor = trace_event_bytes([
            milestone("prepare", "completed", "Preparado"),
            milestone("check", "passed", "Comprobado", relations=[{"relation": "follows", "target": "E000001"}]),
        ], closure["run_id"])
        (self.run / "trazabilidad.jsonl").write_bytes(trace)
        closure["trace"] = descriptor
        (self.run / "cierre.json").write_text(json.dumps(closure), encoding="utf-8")
        self.catalog.refresh()
        self.bootstrap()
        status, _, payload = self.json_api(f"/api/runs/{self.run_key()}/trace")
        self.assertEqual(status, 200)
        self.assertTrue(payload["data"]["relations"])
        self.assertTrue(any(r.get("status") == "resolved" for r in payload["data"]["relations"]))
