# Hook Guidelines

Global or cross-page UI effects belong in `web/src/hooks/`, not in a state store merely to make them reusable.

`web/src/hooks/use-copy-text.ts` combines clipboard copying with an Ant Design success message and localized copy. Reuse this hook rather than duplicating the same sequence across pages.

`web/src/hooks/use-prompt-source-scheduler.ts` owns the prompt refresh effect; provider fetching stays under `web/src/services/api/`. `web/src/components/canvas/use-image-editor-viewport.ts` is an example of a canvas-local hook.

## Ownership

- A hook private to one page stays in its page directory.
- Shared state/actions already owned by a store or global hook are consumed directly where needed.
- Browser subscriptions, listeners, timers, and object URLs need cleanup with the lifetime of their owner.
- Keep user-triggered actions in handlers instead of unrelated effects; `AppProviders` effects are specifically for document theme and locale synchronization.

Do not extract one-line forwarding hooks, move UI notifications into Zustand, or pass a global hook's results through many components.
