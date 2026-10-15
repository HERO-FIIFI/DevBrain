# DevBrain Phase 5 Distribution and Environment Hardening Implementation Plan

**Implementation status:** Complete on 2026-10-15; final acceptance gates passed. The checkboxes below preserve the originally approved TDD execution sequence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe setup, diagnosis, repair, and uninstall lifecycle commands without changing the frozen Phase 1?4 MCP surface.

**Architecture:** A dependency-free lifecycle subsystem discovers and validates paths/configuration, proves Git and MCP state, plans lossless section-scoped edits, and applies them through backup/atomic-write/rollback transactions. `src/admin.ts` delegates lifecycle arguments while `src/index.ts` and all MCP contracts remain unchanged.

**Tech Stack:** TypeScript, Node.js standard library, existing MCP SDK, Vitest, existing ESLint/TypeScript configuration.

**Spec:** `docs/superpowers/specs/2026-10-07-devbrain-phase5-distribution-hardening-design.md`

## Global Constraints

- Base is `v0.4.0-phase4` / `d2f92462a650123304d3d7c0f1c8c5acc6e4a249`.
- Preserve 26 MCP tools, 20 evaluations, `src/index.ts`, and existing behavior.
- Add no Phase 5 MCP tools and no product dependency.
- Never execute arbitrary configuration commands; probes are verified Node plus verified server only and use `shell: false`.
- Doctor is read-only unless `--repair` is explicit and authorized.
- `required = true` is impossible to install without successful launch and MCP initialization preflight.
- Preserve unrelated TOML byte-for-byte and redact sensitive environment values.
- Do not push, tag, release, or mutate Codex/VS Code databases.

## Review Focus

- Windows drive/slash inputs must normalize without becoming valid merely through lexical cleanup; Task 1 owns these tests.
- Parent workspace versus nested Git root must remain a warning/policy decision, while nonexistent configured roots remain failures; Tasks 2 and 5 own these tests.
- Unknown TOML and unrelated sections must survive exact section edits; Task 3 owns byte-preservation tests.
- A probe timeout/failed initialization must clean the process and block `required = true`; Task 4 owns these tests.
- Any write/validation failure must retain or restore the original bytes; Task 6 owns injected-failure tests.

---

### Task 1: Check model and path safety

**Files:** Create `src/lifecycle/model.ts`, `src/lifecycle/paths.ts`; test `tests/lifecycle/paths.test.ts`.

**Interfaces:** Produce stable `CheckId`, `LifecycleCheck`, `check()`, `normalizeInputPath()`, `inspectDirectory()`, and `sameCanonicalPath()`.

- [ ] Write failing tests for all status fields, Windows spaces/slashes/mixed slashes/drive case, relative `.`/`..`, missing/file/inaccessible inputs, `.git`, Unicode, duplicate-segment detection, and realpath symlink/junction behavior where supported.
- [ ] Run `npm test -- tests/lifecycle/paths.test.ts` and verify RED.
- [ ] Implement only the tested model and filesystem-backed canonicalization; duplicate segments are evidence, never repair.
- [ ] Re-run targeted tests, then `npm test`; commit `phase5: add path safety and diagnostic model`.

### Task 2: Git root and bounded configuration discovery

**Files:** Create `src/lifecycle/git-root.ts`, `src/lifecycle/discovery.ts`; test `tests/lifecycle/discovery.test.ts`.

**Interfaces:** Produce `discoverGitRoot()`, `compareWorkspaceAndRepository()`, and `discoverConfigFiles()` for global/workspace/repository/applicable-parent scopes.

- [ ] Write failing temporary-Git tests for exact root discovery, outer-workspace/nested-root warning, non-Git failure, bounded ancestor discovery, duplicate definitions, and no unrelated filesystem scanning.
- [ ] Verify RED, implement with literal Git argument arrays, then verify GREEN and full regression.
- [ ] Commit `phase5: discover git roots and codex configuration`.

### Task 3: Conservative TOML parser and section editor

**Files:** Create `src/lifecycle/toml.ts`, `src/lifecycle/config.ts`; test `tests/lifecycle/config.test.ts`.

**Interfaces:** Produce `parseCodexConfig()`, `readDevbrainDefinition()`, `renderDevbrainDefinition()`, `replaceDevbrainSections()`, `removeDevbrainSections()`, and `analyzeConfigCollisions()`.

- [ ] Write failing tests for malformed TOML, supported values, unknown fields, duplicate relevant sections, multiple/conflicting scopes, missing paths, redacted env reporting, preservation of unrelated MCP/settings/comments, and uninstall section removal.
- [ ] Verify RED; implement a conservative line/range parser and lossless owned-section splice.
- [ ] Verify candidate reparse and DB008?DB010 semantics, run regression, commit `phase5: add conservative config inspection and editing`.

### Task 4: Safe launch and MCP initialization preflight

**Files:** Create `src/lifecycle/probe.ts`; create `tests/lifecycle/fixtures/mcp-server.mjs`, `tests/lifecycle/fixtures/child-marker.mjs`; test `tests/lifecycle/probe.test.ts`.

**Interfaces:** Produce `probeNodeRuntime()`, `probeLaunch()`, and `probeMcp()` returning typed failure reasons and sanitized output.

