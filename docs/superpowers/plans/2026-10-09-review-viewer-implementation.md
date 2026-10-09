# Comprehensive Code Review Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independently installable, read-only local web viewer for archived reviews, their profiles/documents, live persisted milestones and animated trace playback.

**Architecture:** A Python standard-library backend reads versioned artifacts into a conservative normalized API, validates selected archive facts and publishes change notices through one shared SSE collector. Native browser modules render structured review views and sanitized Markdown, preserving source identities and separate recorded/occurred timing. No agent, installed skill, database or remote service is required.

**Tech Stack:** Python >=3.10, setuptools packaging, HTML/CSS/native JavaScript modules, marked 18.1.0, DOMPurify 3.4.16, unittest, Node >=22 built-in tests and Playwright 1.64.0 (development only).

**Spec:** [docs/superpowers/specs/2026-10-09-review-viewer-design.md](../specs/2026-10-09-review-viewer-design.md). Read both documents before implementation.

## Global Constraints

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

## Review Focus

Each line is owned by the tests explicitly listed in its task:

1. Windows junction/symlink replacement during access must never read a file outside the selected root (Tasks 1 and 5).
2. A producer transition across closure/marker/trace/report must not be mistaken for permanent corruption or expose a contradictory live snapshot (Tasks 2 and 6).
3. Similar repository names and ambiguous basenames must not merge unrelated runs or choose the wrong evidence/prior review (Tasks 2 and 3).
4. Mixed timing sources and late incoming events must preserve source IDs, canonical sequence and a paused playback cursor (Tasks 4 and 9).
5. Malicious Markdown, encoded URL schemes, BOM/Unicode and headings must remain inert while retaining readable report structure (Task 8).

## Handoff, execution boundaries and file map

The repository initially contains only README, AGENTS, .gitignore, this plan and the spec. Product files listed below do not exist yet. User requested implementation in another session. Choose its execution method there; do not infer authorization to spawn agents from the plan header alone.

Use a branch/worktree from updated main, under ignored .worktrees/. Do not modify the producer repository. The planned `processing` producer state is not published in v2.8.0; unknown/future schemas must remain limited until their actual contract is pinned.

Complete Tasks 1–6 in order. Tasks 7–9 share frontend state and API interfaces and are best executed sequentially to avoid contract drift. Task 10 proves the integrated deliverable and produces a PR; merge and release are user gates. Every task has its own focused verification/commit.

### Planned paths and responsibility

