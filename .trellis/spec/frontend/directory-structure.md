# Frontend Directory Structure

`web/src/main.tsx` mounts `AppProviders` and React Router. Keep route definitions in `web/src/router.tsx`.

| Location | Ownership |
| --- | --- |
| `web/src/pages/<feature>/index.tsx` | Route page and its primary business UI |
| `web/src/layouts/` | Page layouts |
| `web/src/components/` | Reused UI |
| `web/src/hooks/` | Hooks actually reused across pages |
| `web/src/stores/` | Global state and actions |
| `web/src/services/api/` | External AI requests and the separate same-origin `server.ts` client |
| `web/src/services/` | Server-backed media, WebDAV, and other shared services |
| `web/src/types/` | Shared data contracts |
| `web/src/pages/canvas/` | Canvas route pages |
| `web/src/components/canvas/` | Canvas UI and interactions |
| `web/src/stores/canvas/` | Canvas stores |
| `web/src/lib/canvas/` | Canvas geometry, references, registry, operations |

Use the existing `@/` alias configured in `web/tsconfig.json`. Hooks and components used by only one page stay in that page's directory. Do not introduce forwarding components or an extra Manager component for a page with one main UI.

Examples: `web/src/pages/image/index.tsx`, `web/src/pages/canvas/project.tsx`, `web/src/hooks/use-copy-text.ts`, `web/src/lib/canvas/canvas-node-geometry.ts`.

`web/src/lib/server-storage.ts` owns persisted-state adapters and record queues; `use-user-store.ts` owns authentication/loading, and `use-storage-store.ts` owns pending/error state. Do not add a browser business-storage adapter or pass these global owners through layers of props.
