# Browser Application Guidelines

Scope: `web/`. Stack: Vite 7, React 19, React Router 7, TypeScript, Ant Design 6, Tailwind 4, and Zustand 5. Business persistence uses the authenticated application server, not browser databases.

## Pre-Development Checklist

1. Read `AGENTS.md` and [directory structure](directory-structure.md).
2. For UI, read [components](component-guidelines.md), [hooks](hook-guidelines.md), and [canvas UI](canvas-guidelines.md) when applicable.
3. For data changes, read [state management](state-management.md), [API requests](api-guidelines.md), and [type safety](type-safety.md).
4. Read [shared guides](../guides/index.md) for changes crossing package boundaries.

## Guidelines Index

| Guide | Scope |
| --- | --- |
| [Directory structure](directory-structure.md) | Pages, components, canvas ownership |
| [Components](component-guidelines.md) | Composition, Ant Design, styles, language |
| [Hooks](hook-guidelines.md) | Shared UI effects and local hooks |
| [State management](state-management.md) | Zustand, authenticated hydration, server records, media |
| [API requests](api-guidelines.md) | Provider contracts and cancellation |
| [Canvas UI](canvas-guidelines.md) | Theme, geometry, node operations |
| [Type safety](type-safety.md) | Existing types and external boundaries |
| [Quality](quality-guidelines.md) | Review and user-requested validation |
| [Application server contract](../backend/application-server.md) | Same-origin API, revisions, cleanup, deployment |

## Quality Check

Review only the relevant changes against these specs. Do not automatically run syntax checks, lint, type-check, tests, or builds; the user performs validation unless they explicitly request it. Update pending-test documentation for observable changes.
