# Logging and Credential Redaction

The application server logs only startup and sanitized error name/code or generic filesystem warnings. Do not log passwords, session cookies/tokens, API keys, request bodies, or full URLs. Public `config.js` contains analytics IDs only; SQLite/env/backups remain sensitive even though passwords and session tokens are hashed.

For the local Agent, use the shared `logger` in `canvas-agent/src/utils/logger.ts`. It uses Winston, Info-and-above console output normally, and additional Debug/file output only with `--debug`.

Structured details are sanitized for token/Authorization/API-key fields, Data URLs, and circular references. This does not make arbitrary interpolated message strings safe.

## Agent stderr

`canvas-agent/src/utils/agent-runtime.ts` provides `redactAgentLog` and `createAgentLogWriter`. The writer strips ANSI and buffers lines so a credential split across stderr chunks is redacted before reaching logs or browser diagnostics.

Reuse the writer in Codex/Claude adapters. Do not emit raw chunks first and redact only a later copy. Preserve ordinary non-sensitive stderr so diagnostics remain useful.

`canvas-agent/src/utils/agent-runtime.test.ts` is the regression reference for credential assignments, Bearer tokens, ANSI, and chunk boundaries.

The standalone proxy currently logs forwarding summaries to the terminal. Do not add request headers/bodies, API keys, or disk logging to it. Avoid logging full credential-bearing target URLs.
