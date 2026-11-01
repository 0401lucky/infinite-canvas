# Trellis Setup

Initialized with the official `@mindfoldhq/trellis` CLI, stable version `0.6.17`, for Codex. Developer identity: `0401lucky` (stored locally in `.developer`).

- Source: https://github.com/mindfold-ai/Trellis/tree/v0.6.17
- Upstream tooling license: AGPL-3.0-only; see [LICENSE](LICENSE). The application's root `LICENSE` was not changed. Preserve upstream notices when distributing the generated tooling.
- Start a session with the `trellis-start` skill; use `trellis-spec-bootstrap` to refresh source-backed guidelines.
- Workflow: [workflow.md](workflow.md). Project conventions: [spec/index.md](spec/index.md). `AGENTS.md` remains authoritative.
- Default execution is inline, with no automatic checks or Git commits. No global Codex hook settings or trust decisions were changed.
- Native hooks need host-side enablement/approval; manual `trellis-start` remains the fallback.

Trellis is development tooling, not an application dependency or a new backend. Future CLI updates should review local workflow/spec differences rather than use forced re-initialization.
