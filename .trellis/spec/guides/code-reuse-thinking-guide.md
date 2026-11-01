# Code Reuse in Infinite Canvas

Search before adding an abstraction. Reuse an existing owner when it fits; do not force unrelated code together merely because it looks similar.

| Need | Existing owner |
| --- | --- |
| Copy text and show feedback | `web/src/hooks/use-copy-text.ts` |
| Application/theme tokens | `web/src/lib/app-theme.ts`, `web/src/lib/canvas-theme.ts` |
| Shared browser business state | `web/src/stores/` |
| Persisted state and records | `web/src/lib/server-storage.ts`, `web/src/services/api/server.ts` |
| Image/media storage | `web/src/services/image-storage.ts`, `web/src/services/file-storage.ts` |
| Original media download feedback | `web/src/hooks/use-download-media.ts` |
| Provider requests | `web/src/services/api/` |
| Canvas references and geometry | `web/src/lib/canvas/` |
| Agent logging/redaction | `canvas-agent/src/utils/logger.ts`, `canvas-agent/src/utils/agent-runtime.ts` |
| Plugin React/runtime types | `plugins/canvas/sdk/` |

Use `rg` to find the symbol and its consumers, then read the implementation. A new helper should simplify repeated real behavior, not add a forwarding layer. Shared stores/hooks are consumed directly instead of relayed through props.

Do not reimplement standard parsing, compression, date handling, or protocols. The project uses better-sqlite3, argon2, multer, cookie-parser, fflate, dayjs, gray-matter, yaml, and Zod. Do not refactor unrelated callers while adding one feature or reintroduce browser business persistence.
