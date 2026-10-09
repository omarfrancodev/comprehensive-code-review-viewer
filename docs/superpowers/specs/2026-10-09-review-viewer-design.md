# Comprehensive Code Review Viewer — Design

**Date:** 2026-10-09 (America/Mexico_City).
**Owner:** omarfrancodev.
**Status:** handoff requested by the user; implementation intentionally deferred to another session.
**Scope:** independent local viewer. Producer/skill changes belong to a separate repository and session.
**Related plan:** [Implementation plan](../plans/2026-10-09-review-viewer-implementation.md).

## 1. Purpose and approved decisions

Build a standalone local web application that lets the user understand a review and its observed lifecycle without manually interpreting directories, Markdown, JSON or JSONL. It must open the default persistent archive or an explicit root; navigate projects/scopes/runs; combine the review and closure into a review profile; render Markdown; follow new persisted milestones; and replay a trace step by step or automatically.

Approved architecture: independent public repository, Python local read-only server, HTML/CSS/JavaScript frontend, separate installation/releases, no dependency on a running agent or installed skill.

The user requested a detailed written spec and Superpowers plan now, for implementation in another session. This handoff does not authorize that session to merge or release without its user integration gate. No executable product exists at the time this document is published.

### Non-goals

- Producing reviews, fixing code, invoking agents or publishing review comments.
- Editing artifacts, recovering helper transactions, deleting archives or managing worktrees.
- Reconstructing missing historical events, identities, timestamps or verdicts.
- Mandatory cost measurements, risk/quality scores, one reviewer per ABCDE area or new producer overhead.
- Database, cloud service, remote multi-user hosting, authentication provider or desktop wrapper.
- Reading scratch/worktrees referenced in closure or executing retained reproduction scripts.
- Full semantic validation of whether a finding is true.
- Portable delivery import in v0.1: full/brief deliveries have separate receipts and less information; they may be designed later without presenting them as canonical archives.

## 2. Evidence and producer boundary

The local archive inspection found 11 final review records and 3 prepared executions at the first snapshot. Final records included schemas 3, 5 and 7; canonical closures included schemas 3/4 and historical closure objects without a schema. Both old folder naming and canonical three-level run layouts were present. Old profiles, legacy IDs and previous-run links existed. Final traces had 8/9 events; open traces changed during inspection, proving milestone following is possible.

One retained evidence hash differed from closure, while a separate completed archive passed its producer validation. The viewer must present integrity independently from code verdict and cleanup.

This document intentionally includes no private repository names, proprietary findings, actual artifacts, account identities or production URLs from that inspection.

### Available producer contracts

