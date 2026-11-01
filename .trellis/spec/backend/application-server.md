# Application Server Contract

## 1. Scope / Trigger

Applies to `server/`, the same-origin browser API/record adapters, auth hydration, media consumers, and Docker/env wiring. Read this before changing authentication, records, media identity, cleanup, or deployment. Node 24 + Express 5 + better-sqlite3 + Argon2id + multer + Zod own standard parsing/storage/security primitives.

This is one self-hosted administrator, not registration, roles, credits, an AI gateway, or hosted cloud sync. The optional local Agent/proxy keep independent protocols and history; all-image cleanup must never touch local Agent storage. Runtime acceptance is pending, and checks/builds/commits require explicit user instruction.

## 2. Signatures

### HTTP

| Method/path | Input or behavior |
| --- | --- |
| `POST /api/auth/login` | JSON `{ username: string, password: string }` |
| `GET /api/auth/session` | `{ user: AdminUser | null }` |
| `DELETE /api/auth/session` | Revoke session; 204, repeatable |
| `GET /api/records/:namespace` | Collection snapshot and revision |
| `GET /api/records/:namespace/:key` | Record value and revision |
| `PUT /api/records/:namespace/:key` | JSON `{ value: unknown }`, `If-Match` |
| `DELETE /api/records/:namespace/:key` | `If-Match`, retain deletion revision |
| `PUT /api/records/:namespace` | JSON `{ records: Array<{ key: string, value: unknown }> }`, collection `If-Match` |
| `DELETE /api/records/:namespace` | Empty collection transaction, collection `If-Match` |
| `GET /api/media`, `GET /api/media/:key` | All metadata or metadata/null |
| `PUT /api/media/:key` | Multipart single `file`, `If-Match` |
| `PUT /api/media/:key/preview` | Multipart optional `file`, `If-Match`; absent file marks preview attempt |
| `GET /api/media/:key/original`, `GET /api/media/:key/preview` | Authenticated file/Express Range |
| `DELETE /api/media/:key` | `If-Match`; referenced/absent/inactive media returns `{ deleted: false }` |
| `GET /api/storage` | Actual managed-file usage |
| `DELETE /api/storage/images` | All saved image originals/previews, including references |

All business/media routes require a valid session, including resource misses. Public `/health` returns only `{ ok: true }`; public `/config.js` contains only analytics IDs. Static SPA/plugin assets are public, private files are not.

### Database and Browser Owners

`server/src/storage.ts` creates these SQLite tables:

```text
admin(id = 1, username, password_hash)
sessions(token_hash PRIMARY KEY, expires_at)
store_revisions(namespace PRIMARY KEY, revision)
records(namespace, key, value JSON-text-or-SQL-NULL, revision; PRIMARY KEY(namespace, key))
media(key PRIMARY KEY, kind, path, preview_path, mime_type, bytes,
      preview_bytes, preview_version, revision, status)
```

`saveRecord(namespace, key, value, expected, deleted?)` and `replaceRecords(namespace, items, expected)` are SQLite transactions. Deletion keeps record revisions; replacement has no observable empty intermediate collection.

`web/src/lib/server-storage.ts` exports `serverStateStorage` and `createServerRecordStorage(namespace)` with `getItem`, `setItem`, `removeItem`, `iterate`, `snapshot()`, and `replace(items, revision)`. `use-user-store.ts` owns restore/login/logout/load/cleanup/flush; `server.ts` owns session signal/epoch and media metadata caches.

## 3. Contracts

### Request and Response

JSON successes use `{ data: T }`, except 204; errors use `{ error: { code: string, message: string } }`. Session absence is a successful `{ data: { user: null } }` only on the session-check route, not on private reads or service failure.

```ts
type AdminUser = { id: string; username: string };
type ServerRecord = { key: string; value: unknown | null; revision: number; deleted?: boolean };
type ServerRecords = { revision: number; records: ServerRecord[] };
type ServerMedia = {
    key: string; kind: "image" | "media"; mimeType: string;
    bytes: number; previewBytes: number; previewVersion: number;
    hasPreview: boolean; revision: number; cleared: boolean;
};
type ServerStorageUsage = {
    images: number; previews: number; imageBytes: number; previewBytes: number;
    mediaBytes: number; databaseBytes: number; uploadBytes: number; totalBytes: number;
};
```

Namespaces: `app_state`, `image_generation_logs`, `video_generation_logs`, `prompt_cache`, or nonempty `plugin:<id>`. Keys are nonempty; media keys match `^(image|video|audio|file|video-reference|audio-reference):[\w-]+$`. Media paths use server-generated UUIDs, never request keys. `If-Match` is a nonnegative integer, with 0 for a never-created record/media. Collection `If-Match` belongs to the exact snapshot being replaced.

