# Component Guidelines

Use function components and existing hooks. Keep business logic with its actual owner instead of introducing layers for abstraction alone.

## Shared Context

`web/src/components/layout/app-providers.tsx` owns Ant Design configuration, `App`, locale, and the shared React Query client. Use `App.useApp()` for contextual messages and dialogs. Read stores where values/actions are needed; do not relay global values through several components.

Source-backed examples:

```tsx
const theme = useThemeStore((state) => state.theme);
const { message } = App.useApp();
```

The selector appears in `AppProviders`; contextual messages appear in `web/src/hooks/use-copy-text.ts`.

## Presentation

- Follow the existing UI rather than applying a new design system.
- Ant Design APIs must match `web/package.json`; consult https://ant.design/llms-full.txt before changing component usage.
- Global Alias/Component tokens belong in `web/src/lib/app-theme.ts`, not per-popup color overrides.
- Use Tailwind classes or small inline styles for private styles. `web/src/styles/globals.css` is for shared foundations and necessary third-party overrides.
- Use lucide-react or existing Ant Design icons.
- Keep Chinese copy and preserve the established translation keys in `web/src/i18n/locales/zh-CN.ts` and `web/src/i18n/locales/en-US.ts` when editing localized UI.

Avoid theme-specific branches in page-private admin components, excessive props, forwarding-only components, and page-specific global CSS.
