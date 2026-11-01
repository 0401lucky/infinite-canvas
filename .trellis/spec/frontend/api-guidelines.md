# Application and External API Requests

AI keys are stored in server SQLite but delivered to the authenticated browser, which calls providers directly or through the existing optional local proxy. Keep requests in `web/src/services/api/`. The separate `server.ts` client uses same-origin `/api`, cookies, and `no-store`; application auth/records/media requests must never use the AI proxy.

## Existing Boundaries

- `web/src/services/api/image.ts`: image generation/editing, text responses, model discovery.
- `web/src/services/api/video.ts`: remote task creation, polling, and video results.
- `web/src/services/api/model-plugin.ts`: user-configured API call scripts.
- `web/src/services/api/prompts.ts`: prompt-source requests and server-backed cache.
- `web/src/stores/use-config-store.ts`: channel/model configuration, `AiConfig`, and `withLocalProxy`.

Reuse `compactApiParams` and `serializeApiParams` in `web/src/services/api/request.ts`; repeated array query values are serialized with `URLSearchParams.append`.

## Provider Contracts

Preserve OpenAI/Gemini differences and explicit selected channels/models. A removed selection must not silently send credentials to another provider. Combine the caller's `AbortSignal` with the original session signal and keep it through requests, streams, polling, and result persistence. Guard continuations after awaits so expired work cannot start a request using a newly authenticated session.

Keep image/media persistence in the existing storage services. A successful HTTP response is not proof that its body is a valid image. `uploadImage` must read and decode the original before server storage; a CORS-blocked but displayable URL is not a saved original. Download/storage failure rejects instead of inventing a key or a successful saved result. Directly supplied remote display URLs are not a persistence guarantee, and a supplied missing/cleared key must never fall back to one.

`ServerApiError` carries `status`, `code`, and localized `message`. Storage/auth/conflict failures and aborts must propagate, not become a prompt-source fallback cache or an empty history. A provider-source failure may retain its previous successful cache, but a failed server write may not be reclassified as that source failure. See [application server](../backend/application-server.md) for envelopes, revisions, error codes, and approved limits.

The optional `canvas-proxy/` only forwards requests for CORS workarounds. It is not an application API or credential database.

Before adding/changing timeouts, retry counts, size limits, or concurrency, explain the affected operation, default, and failure behavior and obtain user confirmation. Never log API keys, Authorization headers, or full sensitive payloads.
