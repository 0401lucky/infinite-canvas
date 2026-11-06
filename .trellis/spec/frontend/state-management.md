# State Management and Server Persistence

Use local React state for transient component UI and Zustand for global or cross-page state. `web/src/stores/canvas/use-canvas-ui-store.ts` owns canvas UI state; `use-canvas-store.ts` owns persisted projects.

## Existing Persistence Pattern

`web/src/stores/canvas/use-canvas-store.ts` uses Zustand `persist`, `partialize`, an asynchronous storage adapter, and a `hydrated` flag. Keep persistence restricted to actual business fields; do not persist actions or derived UI state.

`web/src/lib/server-storage.ts` provides `serverStateStorage` and `createServerRecordStorage(namespace)`. Config, prompt-source, canvas, asset, and plugin stores use `skipHydration: true`; `use-user-store.ts` confirms the session, loads media metadata, hydrates them manually, and enables writes only after every store is loaded. Loading failures keep the private routes gated, not editable with empty defaults.

`createServerRecordStorage` exposes `getItem`, `setItem`, `removeItem`, `iterate`, `snapshot`, `replace(items, revision)`, `subscribe(listener)`, and `getSnapshot()`, not a full localforage API. Queues are grouped by exact namespace and record key; the reserved empty key is a collection barrier. Collection reads/replacements enter the queue immediately, wait for prior namespace tasks, and block later record tasks until their response revisions have been remembered. Different keys without a collection barrier and different namespaces stay parallel. Writes use previously read revisions; replacement must use the revision returned by the snapshot being replaced, never a fresh revision fetched just before writing old data. Preserve canvas's existing 400ms debounce and explicit `flushCanvasSave`/`flushAppStorage` behavior.

The subscription snapshot is a page-local invalidation counter, not a server CAS revision. It changes only after successful collection replacement, allowing image/video workbenches to refresh history through `useSyncExternalStore` without remounting. Unsubscribed or old-session listeners are not notified; a listener error must not turn a committed save into a failed save. History reads keep a monotonic request owner and ignore older completion after media hydration or unmount.

Manual video submission reserves its existing active-log ID while saving/refreshing the pending history, then hands ownership to its original poll call without another await between release and polling. A sync-driven refresh must not resume that record first and lose the submission's Agent/configuration ownership; unrelated pending IDs remain eligible for existing recovery.

WebDAV sync restores incoming node/assistant media and asset custom covers, then rereads current canvas/assets after these awaits before applying the existing timestamp/deletion merge. `applyData` returns the data actually applied for remote serialization. Shared missing-media jobs are deduplicated by key within that sync only. Do not use `reloadData()` as sync completion: it resets private stores and workbench input/results. Changed history collections refresh in place; if history changes after its original snapshot, reject replacement rather than silently overwrite it. Existing asset/history deletion policies and partial-domain sync behavior are unchanged.

`use-storage-store.ts` keeps pending/failed-write/error/session-expiry state; shared UI reports errors. Failed persistence must not become an empty successful read, a fallback cache write, or a success notification. Flush before actions that promise data was saved. No IndexedDB/localStorage business fallback and no automatic browser-data migration or deletion.

Count a queued write as pending from invocation, including while it waits behind a collection read. Release that count in the queue promise's finalizer even when readiness checks reject it; old-epoch finalizers cannot decrement a new session's count. Otherwise the save indicator/unload guard can incorrectly treat deferred unsaved work as clean.

`web/src/stores/use-theme-store.ts`, `web/src/i18n/index.ts`, panel settings, and local Agent connection settings may keep tiny localStorage preferences. API keys, business lists, histories, prompt caches, plugin JSON, and media belong to the server.

## Session Lifecycle

On logout, 401, or reload, `resetServerSession` aborts old requests and advances the session epoch before business state is cleared. Discard queued canvas saves, clear query/media/prompt caches, and deactivate installed and development plugins while writes are disabled. Clearing memory must not persist empty business state.

Capture `serverSessionSignal()` before asynchronous work. Check that original signal after awaits and before starting another request, updating revision caches, writing records, or activating a plugin. Do not obtain a new session signal halfway through old-session work. In-flight map cleanup must remove only its own promise, so an old `finally` cannot remove a new session's refresh.

The storage adapter discards old namespace queues when it observes a new session epoch; old queue cleanup must also match the queue instance. Sync timestamps, progress callbacks and success messages belong to the original session/run, not whatever user is active when an await returns.

Include asynchronous config/ZIP file reads and custom canvas/asset hydration in this rule. A hydration completion callback may update `hydrated` only in its starting epoch; canceled older loading must reject rather than report success or reset a later session's loaded state.

`resetServerSession(userId)` binds protected requests to the hydrated account with `X-Canvas-User`; a cross-tab cookie/account switch must fail with 401 instead of saving old state into the new user's store. Members must load the administrator's shared API settings before hydration completes. `use-config-store.ts` keeps these in non-persisted `sharedApiConfig`, overlays provider fields on private preferences, and omits shared providers/keys from member config persistence. Initial default models are inherited; subsequent member selections stay private. The refresh action updates shared providers on window focus or an explicit request, preserving unavailable selected models instead of silently switching channels.

## Media Ownership

- `web/src/services/image-storage.ts` owns image upload/read APIs, previews, original Blob caches, and resolved URLs; SQLite and private files are the persistence owner.
- `web/src/services/file-storage.ts` owns video/audio/media APIs, runtime Blob caches, and ZIP key remapping.
- Persist storage keys and metadata, not temporary `blob:` URLs as the authoritative media data.
- Preserve original image proportions and use original files for edits, exports, downloads, and generation references.
- Before deleting media, consider every owner, including assets, canvas projects, and workbench history. Do not delete another owner's referenced file.

Saved `content`/`dataUrl` may be empty because the server strips temporary object URLs. Hydrate by `storageKey` even when the URL is empty; missing/cleared keys never fall back to stale content or covers. Keep the 768px / WebP 0.86 preview strategy separate from originals. Shared downloads use `use-download-media.ts` and read original files.

The explicit all-images cleanup is the exception to reference preservation: it clears every saved image original/preview, keeps tombstones and project/non-image data, and blocks stale saves and WebDAV revival. `serializeMediaExport` preserves cleared flags without fallback URLs; a missing non-cleared original fails export. `restoreMediaFiles` allocates new keys and remaps nested keys and covers for explicit ZIP imports containing originals.

The server is self-hosted, not a hosted cloud database or real-time collaboration layer. Existing WebDAV remains optional. Local Agent message storage retains its independent version, backup, and refusal-on-corruption requirements. See [application server](../backend/application-server.md) for concrete contracts and deferred assertions.
