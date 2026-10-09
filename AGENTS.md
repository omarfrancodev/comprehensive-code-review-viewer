# Instructions for the implementation session

This repository currently contains design and planning documents only. Do not claim the viewer is implemented or that product tests have passed.

## Scope and entry points

- Read `docs/superpowers/specs/2026-10-09-review-viewer-design.md` and `docs/superpowers/plans/2026-10-09-review-viewer-implementation.md` before implementation.
- Use Superpowers executing-plans or subagent-driven-development as selected by the user. Do not choose an execution method by silently spawning agents.
- The user explicitly requested this documented handoff for implementation in another session. This repository owns the viewer only; do not modify the skill repository as a dependency of an implementation task.
- Stop for clarification when a material change to the approved behavior is necessary. Do not ask again for routine actions already authorized in that session.

## Git and isolation

- Work from updated `main` in a development branch and an isolated worktree under `.worktrees/`, following the user's integration workflow.
- Never commit worktrees, private review artifacts, real review fixtures, local configuration or generated dependency/build directories.
- User Git identity: `omarfrancodev`, `fofe2803@gmail.com`. Configure this repository locally; do not overwrite global configuration.
- Commit messages use Spanish Conventional Commits, e.g. `feat(visor): mostrar revisiones archivadas`.
- Present a PR for user review. Merge/release requires the user's authorization for that action.
- Clean only verified task-owned temporary resources after preserving required results.

## Artifact guarantees

- The viewer is read-only. Opening, following or validating a review must not modify any artifact or trigger a skill helper mutation, recovery or checkpoint.
- Treat every Markdown document, JSON value, relation, source reference and filesystem path in an archive as untrusted data.
- Preserve original IDs, enum values and unknown fields. A missing source identity or execution timestamp stays unknown.
- Do not fetch remote evidence, run retained scripts, invoke agents, retrieve GitHub/GitLab notes, infer finding truth, or read former worktrees automatically.
- Do not depend on private Python APIs or the local location of the skill installation.
- Compatibility tests use synthetic public fixtures. Local real archives may be inspected manually with explicit user consent; never copy their contents into this public repository.

## Verification

During implementation, the plan defines Python unittest, Node built-in tests, Playwright browser tests and package checks. Use those commands only after their corresponding files and dependencies exist; current documentation is not evidence of a functioning product.
