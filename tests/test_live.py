"""Pruebas del colector vivo: avisos acotados, estados derivados y transiciones."""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from ccr_viewer.adapters import Catalog, adapt_run
from ccr_viewer.live import (
    ACTIVE_CHANGE_WINDOW_SECONDS,
    LIVE_POLL_SECONDS,
    LIVE_RESCAN_SECONDS,
    MAX_CLIENT_QUEUE,
    REPLAY_BUFFER_NOTICES,
    LiveCollector,
    derive_display_state,
)
from ccr_viewer.snapshots import read_snapshot

from fixtures import archive_inventory, build_archive, canonical_json_bytes, trace_event_bytes


class FakeClock:
    """Reloj controlable para que las pruebas no dependan del tiempo real."""

    def __init__(self) -> None:
        self.now = 1000.0
        self.locks: list[float] = []

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds

    def sleep(self, seconds: float) -> None:
        self.locks.append(seconds)
        self.advance(seconds)


def location_for(run: Path, root: Path):
    from ccr_viewer.discovery import RunLocation, run_key

    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


def view_for(run: Path, root: Path) -> dict:
    location = location_for(run, root)
    return adapt_run(location, read_snapshot(location), None)


class DisplayStateTests(unittest.TestCase):
    def _view(self, variant: str, *overrides: str):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        run = (build_archive(root, variant, overrides) if overrides
               else build_archive(root, variant))
        return view_for(run, root)

    def test_complete_source_is_closed(self) -> None:
        state, phase = derive_display_state(self._view("final_v7"), False)
        self.assertEqual(state, "closed")
        self.assertIsNone(phase)

    def test_processing_source_alone_is_unknown_activity(self) -> None:
        view = self._view("processing_archive_v5")
        state, phase = derive_display_state(view, False)
        self.assertEqual(state, "open_activity_unknown")
        self.assertIsNone(phase)
        # El estado de la fuente se conserva aparte: trabajo iniciado, no actividad viva.
        self.assertEqual(view["summary"]["archive_state"], "processing")

    def test_observed_change_yields_recent_activity(self) -> None:
        state, _ = derive_display_state(self._view("prepared_archive_v5"), True)
        self.assertEqual(state, "open_recent_activity")

    def test_open_without_observed_change_is_unknown(self) -> None:
        state, _ = derive_display_state(self._view("prepared_archive_v5"), False)
        self.assertEqual(state, "open_activity_unknown")

    def test_closing_source_is_result_available_closure_pending(self) -> None:
        view = self._view("complete_archive_v4")
        view["summary"]["archive_state"] = "closing"
        state, _ = derive_display_state(view, False)
        self.assertEqual(state, "result_available_closure_pending")

    def test_no_percentage_is_exposed(self) -> None:
        state, phase = derive_display_state(self._view("final_v7"), False)
        self.assertNotIn("%", state)
        self.assertNotIn("0", state)

    def test_unknown_archive_state_is_limited_not_closed(self) -> None:
        view = self._view("unknown_v99")
        state, _ = derive_display_state(view, False)
        self.assertEqual(state, "open_activity_unknown")


class CollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "processing_archive_v5")
        self.catalog = Catalog(self.root)
        self.catalog.refresh()
        self.clock = FakeClock()
        self.collector = LiveCollector(self.catalog, clock=self.clock)
        self.addCleanup(self.collector.stop)

    def drain(self, client) -> list[dict]:
        notices: list[dict] = []
        while not client.empty():
            notices.append(client.get_nowait())
        return notices

    def test_limits_match_the_spec(self) -> None:
        self.assertEqual(LIVE_POLL_SECONDS, 2)
        self.assertEqual(LIVE_RESCAN_SECONDS, 10)
        self.assertEqual(ACTIVE_CHANGE_WINDOW_SECONDS, 120)
        self.assertEqual(REPLAY_BUFFER_NOTICES, 256)
        self.assertEqual(MAX_CLIENT_QUEUE, 128)

    def test_poll_publishes_catalog_and_run_notices(self) -> None:
        client = self.collector.subscribe()
        notices = self.collector.poll_once()
        codes = {item["kind"] for item in notices}
        self.assertIn("catalog_changed", codes)
        self.assertTrue(all(isinstance(item["cursor"], int) for item in notices))

    def test_first_poll_after_subscribe_reports_the_library(self) -> None:
        self.collector.subscribe()
        first = self.collector.poll_once()
        self.assertTrue(any(item["kind"] == "catalog_changed" for item in first))

    def test_unchanged_library_publishes_nothing(self) -> None:
        self.collector.poll_once()
        self.assertEqual(self.collector.poll_once(), [])

    def test_two_subscribers_share_one_collector(self) -> None:
        first = self.collector.subscribe()
        second = self.collector.subscribe()
        self.collector.poll_once()
        (self.run / "cierre.json").write_bytes(
            canonical_json_bytes({"schema_version": 5, "state": "closing"})
        )
        notices = self.collector.poll_once()
        self.assertEqual(len(self.drain(first)), len(self.drain(second)))

    def test_unsubscribing_the_last_client_stops_polling(self) -> None:
        client = self.collector.subscribe()
        deadline = time.monotonic() + 3
        while not self.collector.is_running() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(self.collector.is_running())
        self.collector.unsubscribe(client)
        self.assertEqual(self.collector.client_count(), 0)
        deadline = time.monotonic() + 3
        while self.collector.is_running() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertFalse(self.collector.is_running())

    def test_cursor_replay_returns_notices_after_the_cursor(self) -> None:
        client = self.collector.subscribe()
        self.collector.poll_once()
        cursor = self.drain(client)[-1]["cursor"]
        (self.run / "cierre.json").write_bytes(
            canonical_json_bytes({"schema_version": 5, "state": "closing"})
        )
        self.collector.poll_once()
        resumed = self.collector.subscribe(cursor)
        replayed = self.drain(resumed)
        self.assertTrue(replayed)
        self.assertTrue(all(item["cursor"] > cursor for item in replayed))

    def test_expired_or_unknown_cursor_emits_resync(self) -> None:
        self.collector.subscribe()
        self.collector.poll_once()
        for cursor in (-1, 999999):
            with self.subTest(cursor=cursor):
                notices = self.drain(self.collector.subscribe(cursor))
                self.assertTrue(notices)
                self.assertEqual(notices[0]["kind"], "resync")

    def test_full_client_queue_is_replaced_by_resync(self) -> None:
        client = self.collector.subscribe()
        client.maxsize = 1
        for index in range(5):
            (self.run / "cierre.json").write_bytes(
                canonical_json_bytes({"schema_version": 5, "state": "closing" * (index + 1)})
            )
            self.collector.poll_once()
        notices = self.drain(client)
        self.assertTrue(any(item["kind"] == "resync" for item in notices))

    def test_stop_closes_every_client(self) -> None:
        client = self.collector.subscribe()
        self.collector.stop()
        self.assertFalse(self.collector.is_running())

    def test_viewer_never_writes_to_the_archive(self) -> None:
        self.collector.subscribe()
        before = archive_inventory(self.root)
        for _ in range(4):
            self.collector.poll_once()
        self.assertEqual(archive_inventory(self.root), before)

    def test_polling_does_not_hash_evidence(self) -> None:
        (self.run / "evidence" / "grande.bin").write_bytes(b"x" * (2 * 1024 * 1024))
        self.collector.subscribe()
        import ccr_viewer.snapshots as snapshots_module

        opened: list[str] = []
        real_read = snapshots_module.read_bounded

        def recording(root: Path, relative: str, limit: int):
            opened.append(relative)
            return real_read(root, relative, limit)

        original = snapshots_module.read_bounded
        snapshots_module.read_bounded = recording
        try:
            for _ in range(3):
                self.collector.poll_once()
        finally:
            snapshots_module.read_bounded = original
        self.assertFalse([name for name in opened if name.startswith("evidence/")], opened)


class TransitionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)
        self.run = build_archive(self.root, "prepared_archive_v5")
        self.clock = FakeClock()

    def collector(self) -> LiveCollector:
        catalog = Catalog(self.root)
        catalog.refresh()
        collector = LiveCollector(catalog, clock=self.clock)
        self.addCleanup(collector.stop)
        collector.subscribe()
        collector.poll_once()
        return collector

    def advance_to(self, state: str, milestones: list[dict] | None = None) -> None:
        """Aplica una transición sintética del productor, como lo haría el helper real."""

        closure = json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))
        closure["state"] = state
        closure["retained"] = state in {"retaining", "closing", "complete"}
        closure["cleanup"] = "not_needed" if state == "complete" else "pending"
        if milestones is not None:
            data, descriptor = trace_event_bytes(milestones)
            (self.run / "trazabilidad.jsonl").write_bytes(data)
            closure["trace"] = descriptor
        data = canonical_json_bytes(closure)
        (self.run / "cierre.json").write_bytes(data)
        marker = json.loads((self.run / ".review-ownership.json").read_text(encoding="utf-8"))
        import hashlib

        marker["manifest_sha256"] = hashlib.sha256(data).hexdigest()
        marker.pop("previous_manifest_sha256", None)
        (self.run / ".review-ownership.json").write_bytes(canonical_json_bytes(marker))

    def test_prepared_to_processing_is_observed_as_activity(self) -> None:
        collector = self.collector()
        self.advance_to("processing")
        notices = collector.poll_once()
        self.assertTrue(notices)
        view = collector.catalog.get_run(collector.catalog.locations()[0].key)
        self.assertEqual(view["summary"]["archive_state"], "processing")
        state, _ = derive_display_state(view, True)
        self.assertEqual(state, "open_recent_activity")

    def test_prepared_only_change_does_not_imply_discovery(self) -> None:
        collector = self.collector()
        self.advance_to("prepared")
        collector.poll_once()
        view = collector.catalog.get_run(collector.catalog.locations()[0].key)
        _, phase = derive_display_state(view, True)
        self.assertIsNone(phase)

    def test_full_lifecycle_reaches_complete_without_regression(self) -> None:
        collector = self.collector()
        for state in ("processing", "retaining", "closing", "complete"):
            self.advance_to(state)
            collector.poll_once()
            view = collector.catalog.get_run(collector.catalog.locations()[0].key)
            self.assertEqual(view["summary"]["archive_state"], state)

    def test_closing_checkpoint_does_not_regress_to_processing(self) -> None:
        collector = self.collector()
        self.advance_to("closing")
        collector.poll_once()
        self.advance_to("closing")
        collector.poll_once()
        view = collector.catalog.get_run(collector.catalog.locations()[0].key)
        self.assertEqual(view["summary"]["archive_state"], "closing")
        state, _ = derive_display_state(view, True)
        self.assertEqual(state, "result_available_closure_pending")

    def test_pending_trace_keeps_previous_snapshot_as_updating(self) -> None:
        collector = self.collector()
        closure = json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))
        closure["pending_trace"] = {"trace": None, "sha256": None, "event": {"kind": "check"}}
        (self.run / "cierre.json").write_bytes(canonical_json_bytes(closure))
        collector.poll_once()
        key = collector.catalog.locations()[0].key
        snapshot = collector.catalog.snapshot(key)
        self.assertTrue(snapshot["updating"])
        self.assertIsNotNone(json.loads((self.run / "cierre.json").read_text(encoding="utf-8"))["pending_trace"])

    def test_transition_never_writes_to_the_archive(self) -> None:
        collector = self.collector()
        before = archive_inventory(self.root)
        self.advance_to("processing")
        producer_after = archive_inventory(self.root)
        collector.poll_once()
        self.assertEqual(archive_inventory(self.root), producer_after)
        self.assertNotEqual(before, producer_after)

    def test_real_thread_notices_a_change_within_four_seconds(self) -> None:
        catalog = Catalog(self.root)
        catalog.refresh()
        collector = LiveCollector(catalog, clock=time.monotonic)
        client = collector.subscribe()
        collector.poll_once()
        try:
            self.advance_to("processing")
            deadline = time.monotonic() + 4
            seen: list[dict] = []
            while time.monotonic() < deadline and not seen:
                try:
                    seen.append(client.get(timeout=0.25))
                except Exception:  # noqa: BLE001 - Empty se trata como "aún no"
                    continue
            self.assertTrue(seen, "el colector no publicó ningún aviso a tiempo")
        finally:
            collector.stop()


if __name__ == "__main__":
    unittest.main()