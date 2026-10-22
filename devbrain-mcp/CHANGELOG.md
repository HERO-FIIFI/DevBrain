# Changelog

## 0.7.1

- Added explicit, transactional `setup --upgrade` for an existing project DevBrain definition. Setup now reports `UPGRADE_REQUIRED` instead of silently replacing a user-managed definition.
- Added `setup --validate` to stage and probe a candidate runtime without changing the target configuration or promoting the runtime.
- Preserved staged-runtime probe diagnostics, including stable failure stages, sanitized reasons/details, and an available subprocess exit code.
- Kept setup rollback, unrelated MCP configuration, and all 26 MCP tool contracts intact.

## 0.7.0

- Added actionable staged-runtime installer diagnostics and Smart Doctor guidance.
- Added verification receipts, context-budget advice, and session handoff summaries using existing execution evidence.
- Added additive change-risk assessments to change-impact responses; scores are heuristic and token counts are estimates.
- Preserved the existing 26 MCP tool contracts and transactional setup rollback behavior.

## 0.6.0-rc.1

- Added npm package metadata and cross-platform `devbrain-mcp` setup executable.
- Added repository-scoped durable runtime installation with rollback and idempotency.
- Added clean tarball installation verification and machine-readable setup results.
- Updated the MCP SDK to 1.32.1; production dependency audit is clean.

This release candidate is prepared but not published. Publishing requires npm ownership/authentication and explicit release authorization.