Session cookies are opaque random tokens, HttpOnly, SameSite=Strict, path `/api`, Secure when configured origin is HTTPS. SQLite stores SHA-256 token digests and fixed expiry; passwords use Argon2id. Every write requires the exact configured Origin; no wildcard CORS or blindly trusted forwarding headers. Auth happens before private body parsing/file reads, and uploads/parsed JSON writes revalidate the session before commit.

Business stores use `skipHydration`; writes stay disabled until all private state loads successfully. No business IndexedDB/localStorage fallback, automatic migration, or deletion of old browser databases. Capture the original session signal before async work; after awaits, recheck before new requests, revisions/cache updates, writes, plugin imports/factories, and activation. Reset aborts old work before clearing memory, queues, prompt refresh maps, plugins, query caches, and object URLs.

Persistent media identity is `storageKey`, not `blob:` URLs. Empty persisted `content`/`dataUrl` still hydrates by key. Downloads, references, edits, ZIP, and WebDAV read originals; previews retain the existing browser 768px/WebP 0.86 strategy and are not backup originals. Original download/decode/storage failure rejects instead of producing a fake saved resource.

### Cleanup

Media status is `active`, `clearing`, or `cleared`; the latter two expose `cleared: true`. Cleanup flushes client writes, marks the selected saved images as clearing, normalizes record references/revisions transactionally, then removes managed original/preview files. It includes orphaned image/preview files but excludes in-flight uncommitted destinations. Leftover files remain counted and may be removed by a later manual cleanup, not an automatic retry loop.

Completed tombstones retain the old key but clear paths/bytes. Save normalization removes cleared image URLs/covers and temporary object URLs while keeping structure, prompts, account/configuration, text, video/audio, and local Agent history. Tombstones cannot be overwritten by upload, old JSON, or WebDAV. Other already-open clients must refresh; revision conflicts do not automatically merge whole documents.

Explicit ZIP imports containing originals allocate new keys and remap nested key strings, metadata, and covers. Cleared entries without files stay cleared; exports serialize that state without fallback URLs. A missing non-cleared original fails export, and a referenced ZIP file missing from the package fails import. Cleanup does not delete WebDAV backups or previously downloaded user files.

### Environment and Deployment

| Key | Default/contract |
| --- | --- |
| `ADMIN_USERNAME` | `admin` on first initialization; preserve stored username when unset |
| `ADMIN_PASSWORD` | No default; required for first start, then may be omitted; explicit changed credentials revoke sessions |
| `APP_ORIGIN` | `http://localhost:3000`; valid HTTP(S) external browser origin |
| `DATA_DIR` | Repository `data/`; private directory outside all of `web/` |
| `PORT` | Development API 3001; Compose overrides to 3000 |
| `SESSION_TTL_DAYS` | Approved 7; positive integer, fixed expiry from login |
| `MAX_UPLOAD_MIB` | Approved 512 per file; positive integer |
| `MAX_JSON_MIB` | Approved 32 per JSON request; positive integer |
| `ANALYTICS_GA4_ID`, `ANALYTICS_BAIDU_ID` | Optional public IDs only |

Do not add IP rate limiting, account lockout, CAPTCHA, timeout/retry/concurrency/size boundaries or substitutes without explicit approval. Vite proxies only `/api` to the configured API port and limits filesystem serving to `web/`. Server scripts read root `.env`. Docker runs as `node` and mounts the complete `/app/data` directory, including SQLite associated files and media. Never delete the volume during ordinary updates. Docker/native dependencies/routes/permissions remain unverified; static-only Render/Vercel setups are not adapted.

SQLite API/WebDAV credentials are not encrypted by the administrator password hash. Authenticated browsers and trusted page plugins can read keys; databases, env files, and backups require sensitive-data protection.

## 4. Validation & Error Matrix