- [ ] Write failing tests for runtime missing, server missing, invalid cwd, launch success/failure/timeout, MCP initialize/list success/failure, output bounds/redaction, shell-injection literals, and no orphan marker after timeout.
- [ ] Verify RED; implement allowlisted Node spawning and SDK stdio handshake with timeout cleanup.
- [ ] Verify GREEN and regression; commit `phase5: add bounded launch and mcp preflight`.

### Task 5: Doctor and invariant evaluation

**Files:** Create `src/lifecycle/diagnostics.ts`, `src/lifecycle/format.ts`; test `tests/lifecycle/doctor.test.ts`.

**Interfaces:** Produce `runDoctor()`, `deriveDoctorResult()`, `doctorExitCode()`, `formatHumanReport()`, and `formatJsonReport()` covering DB001?DB011.

- [ ] Write failing tests for every invariant, healthy/warning/failure/internal outcomes, read-only default, stable JSON schema, human remediation, sensitive env redaction, exact duplicated `Documents/Documents` rejection, and nested Git-root explanation.
- [ ] Verify RED; implement pure evaluation plus injected discovery/probe dependencies.
- [ ] Prove doctor leaves all config hashes/timestamps unchanged, run regression, commit `phase5: add read-only environment doctor`.

### Task 6: Transactional configuration writer

**Files:** Create `src/lifecycle/transaction.ts`; test `tests/lifecycle/transaction.test.ts`.

**Interfaces:** Produce `planConfigTransaction()` and `applyConfigTransaction()` with backup, atomic temp/fsync/rename, reread validation, and rollback result evidence.

- [ ] Write failing tests for backup creation, same-directory temp, atomic success, new-file setup, injected write/rename/validation/postcheck failures, exact original preservation, rollback, dry-run, and symlink target refusal.
- [ ] Verify RED; implement minimal transaction with injectable fault hooks.
- [ ] Verify GREEN and regression; commit `phase5: add transactional config mutation`.

### Task 7: Setup, repair, and uninstall services

**Files:** Create `src/lifecycle/service.ts`; test `tests/lifecycle/service.test.ts`.

**Interfaces:** Produce `planSetup()`, `executeSetup()`, `planRepair()`, `executeRepair()`, `planUninstall()`, and `executeUninstall()`.

- [ ] Write failing tests for plan-before-write, authorization, dry-run, existing definition comparison, DB011 preflight gate, successful required install, failed setup preservation, deterministic paired cwd/env repair, ambiguous repair refusal, repair rollback, and DevBrain-only uninstall.
- [ ] Include the exact incident fixture and prove it is rejected before activation, then safely repaired only from independently verified Git evidence.
- [ ] Verify RED; implement orchestration over Tasks 1?6; verify GREEN and full regression.
- [ ] Commit `phase5: add safe lifecycle services`.

### Task 8: CLI integration

**Files:** Create `src/lifecycle/cli.ts`; modify `src/admin.ts`; modify `tests/execution/admin-cli.test.ts`; create `tests/lifecycle/cli.test.ts`.

**Interfaces:** `runLifecycleCli(args, io)` returns exit code 0/1/2/3 and supports setup, doctor, doctor --repair, uninstall plus `--workspace`, `--config`, `--server`, `--dry-run`, `--json`, `--yes`.

- [ ] Write failing parsing/output/confirmation tests and existing-admin regression tests.
- [ ] Verify RED; route only lifecycle commands from `admin.ts`, preserving existing commands and usage.
- [ ] Verify GREEN, build, and full regression; commit `phase5: expose lifecycle administration commands`.

### Task 9: Mandatory regression matrix and acceptance scenario

**Files:** Create `tests/lifecycle/phase5-regressions.test.ts`; create `tests/lifecycle/acceptance.test.ts`.

**Interfaces:** End-to-end temporary fixtures cover all 30 numbered mandatory regressions and final doctor/repair scenario.

- [ ] Map each numbered requirement to a named test and identify any behavior not already covered.
- [ ] Add missing tests RED-first; implement only demonstrated gaps in the owning module.
- [ ] Run `npm test -- tests/lifecycle`, then full `npm test`; require 30/30 mapped regressions.
- [ ] Commit `test: lock phase5 environment hardening regressions`.

### Task 10: Documentation and final acceptance

**Files:** Modify `README.md`, `VERIFICATION.md`; create `docs/phase5-lifecycle.md`.

**Interfaces:** Document commands, normal install, healthy output, common failures, precedence, Windows behavior, backups/rollback, exit codes, recovery, security boundaries, and the no-database-forensics guarantee.

- [ ] Write docs and usage examples from actual CLI output; do not claim unavailable behavior.
- [ ] Run fresh `npm test`, `npm run lint`, and `npm run build`.
- [ ] Verify `tests/server.test.ts` still reports 26 tools, `tests/evals.test.ts` still reports 20 evaluations, and `git diff v0.4.0-phase4 -- src/index.ts evals.xml` is empty.
- [ ] Demonstrate exact incident rejection, nested-root warning, transaction backup/repair/rollback, redaction, and uninstall preservation through tests.
- [ ] Record exact evidence and residual risks in `VERIFICATION.md`; commit `phase5: document distribution hardening acceptance`.
- [ ] Stop with Git status, commits, acceptance matrix, and READY/NOT READY recommendation. Do not push, tag, or release.
