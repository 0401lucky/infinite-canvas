# Service Quality

## Review Checklist

- Application business/media routes require sessions and exact write-origin checks, with no private static directory exposure; local Agent/proxy retain their independent local-only boundaries.
- Application uploads and JSON writes revalidate sessions before committing; conflicts and partial image cleanup are visible, not silent overwrite or success.
- SQLite and all media/temporary files use the mounted data directory; no browser migration/fallback or unapproved request limits/login throttling.
- SSE routing preserves thread/turn/client ownership and does not broadcast private conversation events to the wrong tab.
- Materialized history remains authoritative; live events only fill unmaterialized turns.
- Agent protocol and metadata storage versions remain separate; no silent history loss or unsafe overwrite.
- CLI/HTTP diagnostics redact secrets before logging or broadcasting.
- New changes use the current adapters, schemas, storage owners, and existing test style instead of broad refactors.

Source references: `canvas-agent/src/canvas/session.test.ts`, `canvas-agent/src/agent/codex-history.test.ts`, `canvas-agent/src/agent/message-metadata.test.ts`, `canvas-agent/src/utils/agent-runtime.test.ts`.

## Validation Policy

Do not automatically run syntax checks, lint, type-check, tests, or builds. Inspect the diff and document pending manual verification; never claim these commands passed without running them.

When explicitly requested, `canvas-agent/package.json` provides `npm test` and `npm run build`, run from `canvas-agent/`. Proxy forwarding changes need manual upstream-status, CORS, and SSE acceptance, not an invented backend test suite.

For the application server, use the assertion checklist in [application server](application-server.md) and bilingual pending-test docs. Native dependency installation, Docker permissions/volume persistence, auth, media Range, cleanup, and browser workflows are unverified until explicitly exercised. Do not describe source inspection as successful runtime tests.

No automatic staging, commits, amendments, tags, merges, or pushes. Follow the explicit release/PR consent rules in `AGENTS.md` when those operations are requested.