| Condition | Status/code | Required effect |
| --- | --- | --- |
| Invalid body/key/namespace/revision/multipart | 400 `INVALID_REQUEST` | No partial record overwrite |
| Aborted upload before commit | 400 `UPLOAD_ABORTED` | Remove uncommitted temporary/destination files |
| Wrong username/password | 401 `INVALID_CREDENTIALS` | No created session; do not distinguish account existence |
| Private request with absent/expired/revoked session | 401 `UNAUTHORIZED` | No private access; frontend cancels old-session work |
| Write Origin mismatch | 403 `INVALID_ORIGIN` | Reject write, including login/logout |
| Unknown API or absent original/preview | 404 `NOT_FOUND` / `MEDIA_NOT_FOUND` | No stale URL fallback |
| Revision differs from original snapshot | 409 `STORAGE_CONFLICT` | Preserve authority; user reload required |
| Clearing/cleared media read or overwrite | 410 `MEDIA_CLEARED` | Never revive old key or URL |
| File >512 MiB or JSON >32 MiB by approved defaults | 413 `REQUEST_TOO_LARGE` | No truncated overwrite or incomplete saved upload |
| Invalid byte Range | 416 `INVALID_RANGE` | Preserve Express range headers |
| Partial image filesystem deletion | 500 `IMAGE_CLEANUP_FAILED` | Report incomplete cleanup; count remaining bytes |
| Unexpected storage error | 500 `STORAGE_FAILED` | Safe response; no credentials, raw SQL, or paths |
| Invalid env / first start without password / DATA_DIR under web | Startup failure | Do not start a weak/public storage service |

Client `ServerApiError` preserves status/code/message; unreachable/malformed server response is `SERVER_UNAVAILABLE`, not anonymous/empty success. Abort stays cancellation, not a provider-source cache failure.

## 5. Good / Base / Bad Cases

- Good: authenticated browser saves a project, flushes, refreshes or signs in from another browser, and restores original media by key despite blank persisted URLs.
- Base: fresh configured administrator has no business records; authenticated hydration succeeds as empty state without pre-login private reads or writes.
- Good cleanup/import: clear referenced images, retain cleared JSON and non-images, then explicitly import a pre-cleanup ZIP; new keys restore the imported originals without overwriting tombstones.
- Bad: an old session finishes source/plugin/media work after a new login, fetches the new session signal, and writes old data or activates old plugins.
- Bad conflict: read history at revision R, fetch a newer revision R+1, then replace with the stale history using R+1.
- Bad backup: missing original becomes a URL fallback or a silently incomplete successful ZIP; storage failure becomes successful browser-local persistence.

## 6. Tests Required

These are assertion points for user-authorized validation, not checks already run:

1. Auth/origin: all private records and original/preview paths return 401 before resource probing; wrong credentials create no session; invalid write Origin is 403; logout/expiry/reconfigured credentials revoke access and fixed expiry does not slide.
2. Hydration/cancellation: no private reads/effects before login; a failed load never opens editable empty state; logout during source fetch, plugin import/discovery, upload, polling, or queued replacement causes no subsequent old-session write/cache/activation. Old refresh `finally` cannot delete a new promise.
3. Persistence/CAS: reads supply revisions; stale record and collection writes return 409 without changing data; deleted revisions remain; replacement is transactional. Network/disk/413 failure never reports successful persistence or falls back to browser business storage.
4. Media: blank saved URLs restore by key; downloads/edits/references/ZIP/WebDAV use the original, not preview; video/audio playback and Range/416 work after refresh; download/decode/storage failure is visible and leaves no incomplete saved resource.
5. Cleanup: referenced originals/previews and orphaned managed image files are removed; account/config/text/video/audio/Agent history survive; forced partial deletion fails visibly and leftover bytes remain counted. Old writes/uploads/WebDAV cannot revive tombstones.
6. ZIP: cleared state exports without files or old URLs; missing non-cleared originals fail export; missing declared files fail import; explicit originals receive new keys and nested/cover/reference remapping, including repeated keys and cleared-only packages.
7. Deployment/limits: strong first-start credentials, Node native dependencies, non-root writable volume, SQLite associated files across restart/update, SPA/plugin/config/media routes, exact HTTPS origin/Secure cookie, approved 7-day/512 MiB/32 MiB defaults, and no login throttling or unapproved limits.

## 7. Wrong vs Correct

Wrong: use an empty display URL as proof that a persisted image is absent, or revive it from stale content.

```ts
if (!image.dataUrl) return image;
return { ...image, dataUrl: await resolveImageUrl(image.storageKey, image.dataUrl) };
```

Correct: stored identity remains authoritative; the resolver does not fall back when a key is missing/cleared.

```ts
if (!image.storageKey) return image;
return { ...image, dataUrl: await resolveImageUrl(image.storageKey) };
```

Wrong: refresh the revision after transforming an old snapshot, defeating conflict detection.

```ts
const old = await records.snapshot();
const merged = await mergeRemote(old.records);
await records.replace(merged, (await records.snapshot()).revision);
```

Correct: bind replacement to the snapshot actually used, and guard its original session after async work.

```ts
const signal = serverSessionSignal();
const snapshot = await records.snapshot();
const merged = await mergeRemote(snapshot.records);
signal.throwIfAborted();
await records.replace(merged, snapshot.revision);
```
