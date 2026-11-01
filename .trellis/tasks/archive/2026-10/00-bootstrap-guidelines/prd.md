# Bootstrap Infinite Canvas Development Guidelines

## Goal

Initialize the official Trellis workflow for secondary development and populate project-specific coding specs from the existing repository.

## Scope

- `.trellis/`, Codex integration, and bundled Trellis skills.
- Read `AGENTS.md`, source, package manifests, existing tests, and development/progress documentation.
- Add workflow entry points and pending manual acceptance documentation.
- Do not change application code, dependencies, storage formats, VERSION, or existing skills. Do not run syntax checks, builds, or tests, and do not commit.

## Architecture Context

`web/` is a browser-first Vite/React application. `canvas-agent/` and `canvas-proxy/` are optional local Node.js tools. `plugins/canvas/` uses a shared SDK and host React. Only `docs/` uses Next.js. Browser localforage data and local Agent metadata files are separate storage boundaries.

Analysis used direct source inspection and `rg`; GitNexus/ABCoder were not required. The stable CLI and bootstrap skill both come from upstream tag `v0.6.17`.

## Acceptance Criteria

- [x] Official CLI scaffolding and bootstrap skill are installed.
- [x] Specs contain concrete source-backed patterns and no empty template sections.
- [x] Spec indexes cover frontend, local services, plugins, and documentation.
- [x] Existing AGENTS rules remain authoritative, with inline execution and no automatic checks or commits.
- [x] Documentation records manual verification; unrelated TODOs and business code remain unchanged.

## Manual Acceptance

Start a new Codex session and invoke `trellis-start`. Confirm developer/context/spec discovery, inline execution, and no automatic build/test/commit. Native hook approval remains a separate host-side action. No application tests were executed during initialization.
