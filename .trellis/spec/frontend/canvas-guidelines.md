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

## Node Image Privacy

### Scope

Built-in image nodes and their related canvas views are the privacy owner. An image batch shares one flag; same-image node copies retain it and can then toggle independently.

### Signatures

The image toolbar toggles `CanvasNodeMetadata.privacyBlurred?: boolean` (`web/src/types/canvas.ts`).

`canvasImagePrivacyStyle: CSSProperties` and `renderCanvasImagePreview(image: ReactElement, privacyBlurred?: boolean)` in `web/src/lib/canvas/canvas-image-privacy.ts` are display-only. `CanvasResourceReference` and `NodeGenerationResourceInput` carry a derived display flag, never a modified original `ReferenceImage`.

### Contracts

- Save the field with existing server-backed canvas records; hydration/ZIP preserve ordinary metadata. No backend schema, migration, browser business storage, or global `storageKey` registry is needed.
- Apply the shared blur only to image elements, clipped by their containers; do not blur buttons/text or animate from clear to blurred. Cover main/batch images, element lists, large/retained previews, reference strips, prompt candidates/chips, and Agent canvas-reference views.
- Keep source node identity in preview state rather than only a URL. Update existing contentEditable image styles before paint without rebuilding focused text or moving the caret; `use-agent-bridge.ts` publishes the snapshot before paint, and Agent views read current node flags directly.
- The privacy button is separate from hideable quick tools so it cannot lose its cancel entry. Reuse existing toolbar visuals without resetting user preferences.
- Downloads, exports, AI references, independent asset/workbench records and Agent uploads remain original. New independent generation is not automatically marked; in-place regeneration retains existing metadata. Agent message metadata/protocol versions are unchanged.

### Validation And Error Matrix

| Condition | Result |
| --- | --- |
| Missing/false flag | Normal display |
| True flag | Blur all related image views, including already-open previews |
| Blurred original-image editor | Contextual unblur-first message; do not open/reveal the editor |
| Flag enabled while editor is open | Hide that editor's original until explicit unblurring |
| Canvas save failure | Existing storage error; no saved-success or browser fallback |

### Cases

- Good: toggle one image batch; alternate/preview/reference images blur together and original media bytes stay unchanged.
- Base: unmarked images, videos, text and independently saved assets stay unchanged.
- Bad: hiding only the canvas node, caching only a preview URL, rewriting originals, or linking every use of a storage key.

### Required Acceptance

- Manual assertions: individual toggle/cancel, successful-save refresh, batch primary/copy/retry, all preview surfaces and focused tokens, edit guarding, original download/ZIP/AI references, both themes and mobile. See the Image Privacy section in pending-test; do not automatically run checks.

### Wrong Vs Correct

```tsx
// Wrong: turning display privacy into an original-file rewrite.
await overwriteStoredImage(storageKey, blurredBlob);
// Correct: retain the original URL and apply only the node's visual flag.
<img src={originalUrl} style={node.metadata?.privacyBlurred ? canvasImagePrivacyStyle : undefined} />;
```
