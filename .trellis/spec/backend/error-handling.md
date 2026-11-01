# Service Error Handling

Keep failures visible at the boundary that owns the request. Do not turn corrupted persistence, missing credentials, or an invalid selection into success or an unrelated fallback.

## Existing Patterns

`server/src/index.ts` uses Express 5 async handlers and a final error boundary. `ApiError` preserves status/code and a safe message; Zod/body-parser/multer errors map to 400/413, file Range failures to 416, and unknown storage failures to sanitized 500 responses. Do not return raw paths, credentials, SQL errors, or payloads. Application failures must not become browser fallback storage. See [application server](application-server.md) for the full matrix.

`canvas-agent/src/server/http.ts` wraps asynchronous handlers with `route` and uses final Express error middleware. Responses use `ok`/`error`; specific Skill and approval errors retain meaningful HTTP statuses.

`canvas-agent/src/skills/store.ts` defines `SkillStoreError`. `canvas-agent/src/agent/codex.ts` defines Skill lookup and thread-recovery behavior. Reuse these owners rather than duplicating message-based exception detection in routes.

`canvas-agent/src/canvas/schemas.ts` validates operations at the Agent/canvas boundary. Keep malformed requests out of domain operations.

`canvas-proxy/index.js` forwards upstream statuses and response bodies. It is not a provider-specific validation layer and must not rewrite provider request payloads or buffer SSE.

Do not add retries, timeouts, permissive origins, public listeners, or size limits as incidental cleanup. Explain behavioral boundaries and obtain confirmation before changing them. Never swallow message-storage corruption or leak credentials through error details.
