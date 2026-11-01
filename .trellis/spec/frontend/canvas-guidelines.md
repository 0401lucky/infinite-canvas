# Canvas UI and Interaction

Read the canvas-specific rules in `AGENTS.md`. Theme definitions are in `web/src/lib/canvas-theme.ts`; theme selection is in `web/src/stores/use-theme-store.ts`; Ant Design tokens are in `web/src/lib/app-theme.ts`.

## Visual Rules

- Consume `canvasThemes`/theme store/tokens; do not hardcode black, white, stone, or slate palettes in new UI.
- Reuse the established node panels, toolbars, and modals.
- Top toolbars/status should be flat, without borders, shadows, or capsule backgrounds, with only light hover feedback.
- Ordinary canvas actions use transparent backgrounds; `theme.toolbar.activeBg` expresses selection, not decorative button fill.
- Non-image thumbnails display their icons without `theme.node.fill` backing.
- Preserve original image ratios unless free resizing is explicitly requested.
- Keep batch results and assistant panels compact.

## Behavioral Owners

Geometry/sizing belongs in `web/src/lib/canvas/canvas-node-geometry.ts` and `canvas-node-size.ts`, not duplicate component calculations. Node types/contracts are in `web/src/types/canvas.ts`; registration and extension behavior live in `web/src/lib/canvas/node-registry.ts` and the plugin runtime.

Reference collection belongs in `web/src/lib/canvas/canvas-resource-references.ts`. Group references must not duplicate resources already referenced individually. Agent operations enter through `web/src/lib/canvas/canvas-agent-ops.ts` and the canvas operation contract.

For changes to selection, resizing, grouping, generation, references, or shortcuts, add explicit manual acceptance items covering existing interactions in both themes. Do not close the user's browser tabs during verification.
