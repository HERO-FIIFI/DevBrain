# DevBrain Phase 5 Distribution and Environment Hardening Design

**Status:** Implementation-authorized on 2026-10-07

**Frozen baseline:** `v0.4.0-phase4` / `d2f92462a650123304d3d7c0f1c8c5acc6e4a249`

## Purpose

Phase 5 makes a supported DevBrain installation self-diagnosing and safely repairable. A user must be able to set up, inspect, repair, or remove DevBrain configuration without manually editing TOML or inspecting Codex databases, WAL files, editor state, or session storage. The motivating failure is a required MCP definition whose `cwd` contained a duplicated `Documents` segment and prevented Codex from starting.

Phase 5 is additive. It does not add MCP tools, modify the 26 Phase 1?4 tool contracts, change the 20 evaluations, or alter repository intelligence and execution behavior.

## Command surface

The existing `devbrain` admin executable gains four lifecycle commands:

```text
devbrain setup [--workspace PATH] [--config PATH] [--server PATH] [--dry-run] [--json] [--yes]
devbrain doctor [--workspace PATH] [--config PATH] [--server PATH] [--json]
devbrain doctor --repair [--workspace PATH] [--config PATH] [--server PATH] [--dry-run] [--json] [--yes]
devbrain uninstall [--config PATH] [--dry-run] [--json] [--yes]
```

Exit codes are stable: `0` healthy/success, `1` warnings only, `2` validation or refused-operation failure, and `3` internal lifecycle failure. Existing trust and approval commands retain their current behavior.

Interactive mutation shows the current/proposed values, reason, target file, and backup location. `--yes` is the explicit non-interactive authorization. `--dry-run` never writes. JSON output uses the same check IDs and redacts environment values.

## Architecture

The subsystem lives under `src/lifecycle/` and is split into focused layers:

- `model.ts`: stable check IDs DB001?DB011, statuses, reports, plans, and exit-state derivation.
- `paths.ts`: lexical normalization plus filesystem-backed canonicalization and directory validation. Windows syntax is handled explicitly even when tests run on another host. Existing paths resolve through `realpath`; nonexistent paths remain failures.
- `git-root.ts`: Git-backed root discovery using `git rev-parse --show-toplevel`, with selected-workspace versus repository diagnostics.
- `toml.ts`: conservative parsing of supported Codex values and exact section ranges. Unknown keys and sections are retained; malformed or duplicate relevant sections are rejected.
- `config.ts`: bounded discovery of user, selected-workspace, repository, and applicable parent `.codex/config.toml` files; precedence/collision analysis; lossless replacement/removal of only the DevBrain sections.
- `probe.ts`: allowlisted Node-only launch and MCP initialization probes using argument arrays, bounded timeouts, captured/redacted diagnostics, and deterministic process cleanup.
- `transaction.ts`: same-directory temporary files, fsync, backup, atomic rename, reread validation, and rollback.
- `diagnostics.ts`: pure check evaluation and report composition.
- `service.ts`: setup, doctor, repair, and uninstall orchestration.
- `format.ts`: human and JSON rendering with secret redaction.
- `cli.ts`: argument parsing, confirmation, and exit-code mapping for `src/admin.ts`.

Dependencies remain Node standard library plus the already installed MCP SDK. No CLI or TOML dependency is added.

## Path and repository policy

Input paths are untrusted. The path layer accepts spaces, Unicode, relative paths, forward/back/mixed separators, `.` and `..`, and drive-letter variants. It reports normalized lexical paths separately from canonical filesystem paths. A directory expectation fails for a missing, inaccessible, or file path. Existing symlink/junction targets resolve through `realpath`; the tool does not blindly traverse or rewrite targets.

Duplicate segments are diagnostic evidence only. They never cause string-replacement repair. A repair path is eligible only when Git independently resolves a repository root from the selected workspace or an explicit verified candidate. The configured `cwd`, `DEVBRAIN_WORKSPACE_ROOT`, selected workspace, and detected Git root are compared canonically.

A parent workspace containing a nested repository produces a warning and a verified repository recommendation, not an assumption that the parent is invalid. Multi-root intent can therefore remain explicit rather than being silently overwritten.

## Configuration discovery and editing

Discovery is bounded to supported locations: user/global Codex config, the selected workspace, the detected repository, and `.codex/config.toml` files on the ancestor chain relevant to those roots. It never scans unrelated filesystem trees.

Every `[mcp_servers.devbrain]` definition is reported with scope, source file, command, args, cwd, required state, workspace environment root, applicability, and path health. Multiple applicable definitions are classified as duplicate, conflicting, stale, or ambiguous according to canonical values and precedence.

The editor owns only these exact sections:

