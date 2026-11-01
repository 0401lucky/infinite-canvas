# Infinite Canvas Documentation Index

## AI Development Workflow

- [Trellis Setup](../.trellis/README.md)
- [Development Workflow](../.trellis/workflow.md)
- [Project Coding Specs](../.trellis/spec/index.md)
- Start with `trellis-start`; `AGENTS.md` remains authoritative. Trellis does not automatically run checks or commit changes.

## Overview

- [Quick Start](/docs/overview/quick-start)
- [Features](/docs/overview/features)
- [Deploy on Render](/docs/overview/render)
- [Docker Deployment](/docs/overview/docker)
- [Third-party Prompt Sources](/docs/overview/third-party-prompt-repositories)

## Canvas Guide

- [Canvas Node Guide](/docs/canvas/canvas-node-manual)
- [Canvas Shortcuts](/docs/canvas/canvas-shortcuts)

## Development and Data

- [Local Development](/docs/development/local-development)
- [Canvas Data Structure](/docs/development/canvas-data-structure)
- [How the Local Codex Connection Works](/docs/development/local-codex-canvas)

## Business

- [Open-source License](/docs/business/license)
- [Business Cooperation](/docs/business/business)

## Support and Security

- [Report a Vulnerability](/docs/support/security)
- [Sponsor the Project](/docs/support/sponsor)

## Project Progress

- [Changelog](/docs/progress/changelog)
- [Pending Tests](/docs/progress/pending-test)
- [TODO](/docs/progress/todo)

## Notes

- The personal edition uses `server/` for single-administrator authentication, SQLite business records, and private media files. These changes still need manual acceptance; do not describe them as a hosted cloud-sync service.
- Signed-in browsers receive API keys from the application service and send AI requests directly to providers. Protect SQLite, environment files, and backups as secrets.
- The old static-only Vercel/Render setup does not supply the new application service or persistent disk. Docker durability, routes, plugins, and media responses remain pending verification.
