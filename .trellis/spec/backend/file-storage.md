# Local File Storage

Scope here is the optional local Agent. Application SQLite/media persistence belongs to `server/` and the [application server contract](application-server.md), not these local tools. Do not move Agent history into application records or clear it during image cleanup.

`canvas-agent/src/config.ts` owns configuration under the user's `.infinite-canvas` directory. Use its helpers for configuration and workspace changes rather than inventing parallel paths.

`canvas-agent/src/agent/message-metadata.ts` owns pending message metadata, thread-bound records, preview assets, a manifest, and serialized writes. It binds client messages to exact thread/turn ownership. `canvas-agent/src/skills/store.ts` owns local Skill files.

## Required Safety

- Agent communication protocol versions and message-storage versions remain independent.
- Before a message-storage format upgrade, back up first, then migrate. Unknown versions, damaged manifests, or conflicting backups must refuse overwriting the original.
- Never prune historical metadata silently by record count or file size.
- Deleting a thread must remove its metadata and owned previews through the storage owner, not browser IndexedDB or text matching.
- Preserve write serialization and filesystem path containment. Use mature parsers already in the package: gray-matter, yaml, and Zod.

The no-legacy-migration rule for application/browser business data does not cancel the explicit Agent message-history safety requirements in `AGENTS.md`.

Examples: `canvas-agent/src/agent/message-metadata.test.ts`, `canvas-agent/src/skills/store.test.ts`, and `canvas-agent/src/config.test.ts`.
