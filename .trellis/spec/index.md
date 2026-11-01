# Infinite Canvas Development Specs

Read `AGENTS.md` first. These specs describe the current repository and do not override its rules.

| Scope | Entry | Source |
| --- | --- | --- |
| Browser application | [Frontend](frontend/index.md) | `web/` |
| Application server, local Agent and optional proxy | [Services](backend/index.md) | `server/`, `canvas-agent/`, `canvas-proxy/` |
| Cross-layer changes, plugins, documentation | [Shared guides](guides/index.md) | Multiple packages |

The main app is Vite + React, not Next.js. Only `docs/` uses Next.js. The personal edition requires the authenticated `server/` application for SQLite and media persistence; this is self-hosted storage, not a hosted cloud service. AI requests remain browser-direct or use the optional local proxy.

Specs were bootstrapped and refreshed by source inspection. Follow the [application server contract](backend/application-server.md) for storage/authentication changes and keep local Agent protocol/history rules independent. Runtime acceptance of the new server and Docker deployment remains pending; no automatic checks or builds are authorized.
