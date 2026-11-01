# Application and Local Services Guidelines

Scope: `server/`, `canvas-agent/`, and `canvas-proxy/`. `server/` is the required self-hosted application server (Node 24, Express 5, SQLite, private media); Agent/proxy remain optional local tools with independent auth/history contracts. Browser AI requests remain owned by `web/src/services/api/`.

## Pre-Development Checklist

1. Read `AGENTS.md` and [directory structure](directory-structure.md).
2. For application auth, persistence, or deployment, read [application server](application-server.md); for local Agent persistence, read [file storage](file-storage.md).
3. For HTTP/CLI/Agent changes, read [errors](error-handling.md), [logging](logging-guidelines.md), and [cross-layer contracts](../guides/cross-layer-thinking-guide.md).
4. Read [quality](quality-guidelines.md) before finishing.

## Guidelines Index

| Guide | Scope |
| --- | --- |
| [Application server](application-server.md) | Auth, SQL/API/env contracts, media, cleanup, Docker |
| [Directory structure](directory-structure.md) | Agent adapters, HTTP, MCP, proxy |
| [File storage](file-storage.md) | Independent local Agent configuration, metadata, Skills |
| [Errors](error-handling.md) | Validation and surfaced failures |
| [Logging](logging-guidelines.md) | Winston and stream credential redaction |
| [Quality](quality-guidelines.md) | Trust boundaries and manual acceptance |

## Quality Check

Review the affected contracts and relevant existing tests by inspection. Do not automatically run syntax checks, lint, type-check, tests, or builds. Document the manual verification still needed; do not auto-commit or push.
