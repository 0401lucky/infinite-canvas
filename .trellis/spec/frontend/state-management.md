# State Management and Server Persistence

Use local React state for transient component UI and Zustand for global or cross-page state. `web/src/stores/canvas/use-canvas-ui-store.ts` owns canvas UI state; `use-canvas-store.ts` owns persisted projects.

## Existing Persistence Pattern

`web/src/stores/canvas/use-canvas-store.ts` uses Zustand `persist`, `partialize`, an asynchronous storage adapter, and a `hydrated` flag. Keep persistence restricted to actual business fields; do not persist actions or derived UI state.

`web/src/lib/server-storage.ts` provides `serverStateStorage` and `createServerRecordStorage(namespace)`. Config, prompt-source, canvas, asset, and plugin stores use `skipHydration: true`; `use-user-store.ts` confirms the session, loads media metadata, hydrates them manually, and enables writes only after every store is loaded. Loading failures keep the private routes gated, not editable with empty defaults.

`createServerRecordStorage` exposes `getItem`, `setItem`, `removeItem`, `iterate`, `snapshot`, and `replace(items, revision)`, not a full localforage API. Writes are queued by document and use previously read revisions. Collection replacement must use the revision returned by the snapshot being replaced, never a fresh revision fetched just before writing old data. Preserve canvas's existing 400ms debounce and explicit `flushCanvasSave`/`flushAppStorage` behavior.

`use-storage-store.ts` keeps pending/failed-write/error/session-expiry state; shared UI reports errors. Failed persistence must not become an empty successful read, a fallback cache write, or a success notification. Flush before actions that promise data was saved. No IndexedDB/localStorage business fallback and no automatic browser-data migration or deletion.

`web/src/stores/use-theme-store.ts`, `web/src/i18n/index.ts`, panel settings, and local Agent connection settings may keep tiny localStorage preferences. API keys, business lists, histories, prompt caches, plugin JSON, and media belong to the server.

## Session Lifecycle

On logout, 401, or reload, `resetServerSession` aborts old requests and advances the session epoch before business state is cleared. Discard queued canvas saves, clear query/media/prompt caches, and deactivate installed and development plugins while writes are disabled. Clearing memory must not persist empty business state.

Capture `serverSessionSignal()` before asynchronous work. Check that original signal after awaits and before starting another request, updating revision caches, writing records, or activating a plugin. Do not obtain a new session signal halfway through old-session work. In-flight map cleanup must remove only its own promise, so an old `finally` cannot remove a new session's refresh.

Include asynchronous config/ZIP file reads and custom canvas/asset hydration in this rule. A hydration completion callback may update `hydrated` only in its starting epoch; canceled older loading must reject rather than report success or reset a later session's loaded state.

## Media Ownership

- `web/src/services/image-storage.ts` owns image upload/read APIs, previews, original Blob caches, and resolved URLs; SQLite and private files are the persistence owner.
- `web/src/services/file-storage.ts` owns video/audio/media APIs, runtime Blob caches, and ZIP key remapping.
- Persist storage keys and metadata, not temporary `blob:` URLs as the authoritative media data.
- Preserve original image proportions and use original files for edits, exports, downloads, and generation references.
- Before deleting media, consider every owner, including assets, canvas projects, and workbench history. Do not delete another owner's referenced file.

Saved `content`/`dataUrl` may be empty because the server strips temporary object URLs. Hydrate by `storageKey` even when the URL is empty; missing/cleared keys never fall back to stale content or covers. Keep the 768px / WebP 0.86 preview strategy separate from originals. Shared downloads use `use-download-media.ts` and read original files.

The explicit all-images cleanup is the exception to reference preservation: it clears every saved image original/preview, keeps tombstones and project/non-image data, and blocks stale saves and WebDAV revival. `serializeMediaExport` preserves cleared flags without fallback URLs; a missing non-cleared original fails export. `restoreMediaFiles` allocates new keys and remaps nested keys and covers for explicit ZIP imports containing originals.

The server is self-hosted, not a hosted cloud database or real-time collaboration layer. Existing WebDAV remains optional. Local Agent message storage retains its independent version, backup, and refusal-on-corruption requirements. See [application server](../backend/application-server.md) for concrete contracts and deferred assertions.
