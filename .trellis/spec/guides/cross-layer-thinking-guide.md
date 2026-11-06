# Cross-Layer Contracts

## Actual Runtime Boundaries

1. Browser pages/components call Zustand and `web/src/services/api/`.
2. Providers receive requests directly, or through the optional `canvas-proxy/` forwarding process.
3. Canvas operations connect the browser host to the local `canvas-agent/` HTTP/MCP service.
4. Node plugins use the SDK and host runtime; they are not independent React applications.
5. Authenticated application SQLite/media and local Agent filesystem history are distinct owners.

For application storage, trace UI -> `server.ts`/`server-storage.ts` -> authenticated route -> SQLite/private file, then hydration back to UI. Check original-session cancellation across every await, snapshot revision ownership, original-versus-preview use, cleared-image state, and explicit ZIP key remapping. Concrete signatures/errors live in [application server](../backend/application-server.md), not in this thinking guide.

For same-page races, ask whether collection operations are registered before waiting and whether an older response can undo a newer cached revision. For sync completion, check that media is hydrated before merging current edits and that refreshing history does not reset page inputs or active generation. Local invalidation counters are not CAS revisions; see the application-server and frontend state-management contracts.

## Agent Conversations

Changes must preserve `threadId`, `turnId`, and `itemId` ownership. Materialized turn snapshots are authoritative; do not merge the same message again from live events. Display metadata additionally binds exact `clientMessageId` to thread/turn in `canvas-agent/src/agent/message-metadata.ts`.

Trace both browser consumers in `web/src/stores/use-agent-store.ts` and local history/session code in `canvas-agent/src/agent/codex-history.ts` and `canvas-agent/src/canvas/session.ts`. Add acceptance for refresh, restart, reconnect, and multiple browser tabs.

Protocol upgrades must not reset the separate message-storage format. Storage upgrades require backup and refusal on unknown/damaged state; they must not prune history.

## Canvas and Plugins

Operation schemas are in `canvas-agent/src/canvas/schemas.ts`; browser application is in `web/src/lib/canvas/canvas-agent-ops.ts`. Node types and plugin contracts are shared with `web/src/types/` and `plugins/canvas/sdk/src/types.ts`.

Trace create/update/export/reference consumers before changing fields. Keep image ratios, group references, cancellation, storage keys, and workbench ownership consistent. Document new behavior in pending-test; do not add compatibility logic or change limits without an explicit requirement.
