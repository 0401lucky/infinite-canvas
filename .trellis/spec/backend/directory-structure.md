# Service Directory Structure

`server/` is a private ESM TypeScript package running through tsx on Node 24. Relative runtime imports use `.js` suffixes. Keep its modules direct rather than adding ORM/repository/controller forwarding layers:

| Location | Responsibility |
| --- | --- |
| `server/src/config.ts` | Validated env, private directory ownership, approved limits |
| `server/src/storage.ts` | SQLite schema, record revisions/transactions, media tombstones |
| `server/src/auth.ts` | Administrator hash, opaque sessions, cookie and origin validation |
| `server/src/media.ts` | Streamed uploads, original/preview serving, usage, cleanup |
| `server/src/index.ts` | API composition, static SPA/config, sanitized error boundary |

See [application server](application-server.md) before changing these contracts. The application never becomes an AI gateway or local Agent history owner.

## Optional Local Tools

`canvas-agent/src/index.ts` selects HTTP mode or MCP mode. The package uses ESM TypeScript; relative runtime imports retain `.js` suffixes.

| Location | Responsibility |
| --- | --- |
| `canvas-agent/src/server/http.ts` | Local HTTP routes, auth, SSE/browser connection |
| `canvas-agent/src/server/mcp.ts` | MCP server |
| `canvas-agent/src/agent/` | Codex/Claude adapters, history, message metadata |
| `canvas-agent/src/canvas/` | Canvas sessions, operations, Zod schemas |
| `canvas-agent/src/skills/` | Local Skill storage and resource operations |
| `canvas-agent/src/config.ts` | Local configuration/workspace ownership |
| `canvas-agent/src/utils/` | Logging, redaction, and shared utilities |
| `canvas-proxy/index.js` | Standalone forwarding proxy |

Tests live beside source: `canvas-agent/src/canvas/session.test.ts`, `canvas-agent/src/agent/message-metadata.test.ts`, and `canvas-agent/src/utils/agent-runtime.test.ts` are relevant examples.

Keep web-provider requests out of the application/Agent packages. Do not replace the current Claude CLI adapter during unrelated work; its SDK replacement remains in the project TODO. The proxy must stay a small standalone forwarding service, not handle application `/api`.
