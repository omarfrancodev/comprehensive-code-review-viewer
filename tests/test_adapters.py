"""Pruebas del adaptador de presentación y del catálogo."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ccr_viewer.adapters import Catalog, adapt_run, normalize_repository_identity
from ccr_viewer.discovery import RunLocation, run_key
from ccr_viewer.snapshots import read_snapshot

from fixtures import archive_inventory, build_archive, with_overrides


def location_for(run: Path, root: Path) -> RunLocation:
    relative = run.resolve().relative_to(root.resolve()).as_posix()
    return RunLocation(key=run_key(relative), path=run.resolve(), relative_path=relative)


class RepositoryIdentityTests(unittest.TestCase):
    def test_scheme_and_git_suffix_are_stripped_for_comparison_only(self) -> None:
        self.assertEqual(
            normalize_repository_identity("https://git.example.invalid/acme/demo.git"),
            normalize_repository_identity("git.example.invalid/acme/demo"),
        )

    def test_host_and_namespace_are_preserved(self) -> None:
        self.assertNotEqual(
            normalize_repository_identity("git.uno.invalid/acme/demo"),
            normalize_repository_identity("git.dos.invalid/otro/demo"),
        )
        self.assertNotEqual(
            normalize_repository_identity("git.ejemplo.invalid/acme/demo"),
            normalize_repository_identity("git.ejemplo.invalid/otra/demo"),
        )

    def test_bare_basename_is_never_enough(self) -> None:
        self.assertNotEqual(
            normalize_repository_identity("git.ejemplo.invalid/acme/demo"),
            normalize_repository_identity("git.ejemplo.invalid/otro/demo"),
        )


class AdaptRunTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def view_for(self, variant: str, *overrides: str) -> dict:
        run = with_overrides(variant, *overrides)(self.root)
        location = location_for(run, self.root)
        return adapt_run(location, read_snapshot(location))

    def test_legacy_review_keeps_original_profile_and_missing_identity(self) -> None:
        view = self.view_for("legacy_v3")
        self.assertEqual(view["review"]["profile"], "economy")
        self.assertIsNone(view["summary"]["source_review_id"])
        self.assertEqual(view["compatibility"], "historical")

    def test_api_version_and_source_versions(self) -> None:
        view = self.view_for("final_v7")
        self.assertEqual(view["api_version"], 1)
        self.assertEqual(
            view["source_versions"], {"review": 7, "closure": 5, "trace": 1}
        )
        self.assertEqual(view["compatibility"], "supported")

    def test_summary_preserves_source_values(self) -> None:
        view = self.view_for("final_v7")
        summary = view["summary"]
        self.assertEqual(summary["source_review_id"], "CR-1111111111111111aaaa")
        self.assertEqual(summary["profile"], "extended")
        self.assertEqual(summary["verdict"], "approvable_with_reservations")
        self.assertEqual(summary["archive_state"], "complete")
        self.assertEqual(summary["presentation_kind"], "review")

    def test_legacy_profile_is_not_normalized(self) -> None:
        view = self.view_for("legacy_v5")
        self.assertEqual(view["review"]["profile"], "extended")
        self.assertEqual(view["summary"]["profile"], "extended")
        self.assertNotEqual(view["summary"]["profile"], "focused")

    def test_unknown_schema_is_limited_and_preserves_unknown_fields(self) -> None:
        view = self.view_for("unknown_v99")
        self.assertEqual(view["compatibility"], "limited")
        self.assertEqual(view["review"]["schema_version"], 99)
        self.assertEqual(view["review"]["campo_futuro"], {"estado": "desconocido"})
        self.assertEqual(view["review"]["presentation"]["kind"], "revision-futura")
        self.assertEqual(view["source_versions"]["review"], 99)

    def test_schema_less_closure_is_limited(self) -> None:
        view = self.view_for("schema_less")
        self.assertEqual(view["compatibility"], "limited")
        self.assertIsNone(view["source_versions"]["closure"])
        self.assertEqual(view["closure"]["state"], "complete")

    def test_processing_is_supported_only_in_archive_schema_5(self) -> None:
        view = self.view_for("processing_archive_v5")
        self.assertEqual(view["summary"]["archive_state"], "processing")
        self.assertEqual(view["compatibility"], "historical")
        self.assertFalse(
            any(item["code"] == "closure.invalid_state" for item in view["diagnostics"])
        )

    def test_processing_in_archive_schema_4_is_invalid(self) -> None:
        view = self.view_for("invalid_processing_archive_v4")
        invalid = [
            item for item in view["diagnostics"] if item["code"] == "closure.invalid_state"
        ]
        self.assertTrue(invalid)
        self.assertIn("4", invalid[0]["message"])
        self.assertEqual(view["compatibility"], "limited")

    def test_prepared_in_archive_schema_4_stays_historical(self) -> None:
        view = self.view_for("legacy_archive_v4")
        self.assertEqual(view["summary"]["archive_state"], "prepared")
        self.assertEqual(view["compatibility"], "historical")
        self.assertFalse(
            any(item["code"] == "closure.invalid_state" for item in view["diagnostics"])
        )

    def test_direct_prepared_retention_does_not_invent_a_discovery_start(self) -> None:
        view = self.view_for("prepared_archive_v5")
        self.assertEqual(view["summary"]["archive_state"], "prepared")
        self.assertIsNone(view["summary"]["phase"])
        self.assertEqual(view["summary"]["display_state"], "open_activity_unknown")

    def test_closing_checkpoints_do_not_regress(self) -> None:
        view = self.view_for("final_v7")
        self.assertEqual(view["summary"]["archive_state"], "complete")
        self.assertEqual(view["summary"]["display_state"], "closed")

    def test_unknown_version_state_is_preserved_with_limited_compatibility(self) -> None:
        view = self.view_for("unknown_v99")
        self.assertEqual(view["summary"]["archive_state"], "future_state")
        self.assertEqual(view["compatibility"], "limited")

    def test_missing_review_stays_absent_not_invented(self) -> None:
        view = self.view_for("prepared_archive_v5")
        self.assertIsNone(view["review"])
        self.assertIsNone(view["summary"]["verdict"])
        self.assertIsNone(view["summary"]["source_review_id"])

    def test_finding_counts_separate_confirmed_unresolved_and_rejected(self) -> None:
        view = self.view_for("final_v7")
        counts = view["summary"]["finding_counts"]
        self.assertEqual(counts["confirmed"]["P2"], 1)
        self.assertEqual(counts["confirmed"]["P0"], 0)
        self.assertEqual(counts["rejected"], 1)
        self.assertNotIn("F002", str(counts["confirmed"]))

    def test_corrupt_review_does_not_hide_the_run(self) -> None:
        view = self.view_for("corrupt_json")
        self.assertIsNone(view["review"])
        self.assertTrue(view["diagnostics"])
        self.assertEqual(view["summary"]["archive_state"], "complete")

    def test_rereview_rows_are_preserved_verbatim(self) -> None:
        view = self.view_for("rereview_v7")
        rows = view["review"]["rereview"]
        self.assertEqual(rows[0]["previous_review_id"], "CR-0000000000000000bbbb")
        self.assertEqual(rows[0]["previous_finding_id"], "F001")
        self.assertEqual(view["review"]["previous_reviews"][0]["verified"], True)

    def test_scope_label_keeps_source_mode_and_reference(self) -> None:
        view = self.view_for("final_v7")
        self.assertEqual(view["summary"]["scope_label"], "pr 42")

    def test_snapshot_diagnostics_reach_the_view(self) -> None:
        view = self.view_for("final_v7", "nan")
        codes = {item["code"] for item in view["diagnostics"]}
        self.assertIn("snapshot.invalid_constant", codes)


class CatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self._temporary.cleanup)
        self.root = Path(self._temporary.name)

    def test_pagination_is_exact(self) -> None:
        for index in range(5):
            build_archive(self.root, "final_v7")
        catalog = Catalog(self.root)
        catalog.refresh()
        page = catalog.list_runs({}, offset=0, limit=2)
        self.assertEqual(page["total"], 5)
        self.assertEqual(len(page["items"]), 2)
        self.assertTrue(page["truncated"])
        self.assertEqual(catalog.list_runs({}, offset=4, limit=2)["items"].__len__(), 1)
        self.assertFalse(catalog.list_runs({}, offset=5, limit=2)["truncated"])

    def test_limit_is_capped_at_page_size(self) -> None:
        build_archive(self.root, "final_v7")
        catalog = Catalog(self.root)
        catalog.refresh()
        self.assertEqual(catalog.list_runs({}, offset=0, limit=500)["limit"], 50)

    def test_open_filter_matches_non_final_states(self) -> None:
        build_archive(self.root, "final_v7")
        build_archive(self.root, "processing_archive_v5")
        catalog = Catalog(self.root)
        catalog.refresh()
        self.assertEqual(catalog.list_runs({}, limit=50)["total"], 2)
        self.assertEqual(catalog.list_runs({"open": "true"}, limit=50)["total"], 1)
        self.assertEqual(catalog.list_runs({"verdict": "approvable_with_reservations"})["total"], 1)

    def test_unknown_key_is_rejected(self) -> None:
        build_archive(self.root, "final_v7")
        catalog = Catalog(self.root)
        catalog.refresh()
        with self.assertRaises(KeyError):
            catalog.get_run("0" * 32)

    def test_get_run_returns_a_review_view(self) -> None:
        build_archive(self.root, "final_v7")
        catalog = Catalog(self.root)
        catalog.refresh()
        key = catalog.locations()[0].key
        self.assertEqual(catalog.get_run(key)["api_version"], 1)

    def test_unchanged_refresh_performs_no_fresh_reads(self) -> None:
        for index in range(1000):
            run = self.root / ("run" + str(index))
            run.mkdir()
            (run / "cierre.json").write_text("{}", encoding="utf-8")
        catalog = Catalog(self.root)
        catalog.refresh()

        import ccr_viewer.snapshots as snapshots_module

        real_read = snapshots_module.read_bounded
        counter = {"count": 0}

        def counting(root: Path, relative: str, limit: int):
            counter["count"] += 1
            return real_read(root, relative, limit)

        with mock.patch.object(snapshots_module, "read_bounded", counting):
            catalog.refresh()
        self.assertEqual(counter["count"], 0)

    def test_refresh_does_not_modify_the_archive(self) -> None:
        build_archive(self.root, "final_v7")
        build_archive(self.root, "prepared")
        before = archive_inventory(self.root)
        catalog = Catalog(self.root)
        catalog.refresh()
        catalog.get_run(catalog.locations()[0].key)
        self.assertEqual(archive_inventory(self.root), before)


if __name__ == "__main__":
    unittest.main()