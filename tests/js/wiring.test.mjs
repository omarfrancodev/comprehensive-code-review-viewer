import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlayback } from "../../src/ccr_viewer/web/playback.js";

test("el orden temporal intercala instantes efectivos de distintas bases", () => {
  const playback = createPlayback([
    { event_id: "E000001", sequence: 1, temporal_basis: "observed_occurrence", temporal_at: "2026-09-01T15:00:00Z" },
    { event_id: "E000002", sequence: 2, temporal_basis: "recording_fallback", temporal_at: "2026-09-01T10:00:00Z" },
  ]);
  assert.deepEqual(playback.temporalOrder(), ["E000002", "E000001"]);
});