| Paths | Responsibility |
|---|---|
| pyproject.toml, src/ccr_viewer/__init__.py, __main__.py, cli.py | Packaging, version and console/module entrypoints |
| paths.py, discovery.py, snapshots.py, adapters.py | Safe roots/catalog, coherent reads, presentation adapters |
| references.py, integrity.py, trace.py | Read-only linkage, byte integrity, trace interpretation |
| live.py, server.py | Shared watching/SSE and local HTTP/session routing |
| web/index.html, styles.css, app.js, api.js, store.js | Shell, layout, transport and transient state |
| web/library.js, profile.js, findings.js, validation.js | Structured review screens |
| web/documents.js, markdown.js | Safe file previews and Markdown |
| web/lifecycle.js, playback.js | Timeline/relations/participants and playback controls |
| src/ccr_viewer/contracts/compatibility.json, contracts/sources.md | Pinned producer contract provenance/capabilities |
| tests/fixtures.py, fixtures/, test_*.py | Synthetic source variants and backend conformance |
| tests/js/*.test.mjs, tests/browser/*.spec.mjs | Pure frontend models and browser behavior |
| tools/vendor.mjs, package*.json, playwright.config.mjs | Reproducible local assets and development tests |

All Python dict envelopes follow spec sections 6/12; type aliases may use TypedDict. Do not add optional API fields casually. Public methods named below are the handoff interfaces; internal helpers may be chosen by the implementer.

### Verification commands

After Task 1, use `python -m pip install -e .` so src imports resolve. After Task 7 dependencies exist, `npm ci` restores the exact lockfile. Scripts:

- `python -m unittest discover -s tests -p "test_*.py" -v`.
- `node --test` (only tests/js files use .test.mjs).
- `npm run test:browser -- --project=chromium`.
- `npm run test:browser -- --project=firefox`.
- `python -m pip wheel . --no-deps --wheel-dir dist`.

Commands here are planned validation, not tests already run.

---

### Task 1: Installable package and safe root selection

**Files:**
- Create: pyproject.toml, src/ccr_viewer/__init__.py, __main__.py, cli.py, paths.py.
- Test: tests/test_paths.py, tests/test_cli.py.

**Interfaces:**
- Produces: `RootConfig` dataclass {root: Path, selected_by: str, port: int, open_browser: bool}.
- Produces: `resolve_root(explicit: str|None, env: Mapping[str,str], home: Path) -> Path`.
- Produces: `safe_regular_file(root: Path, relative: str) -> Path`; reject policy violations before opening and recheck on read.
- Produces: `open_archive_file(root: Path, relative: str) -> ContextManager[BinaryIO]`; verified descriptor before any content read; all later readers/hashers use it.
- Produces: `parse_args(argv: Sequence[str]) -> argparse.Namespace`, `build_config(args: Namespace, env: Mapping[str,str], home: Path) -> RootConfig`.
- Produces: `main(argv: Sequence[str]|None = None) -> int`, package `__version__ = "0.1.0"`. Task 5 completes its server delegation; Task 1 proves --version/root policy without advertising a working server.

- [ ] **Step 1: Write failing root/CLI tests.**
  Use TemporaryDirectory and mocked home/env. Include these exact behavior assertions:
  ```python
  self.assertEqual(resolve_root(str(explicit), {"CCR_ARTIFACTS_DIR": str(other)}, home), explicit)
  self.assertEqual(resolve_root(None, {"CCR_ARTIFACTS_DIR": str(other)}, home), other)
  self.assertEqual(resolve_root(None, {}, home), home / ".comprehensive-code-review" / "reviews")
  self.assertEqual(parse_args([]).port, 0)
  self.assertEqual(main(["--version"]), 0)
  ```
  Create directories first; assert selected parent containing reviews resolves that child, while a direct-run sentinel keeps that directory. Missing explicit/default roots raise a clear error and do not change before/after filesystem inventory. Reject --host, negative/65536 ports, root files and '..' escape. Add `test_reparse_point_escape` with a junction/symlink fixture where platform privileges allow it; report an explicit skip when unavailable and retain a deterministic mocked-reparse test.

- [ ] **Step 2: Verify RED.**
  Run `python -m unittest discover -s tests -p "test_paths.py" -v`.
  Expected: import/function-not-defined errors. Record the actual result; do not treat an unrelated environment error as RED.

- [ ] **Step 3: Implement packaging and exact root policy.**
  setuptools src layout; requires-python >=3.10; no Python runtime dependencies; console entrypoint/module invoke the same main. Root discovery performs no mkdir. Path checks include Windows reparse attributes and resolved ancestry. Protected opening uses a root-anchored no-follow component walk on POSIX and ctypes GetFinalPathNameByHandleW verification on Windows; validate descriptor/root identity before reading, and fail closed when unavailable. --version exits before importing the later server module. Version is the planned package version, not a release claim.

- [ ] **Step 4: Verify GREEN and package entrypoint.**
  Run `python -m pip install -e .`, then `python -m unittest discover -s tests -p "test_paths.py" -v` and `python -m unittest discover -s tests -p "test_cli.py" -v`.
  Run `ccr-viewer --version`; expected 0.1.0 with exit 0. Full launch acceptance belongs to Task 5.

- [ ] **Step 5: Commit.**
  `git add pyproject.toml src/ccr_viewer tests/test_paths.py tests/test_cli.py`.
  `git commit -m "feat(archivo): definir instalación y selección segura de raíz"`.

### Task 2: Synthetic contracts, catalog, stable reads and adapters

**Files:**
- Create: src/ccr_viewer/contracts/compatibility.json, contracts/sources.md, src/ccr_viewer/discovery.py, snapshots.py, adapters.py.
- Test: tests/fixtures.py, tests/fixtures/, tests/test_discovery.py, test_snapshots.py, test_adapters.py.

**Interfaces:**
- Consumes: RootConfig, safe_regular_file and open_archive_file.
- Produces: `RunLocation` dataclass {key: str, path: Path, relative_path: str}.
- Produces: `discover_runs(root: Path, *, max_runs: int = 5000, max_depth: int = 6) -> tuple[list[RunLocation], list[dict]]`.
- Produces: `read_snapshot(location: RunLocation, *, previous: dict|None = None) -> dict`; {files: dict, fingerprint: str, updating: bool, diagnostics: list[dict]}.
- Produces: `adapt_run(location: RunLocation, snapshot: dict) -> dict` (ReviewView).
- Produces: `Catalog(root: Path)` with `refresh() -> None`, `list_runs(filters: Mapping[str,str], offset: int = 0, limit: int = 50) -> dict`, `get_run(key: str) -> dict`, `locations() -> list[RunLocation]`.
- Test utility: `build_archive(root: Path, variant: str) -> Path`; variants final_v7, legacy_v3, legacy_v5, schema_less, prepared, unknown_v99, corrupt_json, rereview_v7. `archive_inventory(root: Path) -> dict` includes relative files, bytes SHA-256 and mtime_ns.

- [ ] **Step 1: Write failing discovery/snapshot/adapter tests.**
  Synthetic generator builds source-valid fields from the pinned v2.8.0 documents, never imports the installed skill. Unknown variants are visibly synthetic. Assert:
  ```python
  view = adapt_run(location, read_snapshot(location))
  self.assertEqual(view["review"]["profile"], "economy")
  self.assertIsNone(view["summary"]["source_review_id"])
  self.assertEqual(view["compatibility"], "historical")
  ```
  Add discovery of prepared closure/trace without final record; malformed JSON alongside a readable run; evidence nested sentinel excluded; different hosts/namespaces with same basename not merged. Unknown_v99 preserves unknown fields/enums and says limited. Test BOM, NaN/Infinity, duplicate JSON keys, oversized metadata, 5000/depth bounds and stable keys. Add transition tests in which closure changes during reading or pending_trace exists: retain previous coherent snapshot, updating=true, exactly bounded retries and no recovery calls.

- [ ] **Step 2: Verify RED.**
  Run each of `python -m unittest discover -s tests -p "test_discovery.py" -v`, `test_snapshots.py`, `test_adapters.py` using the same command form.
  Expected: missing implementation errors or failed exact assertions.

- [ ] **Step 3: Implement catalog/cache/adapters.**
  Declare API TypedDict aliases from spec section 6. Read bounded bytes through open_archive_file, parse conservatively and preserve source objects. Stat-cached catalog reads changed metadata only. Do not require naming/ownership to discover. Normalize comparable repository identity only; preserve null dates/IDs and version-dependent omissions. Current closure support is 1–4 plus schema-less limited; processing under an unsupported version renders limited. Add no unconditional directory walk of evidence and no production/private fixtures.

- [ ] **Step 4: Verify GREEN and read-only behavior.**
  Run the three focused modules. Compare archive_inventory before/after discovery, snapshots and adapters byte-for-byte and mtime-for-mtime; assert no new files. Catalog ordering/page count is exact. A synthetic 1000-run unchanged refresh performs no fresh report/evidence reads using an instrumented reader counter.

- [ ] **Step 5: Commit.**
  `git add contracts src/ccr_viewer/contracts src/ccr_viewer/discovery.py src/ccr_viewer/snapshots.py src/ccr_viewer/adapters.py tests`.
  `git commit -m "feat(biblioteca): leer revisiones actuales e históricas"`.

### Task 3: References, lineage and read-only archive integrity

**Files:**
- Create: src/ccr_viewer/references.py, integrity.py.
- Modify: src/ccr_viewer/adapters.py (lineage/file inventory only).
- Test: tests/test_references.py, tests/test_integrity.py.

**Interfaces:**
- Consumes: Catalog, RunLocation, snapshot and FileEntry.
- Produces: `resolve_reference(raw: str, current: RunLocation, catalog: Catalog) -> dict` (ResolvedReference).
- Produces: `list_files(location: RunLocation) -> list[dict]` (FileEntry), and `read_preview(location: RunLocation, file_key: str) -> dict`.
- Produces: `validate_archive(location: RunLocation, snapshot: dict) -> dict` (IntegrityReport).
- Produces: `hash_regular_file(root: Path, relative: str) -> str`; streams at 1 MiB through open_archive_file, rechecks containment/identity.

- [ ] **Step 1: Write failing reference/integrity tests.**
  Resolve root file first, then a unique evidence basename; two evidence matches return ambiguous with no file_key. Paths outside root and former worktree paths return outside_root; HTTP links return external without fetching. Preserve fragments and legacy null IDs; a prior-source matching only a basename never becomes a lineage claim. Assert:
  ```python
  result = validate_archive(location, snapshot)
  self.assertEqual(result["status"], "failed")
  self.assertTrue(any(item["name"] == "evidence/notes.json" and item["status"] == "failed"
                      for item in result["checks"]))
  self.assertEqual(snapshot["files"]["review.json"]["verdict"], original_verdict)
  ```
  Include missing hashed evidence, unsupported ownership/layout, schema-less individual valid hashes with overall limited, closure/review identity disagreement and a supported canonical valid archive. File previews truncate at 2 MiB; code is returned as text, never executable content.

- [ ] **Step 2: Verify RED.**
  Run `python -m unittest discover -s tests -p "test_references.py" -v` and the same form for test_integrity.py.

- [ ] **Step 3: Implement exact resolver and integrity levels.**
  Pin supported marker/layout rules from source; do not call private producer helper methods. Paths are constrained to root and IDs map only to catalogued regular files. Preserve unknown relation/reference targets. Validate supported byte guarantees without declaring semantic defect truth. No auto repair and no replacement hashes. Integrate resolved lineage/files into adapt_run without copying evidence content into the model.

- [ ] **Step 4: Verify GREEN and archive immutability.**
  Focused tests pass; inventory unchanged after preview, resolve and validation. Test large evidence hashing uses bounded chunks and no catalog startup hashing. Unsupported canonical producer changes remain limited even if selected file hashes match.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/references.py src/ccr_viewer/integrity.py src/ccr_viewer/adapters.py tests/test_references.py tests/test_integrity.py`.
  `git commit -m "feat(integridad): resolver fuentes y verificar archivos sin modificarlos"`.

### Task 4: Trace interpretation, canonical integrity and temporal views

**Files:**
- Create: src/ccr_viewer/trace.py.
- Test: tests/test_trace.py.

**Interfaces:**
- Consumes: snapshot/location and resolve_reference.
- Produces: `parse_trace(data: bytes, descriptor: dict|None, run_id: str|None, *, open_run: bool = False) -> dict` (TraceView).
- Produces: `temporal_order(events: Sequence[dict]) -> list[str]`.
- Produces: `resolve_relations(events: Sequence[dict], review: dict|None, current: RunLocation, catalog: Catalog) -> tuple[list[dict], list[dict]]`.

- [ ] **Step 1: Write failing trace tests.**
  Generate schema1 events with canonical SHA-256, preserving UTF-8 accents and sorted serialization. Verify IDs/chain/count/tip and source identity; detect changed summary, missing newline, invalid middle line, oversize and 10000 limit. Assert:
  ```python
  self.assertEqual(temporal_order(events), ["E000002", "E000001"])
  self.assertEqual(events[0]["sequence"], 1)
  self.assertEqual(events[0]["event_id"], "E000001")
  ```
  Fixture E000002 has earlier known occurred_at; E000001 uses later recorded_at fallback. Assert basis labels, canonical original list intact, unknown occurrence not synthesized, wrong offsets diagnosed, impossible end-before-start warning. Explicit relations resolve to known targets; dangling/ambiguous/cyclic targets get diagnostics; no relations means no fabricated causal edges. Truncated input yields valid_prefix_length and never fully verified.

- [ ] **Step 2: Verify RED.**
  Run `python -m unittest discover -s tests -p "test_trace.py" -v`.

- [ ] **Step 3: Implement schema1 chain and independent presentation order.**
  Use the exact digest algorithm from spec section 8. Strict verification and limited display are separate. Do not mutate supplied event dicts while extracting sha256. Timelines never claim globally comparable clocks. Return raw events for original provenance and normalized relation diagnostics without guessing actor names from summaries.

- [ ] **Step 4: Verify GREEN and integrate integrity trace check.**
  Run focused trace and integrity tests. Update validate_archive to consume parse_trace for supported schemas without an import cycle (trace consumes references; integrity consumes trace; adapters do not consume integrity). Ensure open pending transitions are updating, not a verified final archive.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/trace.py src/ccr_viewer/integrity.py tests/test_trace.py tests/test_integrity.py`.
  `git commit -m "feat(trazabilidad): interpretar eventos tiempos y relaciones"`.

### Task 5: Loopback API, capability session and packaged serving

**Files:**
- Create: src/ccr_viewer/server.py, web/index.html, web/styles.css, web/app.js, web/api.js.
- Modify: pyproject.toml (package data), cli.py and __main__.py (launch delegation).
- Test: tests/test_server.py, tests/test_cli.py.

**Interfaces:**
- Consumes: RootConfig, Catalog, read_preview, validate_archive and parse_trace.
- Produces: `ViewerServer(config: RootConfig, catalog: Catalog)` with `start() -> str` (launch URL), `stop() -> None`.
- Produces: `serve(config: RootConfig) -> int`; main delegates after config validation.
- Produces: frontend `bootstrapSession(fragment: string): Promise<void>`, `request(path: string, options?: object): Promise<object>` and `getConfig(): Promise<object>`.
- SSE route connection is completed in Task 6; it must not leak unauthenticated data meanwhile.

- [ ] **Step 1: Write failing HTTP/session tests.**
  Start on port0, capture actual authority/token. Assert all spec routes/error envelopes; private endpoints require session; bootstrap rejects wrong token/origin/host, sets HttpOnly SameSite=Strict and does not log token. External hostile Host, null/foreign Origin, cross-site Fetch Metadata, unsupported methods, traversal and unknown file IDs are denied. Root cannot change through API. File script content stays a text envelope. Inject a mocked concurrent file replacement outside root and assert no secret bytes returned. Validate route is POST but archive inventory is unchanged.

- [ ] **Step 2: Verify RED.**
  Run `python -m unittest discover -s tests -p "test_server.py" -v`.

- [ ] **Step 3: Implement dedicated server/session/CLI.**
  ThreadingHTTPServer; finite resource allowlist; bounded request bodies; standard-library secrets/hash checks. Token fragment is exchanged before app API calls and cleared from history. Session cookie permits EventSource in Task6; no client token stored in localStorage. Implement spec sections 11/12, including CSP/nosniff/no-store. Print actual launch URL; call webbrowser only unless --no-browser; graceful Ctrl+C stops server.
  Initial app shell may show the configured root and pending views; do not serve arbitrary archive directory listings.

- [ ] **Step 4: Verify GREEN and package resource access.**
  Run test_server.py and test_cli.py. `python -m pip wheel . --no-deps --wheel-dir dist`; inspect wheel contains web/index.html and modules. Launch installed package in an unrelated temp cwd with --no-browser and a synthetic root; session exchange and /api/config succeed without importing the skill. Assert terminal/session logs contain neither request-body tokens nor artifact contents.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/server.py src/ccr_viewer/web src/ccr_viewer/cli.py src/ccr_viewer/__main__.py pyproject.toml tests/test_server.py tests/test_cli.py`.
  `git commit -m "feat(servidor): publicar API local con acceso de solo lectura"`.

### Task 6: Shared live collector and bounded SSE

**Files:**
- Create: src/ccr_viewer/live.py.
- Modify: server.py (events route), api.js (subscribe function).
- Test: tests/test_live.py, tests/test_server.py.

**Interfaces:**
- Consumes: Catalog and coherent snapshots.
- Produces: `LiveCollector(catalog: Catalog, *, clock: Callable[[],float] = time.monotonic)`.
- Produces methods: `subscribe(last_cursor: int|None = None) -> queue.Queue`, `unsubscribe(client: queue.Queue) -> None`, `poll_once() -> list[dict]`, `stop() -> None`.
- Produces: `derive_display_state(view: dict, recently_observed_change: bool) -> tuple[str,str|None]`.
- Frontend: `subscribeNotices(onNotice: (notice: object) => void, onState: (state: string) => void): () => void` (unsubscribe).

- [ ] **Step 1: Write failing deterministic live tests.**
  Use fake clock, atomic synthetic writer and two subscribers. Assert one collector per root/process, 2-second poll, 10-second rescan, 120-second activity threshold, 256 replay and 128 queue bounds. Oversubscribed/expired cursors emit resync; heartbeat doesn't mark a run active; unsubscribing the last client stops polling. Updating marker/trace between reads does not publish a contradictory snapshot. Initial updated_at alone yields open_activity_unknown. Complete, interrupted/resumed, final-with-pending-closure and blocked-check cases retain distinct meanings. No percentage field is returned.

- [ ] **Step 2: Verify RED.**
  Run `python -m unittest discover -s tests -p "test_live.py" -v`.

- [ ] **Step 3: Implement collector/route.**
  Thread-safe catalog/snapshot cache; one shared poller starts with first subscriber. Last-Event-ID is an in-memory notice cursor, not a producer event ID. On reconnect with lost buffer, publish resync then coherent reload; no loss of final availability. Bound SSE writes/clients; disconnect removes subscriptions. A full queue is cleared and receives a resync notice, never blocks producer/file reading. Stop joins owned thread and closes clients.

- [ ] **Step 4: Verify GREEN, reconnection and read-only following.**
  Run focused live/server tests. Real local integration mutates only the synthetic producer fixture; viewer observes coherent change within 4 seconds. Hash/inventory test distinguishes intentional fixture producer changes from any viewer writes. No eager evidence reads/hashes on each tick. Sessionless events route returns403. Two browsers use one collector and one EventSource each.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/live.py src/ccr_viewer/server.py src/ccr_viewer/web/api.js tests/test_live.py tests/test_server.py`.
  `git commit -m "feat(vivo): seguir hitos persistidos con actualizaciones acotadas"`.

### Task 7: Structured library, review profile, findings and validation

**Files:**
- Create: web/store.js, library.js, profile.js, findings.js, validation.js.
- Modify: index.html, styles.css, app.js, api.js (typed convenience functions).
- Create: package.json, package-lock.json, playwright.config.mjs.
- Test: tests/js/store.test.mjs, views.test.mjs; tests/browser/profile.spec.mjs, support.mjs.

**Interfaces:**
- Frontend produces: `createStore(initial?: object)` with `getState(), dispatch(action), subscribe(listener)`.
- Transport produces: `getRuns(filters: object, offset?: number): Promise<object>`, `getRun(key: string): Promise<object>`, `getTrace(key: string): Promise<object>`, `getFiles(key: string): Promise<object>`, `getPreview(runKey: string, fileKey: string): Promise<object>`, `validateRun(key: string): Promise<object>`.
- View exports: `renderLibrary(container: Element, state: object, dispatch: Function): void`, `renderProfile(container: Element, view: object): void`, `renderFindings(container: Element, view: object): void`, `renderValidation(container: Element, view: object): void`.
- Pure selector: `selectFindingCounts(review: object|null): object`; confirmed counts P0–P3 and unknown; unresolved/rejected separate.
- Browser test support: `openFixture(page, variant: string): Promise<void>` intercepts the normalized API with public synthetic responses; real-server support is Task10.

- [ ] **Step 1: Write failing store/view tests.**
  Preserve selected run/scroll when a notice triggers reload; unknown/zero counts distinct from confirmed. Old profile strings and missing ID remain original with no fake source ID. Assert responsible and change_authors appear separately, original verdict unchanged on integrity failure, no checks recorded is not success, stale/limited flags visible. Historic/re-review aliases and resolved entries not in current findings remain browsable; unrelated same-basename projects stay separate.

- [ ] **Step 2: Verify RED with locked development tests.**
  Add package.json type=module, scripts test:js=`node --test`, test:browser=`playwright test`.
  Install exact dev dependency `npm install --save-dev --save-exact @playwright/test@1.64.0`.
  Run `node --test`; expected missing modules/failed assertions. Browser install/config uses Chromium and Firefox projects, no runtime Node requirement.
  This setup belongs to the screen deliverable; do not create a separate tooling-only task.

- [ ] **Step 3: Implement structured screens and state transitions.**
  Responsive sidebar at >=900px, collapsible drawer below; tabs work at 375px. Light/dark uses system preference with explicit transient user toggle. Semantic headings and plain textContent render untrusted fields. Finding cards separate H3 priority/ID from H4 title; original source Markdown is handled later. Only confirmed counts contribute to priority summary. History navigation uses resolved actual source links; ambiguous/missing sources are labeled. User-controlled filters/reset and empty/error states survive a changing library.

- [ ] **Step 4: Verify GREEN in unit/browser tests.**
  Run `node --test`.
  Run `npx playwright install chromium firefox`, then `npm run test:browser -- --project=chromium tests/browser/profile.spec.mjs`.
  Check keyboard tab selection, 375/900px layout, scroll preservation and all spec section7 fields on synthetic fixtures. Inspect rendered screenshots manually; screenshots are UI verification artifacts, not committed private reviews.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/web package.json package-lock.json playwright.config.mjs tests/js tests/browser`.
  `git commit -m "feat(visor): presentar biblioteca perfil hallazgos y validación"`.

### Task 8: Offline Markdown, bounded previews and local references

**Files:**
- Create: web/documents.js, markdown.js, vendor/marked.esm.js, vendor/purify.es.mjs, vendor/manifest.json, vendor/LICENSE.*.
- Create: tools/vendor.mjs.
- Modify: package.json/lock, app.js/styles.css (document view).
- Test: tests/js/links.test.mjs, tests/browser/markdown.spec.mjs.

**Interfaces:**
- Consumes: getFiles/getPreview and resolved FileEntry/ResolvedReference.
- Produces: `renderMarkdown(text: string, container: Element, resolveLink: Function): void`, `classifyLink(raw: string): string`.
- Produces: `renderDocuments(container: Element, view: object, api: object): Promise<void>`.
- Vendor script: `node tools/vendor.mjs`; copies only exact pinned browser files/licenses from installed npm dependencies and records SHA-256/source/version in manifest.

- [ ] **Step 1: Write failing Markdown/reference tests.**
  Fixture contains GFM table, fenced code, H2/H3/H4, BOM, accented IDs and plain line breaks. Add raw HTML, event handlers, iframe, SVG/MathML, escaped/encoded javascript/data/file schemes and external image. Assert no script executes, no automatic external requests, report headings/tables remain readable, code literal stays text, raw HTML becomes inert escaped text. Local evidence links resolve only via opaque API IDs; ambiguous links never select a target.

- [ ] **Step 2: Verify RED with locked/vendor dependencies.**
  `npm install --save-dev --save-exact marked@18.1.0 dompurify@3.4.16`.
  Implement deterministic copy/license/hash tool only; `node tools/vendor.mjs` is explicit maintainer/development action, not app startup.
  Run `node --test` and `npm run test:browser -- --project=chromium tests/browser/markdown.spec.mjs`; expected missing renderer/unsafe behavior assertions fail.
  Versions are verified at handoff date; if a subsequent security advisory requires a different pin, document and review that dependency change instead of silently changing this design.

- [ ] **Step 3: Implement safe Markdown/document pipeline.**
  Escape source raw HTML tokens before marked rendering, sanitize generated HTML with DOMPurify strict allowed Markdown tags/attrs, then process links through classifier/resolver. Block all automatic images/media, render alt text. Do not modify original Markdown. Preview shows truncation/byte count and does not offer script execution. Unknown file types are bounded inert text or unavailable with a reason.

- [ ] **Step 4: Verify GREEN and offline/vendor provenance.**
  Unit/browser tests pass. Re-running vendor script produces identical bytes/hash inventory from locked packages. Browser network interception permits loopback only; Markdown view with remote references makes zero automatic remote requests. Server serves vendor modules/licenses from wheel, not node_modules. Native CSP remains enforced without unsafe-inline/eval exemptions.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/web tools/vendor.mjs package.json package-lock.json tests/js/links.test.mjs tests/browser/markdown.spec.mjs`.
  `git commit -m "feat(documentos): visualizar Markdown seguro con recursos locales"`.

### Task 9: Lifecycle visualization, temporal fallback and playback

**Files:**
- Create: web/lifecycle.js, playback.js.
- Modify: app.js, styles.css, store.js (trace selections/live buffer).
- Test: tests/js/playback.test.mjs, tests/browser/lifecycle.spec.mjs.

**Interfaces:**
- Consumes: TraceView events/temporal_order/relations; getTrace; subscribeNotices.
- Produces: `createPlayback(events: object[], options?: {intervalMs:number, speed:number})` with `state(), step(delta:number), seek(eventId:string), play(), pause(), setSpeed(speed:number), ingest(trace:object), resumeLive(), destroy()`.
- State: {mode: live|paused|playing, selectedEventId: string|null, speed: number, newEvents: number}.
- Produces: `renderLifecycle(container: Element, trace: object, playback: object): void`.

- [ ] **Step 1: Write failing playback/flow tests.**
  Pure timers are fake/injectable. 800ms at1x and 400ms at2x; allowed speeds exactly0.5/1/2/4. Empty/single trace boundaries safe. Canonical recording-order and temporal view preserve event IDs. Paused event remains selected when a newly arrived event has earlier occurred_at; newEvents increments once per unseen event ID; duplicates after reconnect do not increment. resumeLive selects newest sequence event, not an earlier-occurrence event. Missing trace and invalid prefix never show a complete graph.

- [ ] **Step 2: Verify RED.**
  Run `node --test` and `npm run test:browser -- --project=chromium tests/browser/lifecycle.spec.mjs`; expect missing controls/model or failed cursor/time assertions.

- [ ] **Step 3: Implement milestone sequence and controls.**
  Use SVG/DOM APIs with textContent for labels. Render phase/status, source timestamps/basis, recorder/actor/executor and resolved evidence/relations. Primary sequence works with no relations; participant lanes/causal edges appear only with recorded data. Show dangling/cyclic edges as limitations, not guessed links. Keyboard arrows step, Space toggles only within the playback control region (not text inputs/buttons with their own behavior), Home/End select boundaries. prefers-reduced-motion disables motion/autoplay by default but retains manual steps. Destroy clears timers/subscriptions.

- [ ] **Step 4: Verify GREEN and incoming live data.**
  Unit and browser focused tests pass. Assert no manufactured elapsed time from recorded timestamps, timestamp-source labels remain visible, original chain sequence view available. Live follow/pause/new-events/resume behavior survives network disconnect/resync. New final report enables other tabs without resetting a paused trace cursor.

- [ ] **Step 5: Commit.**
  `git add src/ccr_viewer/web tests/js/playback.test.mjs tests/browser/lifecycle.spec.mjs`.
  `git commit -m "feat(flujo): reproducir trazabilidad y seguir eventos en vivo"`.

### Task 10: Integrated acceptance, packaging and implementation PR

**Files:**
- Create: tests/browser/server.mjs, acceptance.spec.mjs, tests/test_readonly.py, tests/test_packaging.py, .github/workflows/ci.yml.
- Modify: tests/fixtures.py (test producer transitions), README.md, docs/usage.md, docs/compatibility.md.
- Existing tests: all backend/frontend/browser suites.

**Interfaces:**
- Browser test server helper: `startFixtureServer(variant:string): Promise<{url:string,root:string,stop:Function}>`; bootstraps actual cookie via app, never disables security.
- Fixture transition helper: `advance_fixture(run: Path, transition: str) -> None`; transitions prepare_to_discovery, add_check, transient_retention, retained_then_closed. This is explicitly a test producer, not viewer logic.
- CI: Ubuntu and Windows Python3.10/3.12 backend matrix; Node22 JS; Chromium/Firefox browser job on Ubuntu. Synthetic roots only.

- [ ] **Step 1: Write failing integrated acceptance tests.**
  Installed wheel launched outside repository and without skill; default/env/explicit root fixtures; empty prepared run appears; atomic test producer changes are seen <=4 seconds; final report/cierre/trace become available; integrity mismatch stays separate from source verdict. Browser can replay, pause incoming events, use Markdown and navigate historic lineage. Track before/after inventory for browse/validate/follow without producer mutations and assert zero file/hash/mtime changes. In transition test, account only for explicit fixture-writer changes. Add arbitrary-path/Host/session attack, keyboard/reduced motion, 1000-run cache bounds, unknown-schema/raw viewer and orphan relations.

- [ ] **Step 2: Verify RED for integration gaps.**
  Run `python -m unittest discover -s tests -p "test_packaging.py" -v`, test_readonly.py and `npm run test:browser -- --project=chromium tests/browser/acceptance.spec.mjs`.
  Only fix failures that correspond to the spec; do not weaken read-only/security assertions to make testing easy.

- [ ] **Step 3: Complete wiring/package/CI and user documentation.**
  Ensure wheel includes every static/vendor resource and contract capabilities needed offline, excludes tests/private fixtures/node_modules/worktrees. README changes status only after verification, documents installation and console/module commands. docs/compatibility records tested schemas versus limited future processing support; docs/usage explains last activity, partial traces, recorded/occurred distinction and integrity vs verdict. Keep runtime independent; explain exact dependency lock/vendor update procedure and project-license release gate. CI uses locked dev dependencies and no production archive. Real local archive smoke inspection, if desired, needs explicit user's source-access consent and must not copy data into public tests.

- [ ] **Step 4: Verify GREEN with full checks after final changes.**
  `python -m unittest discover -s tests -p "test_*.py" -v`.
  `npm ci`, `node --test`.
  `npm run test:browser -- --project=chromium` and Firefox.
  `python -m pip wheel . --no-deps --wheel-dir dist`; packaging test installs that wheel in a clean temporary environment and launches outside checkout.
  Expected: zero unexpected failures; explicitly report privilege-limited junction/symlink skips and do not claim those scenarios ran. Inspect 375/900/1440px light/dark screenshots with no hidden navigation/text clipping; record meaningful limitations.

- [ ] **Step 5: Commit, push branch and create PR.**
  `git add tests .github README.md docs/usage.md docs/compatibility.md`.
  `git commit -m "test(visor): verificar compatibilidad ejecución local y archivo inmutable"`.
  Review the final diff for private data/vendor licenses and plan/spec conformance. Push the development branch, create a PR with concrete behavior and actual verification results, attach it when the harness offers PR artifact attachment.
  Stop at the user's review gate. Do not merge, tag, publish packages/releases or remove an active worktree without the appropriate user authorization/verified ownership.

## Self-review checklist for the handoff

- [x] Every spec requirement maps to a task in spec section14; no producer implementation is hidden in a viewer task.
- [x] Global constraints exactly match the spec; dependency pins/version floors agree.
- [x] Each task has exact file paths, named interfaces, failing assertions, verification commands and a commit.
- [x] Cross-task signatures/model keys match; stage-dependent CLI completion and browser-test dependencies are explicit.
- [x] All five Review Focus conditions have their named tests.
- [x] Source identities, null timestamps, unknown schemas and original artifact bytes are preserved.
- [x] The plan defines decisions/tests, rather than writing all implementation bodies.
- [x] Release/license/user-review gates remain explicit; no current product/test success is implied.

## Suggested message for the implementation session

Read AGENTS.md, the design spec and this plan in comprehensive-code-review-viewer. Implement only the viewer in a development branch/worktree, using the approved execution method. Respect read-only artifacts and pinned compatibility; the producer's processing/timing changes belong to a different session. Verify each task, create the PR and wait for my review before merge/release. Stop and consult me if implementation requires changing an agreed behavior.
