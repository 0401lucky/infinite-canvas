# Shared Development Guides

Read `AGENTS.md` first. These guides capture actual package boundaries rather than a generic API/service/database architecture.

| Guide | When to read |
| --- | --- |
| [Code reuse](code-reuse-thinking-guide.md) | Adding UI actions, stores, helpers, or parsing |
| [Cross-layer contracts](cross-layer-thinking-guide.md) | Agent events, canvas operations, persistence, plugin interfaces |
| [Plugins](plugin-guidelines.md) | Node plugins, SDK, host runtime, registry |
| [Documentation](documentation-guidelines.md) | Docs site, TODO, pending-test, changelog, releases |

Before introducing a new owner or abstraction, search the corresponding existing directory with `rg`. For behavioral limits, preserve current defaults unless the user confirms the new default and failure behavior.

The default Trellis workflow is single-owner and does not automatically run checks or commit. Existing sub-agent profiles are available only when delegation is explicitly requested. Record precise discoveries in specs/tasks, not generic advice or sensitive credentials.
