# Type Safety

`web/tsconfig.json` enables strict TypeScript, bundler resolution, React JSX, and the `@/` alias. Extend existing domain types instead of introducing duplicate payload shapes.

## Source Contracts

- `web/src/types/canvas.ts`: `CanvasNodeData`, metadata, connections, transforms, and generation alternatives.
- `web/src/types/canvas-plugin.ts`: host plugin contracts.
- `web/src/stores/use-config-store.ts`: channels, model capabilities, and `AiConfig`.
- `web/src/services/api/video.ts`: a discriminated task-state union with pending/completed/failed states.

Built-in canvas kinds use `CanvasNodeType`, but `CanvasNodeTypeId` deliberately permits extension strings such as `pluginId:name`. Do not close this type to built-ins or assume every node can be treated as an image.

Use `import type` for type-only dependencies, as in the stores and services. Keep parsing/validation at external API, plugin, and local Agent boundaries; reuse the owner's typed projection instead of repeating casts in UI consumers.

Local Agent operation validation uses Zod in `canvas-agent/src/canvas/schemas.ts`. Use mature libraries for standard protocols and parsing, not new handwritten implementations. Do not add broad compatibility branches as a substitute for a clear current contract.