```toml
[mcp_servers.devbrain]
[mcp_servers.devbrain.env]
```

Setup/repair replaces those ranges only. Uninstall removes those ranges only. All other bytes?including comments, unknown fields, unrelated MCP servers, trust settings, and ordering?remain unchanged. Unsupported fields inside the owned sections are reported and preserved unless the user explicitly authorizes replacing that DevBrain definition.

## Stable checks and invariants

- **DB001** ? configured DevBrain server exists and is a file.
- **DB002** ? configured `cwd` exists and is a directory.
- **DB003** ? `DEVBRAIN_WORKSPACE_ROOT` exists and is a directory.
- **DB004** ? `cwd` and environment workspace resolve to the same intended root.
- **DB005** ? configured workspace matches the selected workspace/repository policy; parent/nested differences are explicit.
- **DB006** ? Node runtime resolves and can execute.
- **DB007** ? DevBrain launches from the verified repository root and completes MCP initialization.
- **DB008** ? no unresolved applicable DevBrain configuration conflict takes precedence.
- **DB009** ? candidate TOML is syntactically supported and reparses to the intended definition.
- **DB010** ? unrelated configuration is byte-preserved by the proposed edit.
- **DB011** ? a newly installed `required = true` definition is prohibited unless all critical preflight checks pass.

Checks return `PASS`, `WARN`, or `FAIL` with title, detected value, expected value when applicable, explanation, remediation, and `repairable`. Unknown or inaccessible state is never treated as pass.

## Probe safety

Diagnosis never executes a command copied blindly from configuration. The lifecycle probe supports only the verified Node runtime and a verified server file selected by setup options or the installed DevBrain package. It uses `spawn` semantics with `shell: false`, literal argument arrays, a bounded timeout, output limits, hidden windows, and process-tree termination.

The primary preflight is an MCP SDK stdio connection and initialization, followed by `tools/list`; success proves the actual server completed protocol initialization. Launch errors distinguish runtime missing, server missing, invalid cwd, early exit, timeout, and MCP failure. Captured output passes through redaction before reporting.

## Transactions

Mutations follow one transaction:

```text
inspect ? verified proposal ? candidate parse ? preflight ? backup
        ? same-directory temp write/fsync ? atomic rename ? reread/validate
        ? doctor recheck ? commit or rollback
```

Backups use a timestamped sibling name and are never overwritten. A validation or post-write critical-check failure restores the exact original bytes through the same atomic mechanism. A new file is removed on rollback. Temporary files are cleaned best-effort. Setup and repair cannot activate `required = true` before preflight succeeds.

## Lifecycle behavior

`doctor` is read-only, including default execution. It discovers, parses, validates, probes only verified Node/server inputs, and emits checks plus a result of `READY`, `READY_WITH_WARNINGS`, or `NOT_READY`.

`setup` resolves the selected directory through Git, chooses the repository-local `.codex/config.toml` unless `--config` explicitly selects a supported target, resolves the built server and Node executable, runs preflight, constructs a candidate, shows the plan, obtains authorization, transacts, and verifies.

`doctor --repair` repairs only deterministic mismatches. The duplicated-segment incident is repairable only because the malformed configured directory fails and the selected workspace independently yields a verified nested Git root. Both `cwd` and `DEVBRAIN_WORKSPACE_ROOT` move together.

`uninstall` removes only the two owned DevBrain sections from the selected config, backs up first, and preserves DevBrain data, other MCP definitions, and unrelated settings.

## Testing and acceptance

Tests use temporary repositories/configurations and injected process/transaction boundaries. They cover all thirty mandatory regressions, including the exact `C:\Users\Administrator\Documents\Documents\Automations 2026\IA PROJECTS\Aura-main` value without relying on that host path. Probe integration uses controlled Node MCP fixtures and asserts timeout cleanup. Transaction fault injection proves original-byte preservation and rollback.

Acceptance requires the full Phase 1?4 suite, new Phase 5 suite, lint, build, unchanged 26-tool server contract, unchanged 20 evaluations, unchanged `src/index.ts` and `evals.xml`, and demonstrations of invalid-path rejection, nested Git-root detection, conservative repair, rollback, redaction, and uninstall preservation.

## Residual boundaries

- The parser intentionally supports the Codex TOML constructs needed to locate and safely edit MCP sections; unsupported syntax yields a diagnostic instead of speculative mutation.
- Configuration precedence can evolve across Codex versions. Phase 5 reports all supported discovered definitions and refuses ambiguous repair rather than assuming undocumented precedence.
- Probe success is point-in-time evidence for the chosen Node/server/root, not a guarantee that a future IDE process will have identical permissions or environment.
- Symlink and junction safety relies on Node/Git canonicalization and host filesystem permissions.