Canonical source of truth: published skill v2.9.0, tag `v2.9.0` at commit `7828852aaab390ebfeca78b229964f0b04af82d8` in [the producer repository](https://github.com/omarfrancodev/comprehensive-code-review/tree/v2.9.0). Pin this tag/commit and the following source paths in compatibility metadata; do not import the installed skill.

- `references/contracts/result-contract.md`: final review schemas 1–7; exact field availability depends on version. Final schema 7 remains unchanged.
- `references/archive/artifacts.md` and `scripts/review_artifacts.py`: archive/closure schemas 1–5, ownership, retention and closure.
- `references/archive/lifecycle-trace.md` and `scripts/review_trace.py`: trace schema 1, unchanged field set and hash algorithm.
- `references/contracts/identifiers.md`, `references/workflow/re-review.md`, `references/workflow/review-areas.md`: identity, linkage and coverage.
- `references/reporting/report-format.md`, `references/reporting/delivery.md`, `references/reporting/handoff.md`: report presentation, explicit deliveries and historical handoff. Deliveries remain outside v0.1 archive import scope.

References now belong to six responsibility groups: `workflow/`, `execution/`, `contracts/`, `archive/`, `reporting/`, `maintenance/`. These are producer documentation locations, not review artifact directories or runtime dependencies. Future reorganizations require updating pinned provenance, not searching an installed skill.

Archive schema 5 supports `prepared → processing → retaining → closing → complete`. Schemas 1–4 retain `prepared|retaining|closing|complete`; `processing` in schema 4 is invalid, not a supported historical value. Unknown future schemas remain limited and preserve raw values. The earlier inspection above is a historical snapshot, not a claim that those archives have schema 5.

The first observed milestone with kind `agent|discovery|check|grouped-verification` and status `started|completed|passed|failed|blocked|skipped` moves schema 5 from prepared to processing in the existing trace append transaction. Planned/pending assignments, profile selection, registration, authorization and preparatory validation do not start processing. A terminal result can be the first exposed milestone; direct retention from prepared remains compatible and does not invent a past start. Checkpoints in closing do not regress the state. Processing means work began, not that a process is currently alive or that continuous activity is observable.

The coordinator remains the sole durable writer. Helper milestones now capture their logical operation's UTC `occurred_at` with source `review_artifacts:<kind>`; `recorded_at` is captured separately at recording. Native events use exposed source times only. Optional existing runner metadata maps started to started_at and completed/passed/failed/blocked/skipped to finished_at, with source `review_runner:<metadata path>`; these are wrapper boundaries, not model activity. Missing times/participants remain unknown; no measurements or metadata collection is required. Recovery preserves the original event bytes and times. The viewer reads these facts and never triggers mutations, recovery or additional producer work.

## 3. Runtime and distribution

Global constraints (copied verbatim into the plan):

- Runtime: Python >=3.10, Python standard library backend, HTML/CSS/native ES modules frontend, no frontend framework or runtime Node requirement.
- Development: Node >=22, exact dependency pins in package-lock.json, Python unittest, Node built-in tests and Playwright 1.64.0 browser tests.
- Browser vendor pins: marked 18.1.0 and DOMPurify 3.4.16, shipped locally with version/source/hash/license inventory; no runtime CDN requests.
- Server: bind only 127.0.0.1; default port 0; no remote-host option; read-only archive access.
- Root precedence: --root, then CCR_ARTIFACTS_DIR, then Path.home()/.comprehensive-code-review/reviews.
- Live limits: metadata poll 2 seconds, library rescan 10 seconds, active-change window 120 seconds, SSE heartbeat 15 seconds, page size 50, maximum 5000 runs, client queue 128 notices, replay buffer 256 notices.
- Input limits: metadata JSON 8 MiB, trace 8 MiB and 10000 events, text preview 2 MiB, evidence hash streaming chunks 1 MiB, stable-read retries 3 with 50 ms delay.
- Artifact guarantees: never write, repair, migrate, rename, delete or checkpoint archives; never invent source IDs, execution timestamps, participants, dependencies or verdicts.
- Public fixtures: synthetic only; no real review contents, repository URLs, user paths, notes or proprietary source committed.
- UI: Spanish labels, preserve original IDs/values, support keyboard use, reduced motion and both light/dark themes.

Use Python packaging with project name `comprehensive-code-review-viewer`, package `ccr_viewer`, console entrypoint `ccr-viewer = ccr_viewer.cli:main`. Ship static resources in the package wheel. `python -m ccr_viewer` invokes the same entrypoint. Editable installation and `pipx install .` are developer/user alternatives after implementation; exact published registry distribution is a separate owner-authorized release.

CLI options: `--root PATH`, `--port INTEGER` (0..65535), `--no-browser`, `--version`. No `--host`. Print the actual local launch URL; open a browser unless suppressed. Reject an inaccessible/invalid explicit root without changing it or silently falling back. A missing default root reports instructions, creates nothing and exits nonzero.

Resolve a selected directory containing direct run sentinels as that run root. Otherwise, if it contains a real non-reparse `reviews/` child, use that child. Otherwise treat the selected directory as the archive root. Display the resolved path. Root changes require restarting with `--root` in v0.1.

The project license is not assigned by this handoff. Do not infer a license grant from public visibility. Preserve third-party licenses; obtain the owner's project-license decision before a distributable public release.

## 4. Component boundaries

Use a source layout, not files nested inside the skill:

```text
src/ccr_viewer/
  __init__.py, __main__.py, cli.py
  paths.py, discovery.py, snapshots.py
  adapters.py, references.py, integrity.py, trace.py
  live.py, server.py
  contracts/compatibility.json
  web/
    index.html, styles.css, app.js, api.js, store.js
    library.js, profile.js, findings.js, validation.js
    documents.js, markdown.js, lifecycle.js, playback.js
    vendor/marked.esm.js, purify.es.mjs, manifest.json, LICENSE.*
contracts/sources.md
tests/test_*.py, fixtures.py, fixtures/
tests/js/*.test.mjs
tests/browser/*.spec.mjs
tools/vendor.mjs
pyproject.toml, package.json, package-lock.json, playwright.config.mjs
```

Responsibilities:

- Paths: root selection, containment and reparse/link policy; no arbitrary path serving.
- Discovery: catalog runs without walking build/scratch trees.
- Snapshots: coherent bounded reads of changing metadata.
- Adapters: preserve source fields while exposing a stable presentation model.
- References: local lineage/evidence resolution without network access.
- Integrity: byte hashes, ownership/layout checks supported by the pinned contract, explicit validation levels.
- Trace: event validation, identities, relations and separate presentation order.
- Live: one shared collector per process/root and SSE notices.
- Server: loopback-only HTTP, session/Host/Origin checks, routing and packaged assets.
- Frontend: rendering and transient UI state; archive content never becomes instructions.

Runtime compatibility metadata lives in src/ccr_viewer/contracts/compatibility.json and is shipped as package data. Contract data is maintained as pinned local compatibility metadata and synthetic conformance tests, not a third shared package. Include the producer tag and source paths in `contracts/sources.md`. Do not fetch contracts or imports at runtime. Subsequent support changes require explicit fixture-backed updates.

## 5. Discovery and root access

Detect a run directory when it contains any regular sentinel: `cierre.json`, `review.json`, `informe.md` or `trazabilidad.jsonl`. Stop descending that run for catalog purposes. Ignore `evidence/`, hidden staging files, `.git/`, `.worktrees/`, dependency trees and links/reparse directories. Maximum traversal depth is 6 below the selected root. Report truncation when depth/run limits exclude content; do not silently advertise a complete library.

Do not require current naming, an ownership marker, a final report or a functioning original checkout to discover a historical run. A malformed run remains visible with a diagnostic; it must not make other runs unavailable.

Run keys: first 32 lowercase hex of SHA-256 over the normalized archive-relative directory encoded UTF-8. Detect collisions and report them instead of merging. Keys are viewer identities, not substituted `review_id`. File keys are opaque per-session catalog identities; requests never accept arbitrary client paths.

Group by normalized verified repository identity where available. Strip an optional HTTPS scheme and terminal .git only for identity comparison; retain host and full namespace. Never merge repositories by basename alone. Unknown identity yields a distinct path-based group. Keep every original run path and scope; re-review changes of scope hash do not break verified lineage.

List at most 50 runs per page, latest recorded creation time first, null creation time last, tie by run key. Repository, scope mode/reference, presentation kind, profile, verdict, date and open/closed filters use source metadata. Preserve old profile values; an explanatory equivalence may be labeled historical, never replace the original field.

## 6. Stable snapshots and normalized model

Atomically replacing individual files does not make the whole directory transaction atomic. Read closure/ownership metadata before and after relevant files. Compare bytes/digests and stat signatures, descriptor and pending markers. Retry at most 3 times with 50 ms delay when metadata changes or `pending_trace`/`planned_hashes` indicates a transition. Preserve the last coherent in-memory snapshot and expose `updating`. Never invoke recovery or alter the producer marker.

A persistent parse/hash mismatch after the retry limit is a diagnostic, not automatic corruption of all fields. A new run can have closure/trace and no review/report. An open run's partial trace has not completed final archive retention.

Presentation model API version is 1 and independent of producer schemas:

```text
RunSummary = {
  key, repository_label, scope_label, created_at,
  source_review_id: string|null, profile: string|null, verdict: string|null,
  archive_state: string|null, display_state, phase: string|null,
  last_recorded_at: string|null, recently_observed_change: bool,
  presentation_kind: string|null, finding_counts, capabilities, diagnostics
}
ReviewView = {
  api_version: 1, summary: RunSummary,
  source_versions: {review: int|null, closure: int|null, trace: int|null},
  compatibility: supported|historical|limited,
  review: object|null, closure: object|null,
  lineage: ResolvedReference[], files: FileEntry[], diagnostics: Diagnostic[]
}
Diagnostic = {code, severity: info|warning|error, message, source: string|null}
FileEntry = {key, name, relative_path, media_kind, bytes, available}
ResolvedReference = {
  raw, status: resolved|missing|ambiguous|external|outside_root,
  run_key: string|null, file_key: string|null, fragment: string|null,
  candidates: string[]
}
TraceView = {
  events: object[], valid_prefix_length: int,
  chain_status: verified|limited|failed|updating,
  temporal_order: string[], relations: object[], diagnostics: Diagnostic[]
}
IntegrityReport = {
  status: verified|limited|failed|updating,
  checks: {name, status, detail}[], diagnostics: Diagnostic[]
}
```

Supported review schema versions are 1–7. Unknown versions/fields/enums remain in `review`/`closure` and a raw JSON viewer; use known fields conservatively with `limited` compatibility. Do not label unknown-schema semantic/ownership validation verified. Canonical closure schemas 1–5 have adapter-specific checks, including version-specific allowed states; schema-less historic closures render the available fields but identity/ownership assurance is limited.

A schema number alone is not proof of valid content. Shape validation covers field types and version availability; semantic finding truth and attributed authorship remain producer assertions.

## 7. Review profile and documents

The sidebar shows project → scope → runs and a separate open-runs filter. The central header shows title from source `presentation`, source review ID or an explicitly viewer-local key, exact base/head/snapshot and source verdict/reason. For legacy missing `presentation`, show Code Review without guessing re-review type.

Tabs:

1. **Ficha:** profile/reason; scope/target/reference; responsible separately from change authors; skill version/harness; stale/verification limits; ABCDE coverage when available; executor isolation/dependency declarations; archive state and cleanup separately.
2. **Hallazgos:** confirmed, unresolved and rejected separated. Primary count uses confirmed only; counts P0–P3 always display 0 when zero. Unknown priorities have their own group. Blocking is independent of priority. Cards show exact ID/title/location/scenario/impact/correction, short evidence and actual check references.
3. **Validación:** check ID, status, meaningful output, actual revision, reuse reason, rerun reason and failure class. Empty checks show no checks recorded, not a pass badge. Baseline/reused checks retain their source revision.
4. **Seguimiento:** resolved/still_valid/withdrawn/new/not_reevaluated as stored, previous titles and IDs, aliases and prior review links. A resolved entry need not exist in current findings. Do not renumber grandfathered IDs.
5. **Documentos:** Markdown report plus selected regular .md artifacts available under the archive. Also bounded plain text/JSON viewing. No execution buttons for code/scripts/logs.
6. **Trazabilidad:** observed milestones with controls described below.
7. **Archivo:** per-file integrity results, supported/limited checks, root, closure state, cleanup and declared residuals. Former executor paths are historical text, not filesystem access grants.

A metadata value says declared/recorded where actual verification has not established it. Existing source verdict is not recalculated from UI counts or archive-integrity status.

Markdown: marked 18.1.0 parses GFM; reject source raw HTML tokens (render them as escaped text), then sanitize output with DOMPurify 3.4.16 before DOM insertion. Permit only standard Markdown tags/headings/tables/code and safe application-owned classes; no script, iframe, style, form, embedded SVG/MathML or event attributes. Local links resolve through the reference resolver. Remote HTTP(S) links require an explicit click, `noopener noreferrer`; never fetch them. Disable automatic images/media loading and render alternative text. Block javascript/data/file schemes and absolute local navigation. Application-owned trace SVG can be built with DOM APIs and textContent outside the Markdown pipeline.

Keep Markdown heading levels and line-break semantics from the document; structured profile cards do not replace the original report. Spanish UI, English technical values preserved where meaningful.

## 8. Linkage and integrity

Source references may be absolute old archive paths, archive-relative paths, `evidence/foo.json`, a bare basename or a URL; they may include a fragment. Resolve only within the chosen root. For a bare basename, exact run-root match first, then a unique regular file in that run's evidence inventory. Multiple matches are ambiguous; never choose silently. An external/missing/outside-root reference is text with a reason, not an automatic file read.

Previous review linkage uses source `previous_reviews` and closure `previous_run`. A null historical review ID stays null. Matching current directory names or IDs alone does not prove the source's verified claim. If a relocated path can be matched to an actual source review ID, show the match basis and diagnostics; do not rewrite the reference. Do not search user home or old scratch to repair links.

Integrity validation is explicit/on demand, with streaming SHA-256 for retained files. It must check known required metadata/IDs, supported ownership marker/layout binding, recorded inventory/hashes and trace chain/descriptor where applicable. Evidence absence/mismatch is shown per file. Unknown/schema-less archives can have valid individual hashes without fully verified identity; overall status stays limited.

Trace schema 1 digest: UTF-8 JSON with sorted keys, separators comma/colon, ensure_ascii=false, allow_nan=false; hash the full event excluding `sha256`. Verify `previous_sha256`, contiguous positive sequence, `E000001` six-digit event IDs, run/review IDs and descriptor tip/count. A modified archived file does not change the source code verdict. No cryptographic signature/authenticated-person claim is made by these hashes.

UTF-8 input may contain a BOM, removed only for parsing, not for byte hashes. Reject JSON NaN/Infinity; duplicate keys produce a diagnostic and disable full integrity verification. Reject oversized metadata before parsing.

## 9. Live following

The backend shared collector polls active run metadata every 2 seconds while clients subscribe; rescans the bounded library every 10 seconds; stops background polling when no clients subscribe. Initial/manual API reads refresh stale catalog data. Stat caching avoids reading unchanged reports/evidence. Hashing every evidence file on each tick is forbidden.

One SSE stream per browser app carries notices for the library and selected run. Do not open one connection per run. Notices describe a new coherent version, not fabricated producer events:

```text
Notice = {
  cursor: integer, kind: catalog_changed|run_changed|resync,
  run_key: string|null, fingerprint: string|null
}
```

Keep 256 notices in a bounded process-memory replay buffer. Client queues hold 128 notices; overflow becomes resync. Heartbeat comments every 15 seconds; do not turn them into archive activity. Last-Event-ID resumes if available; otherwise issue resync and reload a coherent snapshot. Empty/disconnected server status is distinct from run state.

Derived display states:

- source complete → closed (cleanup pending remains an explicit separate warning).
- source closing or retained final record with pending closure → result_available_closure_pending.
- observed interruption milestone → interruption_recorded unless later explicit resumed/working milestone supersedes it.
- other open state with an observed file change within 120 seconds → open_recent_activity.
- other open state → open_activity_unknown.

Show schema 5 `processing` as “trabajo iniciado”, separately from the derived activity state. Initial `processing` or `updated_at` alone does not prove recent activity or a live process. A changed prepared run can reflect setup; do not label it discovery unless an explicit milestone supports that phase. Phase comes from explicit trace milestone kinds/statuses, never a directory name or free-text summary parsing. Blocked/failed checks remain local results; do not assert the whole review stopped. No percentage from event counts. The app shows last registered update and, separately, when the viewer last detected a change.

When review.json/informe.md appear, enable their tabs without resetting selection/scroll. Evidence references can be unavailable before retention. The viewer does not follow former temporary paths to display early candidates or logs.

## 10. Trace playback, timing and relations

Modes: live follow; paused review of buffered events; historical playback. Controls: previous/next, play/pause, slider, start/end and speed 0.5x/1x/2x/4x. Fixed playback interval is 800 ms at 1x. This interval is visualization speed, never claimed execution duration. Disable animation with prefers-reduced-motion while retaining steps/selection.

Default temporal view uses declared valid `occurred_at`, otherwise valid `recorded_at`; sort by that time then sequence, and label each event `observed occurrence` or `recording fallback`. Distinguish helper logical-operation times, runner wrapper boundaries and native source times using recorded provenance. If neither timestamp is usable in a limited/invalid source, keep an untimed row after timed rows in sequence order, labeled `sequence fallback`; diagnose the missing time without synthesizing one. The canonical recording-order list is always available and remains sequence-ordered. Mixed sources/time bases do not establish a global execution order. Show timestamps in the browser zone, UTC in detail, and their provenance source. Preserve event IDs/hash order regardless of presentation sorting.

Do not fill missing occurrence time from narrative, recorded_at or current time. Historical trace schema 1 events may legitimately have null occurred_at or a non-null occurrence with null provenance.source; preserve them without applying schema 5 emission requirements retroactively. New schema 5 external event emission requires an identifiable source for a non-null occurrence; this is distinct from unchanged trace schema 1 structural verification. Existing runner measurements can be displayed only if an explicit retained source provides them; require compatible source identity for a duration. Do not subtract two fallback recording times and label the result execution time. Negative/inconsistent timing gets a warning.

Relations use the producer's `relation,target` pairs. Recognize same-run `E000001`, `F001`, `C001` and known cross-review `CR-<20-hex-run-id>#E000001|F001|C001` forms. Resolve cross-review targets only against the selected root/catalog, without searching former paths or fetching archives. Bounded legacy/noncanonical/external targets remain raw unresolved text. Known relation types: verifies, supports, depends_on, follows, reuses, supersedes, records, generated_from. Existing limits remain 24 relations and 8 KiB per event.

Schema 5 emission requires same-run six-digit E targets to exist earlier in the trace; self/future/missing events fail before mutation. This emission rule does not retroactively invalidate historical trace schema 1 chains. F/C targets can be assigned candidates later discarded; absence from the final record is an unresolved-reference diagnostic, not archive or hash-chain corruption. Report dangling/ambiguous targets and cycles separately from byte integrity; never add causal edges from mere recording adjacency or matching summaries/ABCDE areas.

Offer a primary event sequence and optional participant lanes/dependency connections only where recorded actor/executor and explicit relations justify them. Recorder, actor and executor are separate detail fields. Do not extract agents from summary text to manufacture lanes. No trace → unavailable message. Invalid/truncated trace → valid prefix with conspicuous limitation and no fully verified badge.

In live mode, paused replay retains its current event and displays a new-events counter. Resume-live jumps to the latest coherent event; new events with earlier occurred_at do not renumber old events or silently move a paused cursor.

## 11. HTTP and local data protection

Use a dedicated ThreadingHTTPServer handler; never expose the archive via generic directory serving. Resources are a finite packaged static allowlist; archive files are opaque IDs resolved by the catalog.

Bind 127.0.0.1 with an OS-selected port unless explicitly set. Reject other bind targets. Validate Host against the exact selected authority on every request; deny cross-origin requests and cross-site Fetch Metadata where present. No wildcard CORS. A local capability token generated with secrets.token_urlsafe(32) is delivered in the startup URL fragment, never query/log path. Bootstrap POST /api/session sends it in the body, strips the fragment from browser history and sets an HttpOnly SameSite=Strict session cookie scoped to /. Use that cookie for API/SSE; EventSource cannot send a custom token header. The cookie is loopback HTTP, not a public HTTPS auth design.

Bootstrap requires the exact same Origin, Host and token; GET/POST API requests reject wrong Origin when provided. CLI --no-browser prints the capability URL for manual opening. Do not log tokens, request bodies or artifact contents. All API POST operations are in-memory session establishment or read-only validation; none write artifacts.

Reject symlinks/junctions/reparse points in the selected root and accessible files/ancestors. Containment uses resolved Path ancestry and platform case rules. Every content read/hash must use a protected file-handle opener: validate the opened handle remains under the frozen root before reading bytes, not only before returning them. On POSIX, walk components relative to the root directory descriptor with no-follow semantics; on Windows use standard-library ctypes handle-path verification (GetFinalPathNameByHandleW) plus reparse checks. If the handle/ancestor identity cannot be verified, fail closed. Concurrent path replacement returns a diagnostic rather than an outside-root read. Never pass user file content to shells, evaluators, subprocesses or the browser as executable script.

CSP: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'. Also nosniff and no-store for private API/documents. Remote source links open only after a click. Static CSS has no inline style attributes. No runtime telemetry/network fetches outside the loopback origin.

## 12. API endpoints and errors

JSON endpoints return `{api_version:1,data:...,diagnostics:[]}`. Error envelope: `{api_version:1,error:{code,message}}`.

- POST /api/session: body {token}; creates in-memory cookie session.
- GET /api/config: resolved root, limits, package version, compatibility capabilities.
- GET /api/runs: filters q/repository/mode/kind/profile/verdict/open, offset>=0, limit 1..50; returns {items:RunSummary[],total,truncated}.
- GET /api/runs/{run_key}: ReviewView.
- GET /api/runs/{run_key}/trace: TraceView.
- GET /api/runs/{run_key}/files: FileEntry[].
- GET /api/runs/{run_key}/files/{file_key}: bounded preview envelope {text,media_kind,truncated,total_bytes}; no direct browser execution MIME for archive content.
- POST /api/runs/{run_key}/validate: no request body; IntegrityReport, read-only.
- GET /api/events: text/event-stream, session required, notice IDs/cursors.
- GET / and finite /assets/*: packaged frontend only.

HTTP 400 invalid options/request, 403 invalid session/host/origin/path policy, 404 unknown opaque ID, 409 updating snapshot, 413 oversized metadata, 422 parse/unsupported strict validation, 500 unexpected internal failure with no private traceback. Browser shows recoverable errors and other runs remain navigable. Content-level diagnostics can return 200 with limited data; do not confuse those with transport/session errors.

## 13. Acceptance and release gates

- Installed wheel works outside a checkout/skill installation and serves packaged assets offline.
- The selected/default root is respected; invalid roots create no files and do not fall back.
- Final, historical, open, malformed, schema-less and unknown-version runs coexist, including schema 5 processing and version-specific rejection of processing in schema 4.
- Source IDs, authors/responsible, verdicts, check revisions and lineage survive presentation.
- Raw archive bytes, file list and mtimes remain unchanged before/after browse/follow/validate tests.
- Coherent live changes appear within 4 seconds in a deterministic test, without archive corruption warnings during valid producer transitions.
- Occurrence-time preference, provenance labels and visible recording/sequence fallback work; sequence/hash IDs remain stable. Historical timestamps/relations are not retroactively subjected to new emission rules.
- Step controls, autoplay, paused incoming events, reduced motion and keyboard actions pass browser tests.
- Dangling relations, clock inconsistencies, missing trace/evidence and hash mismatches are explicit.
- Outside-root paths, reparse points, malicious Markdown and hostile Host/Origin/session requests are blocked.
- Synthetic 1000-run library uses cached unchanged metadata; no eager evidence hashing; bounded queues/scans.
- User reviews the PR before merge/release. No release is promised by these documents.

## 14. Requirements-to-plan mapping

| Requirements | Owner task |
|---|---|
| Packaging/independent CLI/root safety | Task 1 |
| Discovery/stable reads/adapters/schema preservation | Task 2 |
| References/lineage/closure integrity | Task 3 |
| Trace chain/timing/relations | Task 4 |
| Local API/session/packaged serving | Task 5 |
| Shared live collector/SSE consistency | Task 6 |
| Library/profile/findings/checks/history | Task 7 |
| Markdown/documents | Task 8 |
| Trace animation/live controls | Task 9 |
| Browser acceptance/package/offline/read-only regression | Task 10 |

## 15. Primary technical references

These sources informed the architecture; downloading dependencies is an implementation task.

- [SSE and reconnection](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).
- [Monotonic durations](https://docs.python.org/3/library/time.html#time.monotonic).
- [Marked sanitation requirement](https://marked.js.org/).
- [Marked 18.1.0](https://github.com/markedjs/marked/releases/tag/v18.1.0).
- [DOMPurify 3.4.16](https://github.com/cure53/DOMPurify/releases/tag/3.4.16).
- [Playwright 1.64.0](https://github.com/microsoft/playwright/releases/tag/v1.64.0).
