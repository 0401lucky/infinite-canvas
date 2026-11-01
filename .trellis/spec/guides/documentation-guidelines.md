# Documentation and Progress

`README.md` stays brief: introduction, core capabilities, quick start, and documentation entry points. `docs/index.md` is the AI-facing index, outside the published MDX content tree.

## Documentation Site

Only `docs/` uses Next.js and Fumadocs. `docs/source.config.ts` defines the content collection. `docs/src/lib/i18n.ts` uses English as the default and `.zh-CN.mdx` sibling files for Chinese, with no cross-language fallback. Keep affected sibling pages aligned; preserve frontmatter and section `meta.json` navigation.

## Progress Workflow

- Future work: `docs/content/docs/progress/todo.mdx` and its Chinese sibling.
- Implemented, awaiting user confirmation: `docs/content/docs/progress/pending-test.mdx` and its Chinese sibling.
- Confirmed features: `docs/content/docs/overview/features.mdx`.
- Substantial user-visible changes: one concise Chinese Unreleased entry in `CHANGELOG.md`, using the existing category prefix style.

When completing a TODO, move it to pending-test first, not directly to features. Before every task ends, inspect TODO and pending-test; if neither changes, explicitly conclude no update is needed. Changelog entries summarize a version-level change rather than duplicating detailed acceptance items.

Do not add stale dates, claim a hosted cloud database, or overstate Docker deployment verification. Personal-edition business data is persisted by the self-hosted application server; API keys are in SQLite and still delivered to the authenticated browser for provider requests. Env files, databases, and backups are sensitive. Static-only Vercel/Render configs are not adapted to this persistent service.

The explicit release process in `AGENTS.md` owns VERSION, commits, and tags; never initiate a release, merge, push, or automatic build as a side effect of documentation or Trellis bookkeeping.
