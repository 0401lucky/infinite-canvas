# Frontend Quality

Follow `AGENTS.md`: read the current implementation, change only the required files, preserve user edits, and favor short direct code over new abstraction layers.

## Review Checklist

- State, requests, and canvas logic remain with their existing owners.
- Application records/media use authenticated same-origin APIs; no browser business fallback, assumed hosted cloud service, or unnecessary compatibility code.
- Hydration failure is not editable empty data; old-session continuations cannot write, poll, load plugins, or notify successful persistence after logout.
- Revision conflicts preserve server data; image cleanup tombstones block stale URL/key revival, while explicit ZIP imports remap to new media.
- Chinese copy, localization, Ant Design token ownership, and both canvas themes remain consistent.
- Existing image proportions, generation cancellation, references, and media ownership are preserved.
- Changed behavior is documented in pending-test; substantial changes also receive one version-level Unreleased entry.

## Validation Policy

Do not automatically run syntax checks, lint, type-check, tests, formatting, or builds. The user performs validation unless explicitly requested. Do not describe unexecuted checks as passed.

If the user requests validation, `web/package.json` provides `bun run typecheck`, `bun run test`, and `bun run build`, executed from `web/`. These are reference commands, not required automatic workflow steps.

When browser verification is requested, use an independent test page and leave the user's existing windows, tabs, and conversations intact.
