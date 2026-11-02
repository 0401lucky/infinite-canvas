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

## Agnes Provider Contract

### 1. Scope / Trigger

Agnes compatibility is selected only by the channel's explicit `apiFormat: "agnes"`. `use-config-store.ts` owns the official `AGNES_BASE_URL` and six Flash presets; `agnes.ts` owns provider-specific bodies, validations and task URLs. The existing image/video services own HTTP/SSE and private persistence. Never infer the protocol from a hostname/model name or seed models during hydration. Saved empty channel/model lists stay empty, without reconstruction from flat legacy fields; a genuinely new installation with no saved configuration retains `defaultConfig.channels`. Custom scripts retain priority.

The same provider type crosses `GET /api/shared-api-config`: keep the Zod enum in `server/src/shared-api-config.ts` aligned for both `apiFormat` and `channels[].apiFormat`. Members consume Agnes through the existing read-only shared catalog, not a separate preset or private copy. An empty shared catalog stays empty even on first login, while personal selections remain unchanged when a shared model disappears.

### 2. Signatures

`ApiCallFormat` includes `agnes`; `VideoGenerationTask.provider` and `CanvasNodeMetadata.videoTaskProvider` also include `agnes`. Creation stores Agnes `video_id` in the existing `id` / `videoTaskId` fields and retains the encoded model/channel identity. No storage-version change or migration is required.

```ts
declare function buildAgnesVideoBody(config: AiConfig, prompt: string, referenceCount?: number): Record<string, unknown>;
declare function agnesVideoQueryUrl(baseUrl: string, id: string, model: string): string;
declare function buildAgnesImageBody(config: AiConfig, prompt: string, images?: string[]): Record<string, unknown>;
declare function buildAgnesChatBody(config: AiConfig, messages: AiTextMessage[]): Record<string, unknown>;
declare function storeGeneratedVideo(result: VideoGenerationResult, options?: { signal?: AbortSignal }): Promise<UploadedFile>;
```

### 3. Contracts

| Capability | Request | Response / continuation |
| --- | --- | --- |
| Text | Pure text retains `/v1/responses`; messages containing `image_url` use `/v1/chat/completions`, with system/history unchanged | Reuse the existing SSE reader for `choices[].delta.content`, cumulative callbacks, and JSON `choices[].message.content`; Chat `auto` omits effort, `xhigh` maps to `max`, other approved efforts stay unchanged |
| Image | JSON `/v1/images/generations`, always `n: 1`; generation uses `return_base64: true`; editing uses original Data URIs in `extra_body.image` and nested `response_format: "b64_json"` | No `output_format`, top-level `response_format`, quality/background extensions; existing slot/count behavior and decoded original proportions remain authoritative |
| Video | JSON `/v1/videos` with `model`, `prompt`, `seconds`, `size: "720P"`, `aspect_ratio`, `mode: "text"` | Require `video_id`, then root `/agnesapi?video_id=...&model_name=...`; only `completed` uses top-level `url`; no ID/URL fallback to different fields |

Known image presets become `1K`/`2K`/`4K` with their ratio; auto becomes `1K` without a ratio. Custom pixels remain exact request values and may be normalized upstream. Agnes rejects explicit quality/background or unsupported ratios rather than dropping intent. Video keeps the six-second default, accepts only integer 4–12 seconds and supported 720P settings, and uses model-default audio/watermark behavior; unsupported independent settings and all video references are blocked before generation.

Apply `withLocalProxy` only after constructing external URLs; root queries must use `URL` / `URLSearchParams`, not `buildApiUrl`. Carry the original session/caller signal through awaits, per-block callbacks, polling, result downloads and `storeGeneratedVideo`. Application `/api` remains authenticated and never goes through the AI proxy. Image ten-minute timeout and video 120 polls / 2500ms are unchanged; queue-full creation adds no retry or paid-model fallback.

### 4. Validation & Error Matrix

| Condition | Outcome |
| --- | --- |
| `video_queue_full` | `agnesVideoQueueFull`, reject creation once, no task |
| Missing `video_id`, even with `id` / `task_id` | `agnesNoVideoId`, no invented recoverable task |
| Video references, unsupported seconds/resolution/audio/watermark | Corresponding `agnesVideo*Unsupported`, no generation request |
| Completed video without URL / failed status | Failed task state, never successful video |
| Saved provider protocol differs from current channel | `videoTaskProviderMismatch`, no query; preserve ID for configuration repair |
| Saved model/channel removed | `videoModelUnavailable`, no fallback query |
| Explicit image quality/background or `9:21` | Corresponding `agnesImage*Unsupported`, no silent parameter omission |
| Abort / expired session / persistence failure | Propagate failure, no old-session callback or saved-success result |

### 5. Good / Base / Bad Cases

- Good: add Agnes explicitly, fill the key, select a Flash model, and generate one result per image slot or a six-second text video; existing defaults stay selected until the user changes them.
- Base: old OpenAI channels on the Agnes hostname retain OpenAI behavior until explicitly converted; deleted preset models remain deleted after refresh/import.
- Bad: use `response.id` for root video queries, accept a URL before completion, drop private references, downgrade a 1080P request, or overwrite a user's script/defaults.

### 6. Tests Required

`web/tests/agnes-api.test.ts` contains mocked assertions for preset normalization/deletion, explicit protocol isolation, exact request fields, queue-full/no retry, task ID and root-query identity, protocol/model mismatch, image count/size rules, script priority, Chat fragmented UTF-8/SSE/JSON and reasoning, and old-session rejection. The user-authorized isolated Docker run passes 17 tests / 93 assertions; do not automatically rerun checks. Independent Chrome also verifies provider UI/import/export/deletion, simulated text/image/video flows, private originals/refresh/download/Range, container restart, and pending-video logout cancellation. Simulated replies and the CC0 test clip are not real Agnes output: actual authenticated-provider/media CORS, Chat `max` behavior, the real video lifecycle, production/proxy/other-provider regression, and remaining failure/cancellation cases still need acceptance. Mobile compact-row name truncation also needs usability confirmation. The earlier free-video queue returned 503 without a task; it was not called again in this Docker run. See the active task's `research/docker-validation.md` for precise evidence.

### 7. Wrong vs Correct

Wrong: add `agnes` only to the browser type while the shared API schema rejects it, preventing member hydration.

Correct: accept `z.enum(["openai", "gemini", "agnes"])` at the shared boundary without widening the private-field allowlist. The three additional member cases in `web/tests/agnes-api.test.ts` cover hydration/persistence, empty/read-only catalogs, and account-bound refresh with removed selections; they were added after the earlier 17-test run and have not been executed.

Wrong: persist Agnes `id` as an OpenAI task and query `/v1/videos/{id}`; silently infer Agnes from a model name.

Correct: after explicit channel selection, persist `{ id: agnesVideoTaskId(created), provider: "agnes", model: selectedModel }`, query `withLocalProxy(agnesVideoQueryUrl(baseUrl, task.id, task.model))`, and block recovery if that channel's protocol no longer matches.
