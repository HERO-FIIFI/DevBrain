# DevBrain `/refactor-safely` pilot

This directory contains the frozen CONTROL-versus-DEVBrain benchmark harness. It preserves the Phase 4 MCP implementation and keeps correctness, verification discipline, context exposure, scanning overhead, evaluator reads, and latency as separate results.

## Current gate

Pilot execution is **not authorized**. The `preflight-model`, `run`, and `pilot` commands require an explicit JSON approval file containing both `"statement": "PILOT_EXECUTION_APPROVED"` and a non-empty `"approvedBy"`. Do not create that record without a separate user approval after the readiness review.

Tasks 1–8 passed the offline gate; see [`reports/readiness.md`](reports/readiness.md). Its decision is `READY_FOR_EXECUTION_APPROVAL`, not authorization to execute Task 9.

Tasks B and C are fixture/evaluator preparations only. The executable matrix is fixed to one Task A CONTROL run followed by one Task A DEVBrain run. The harness rejects other tasks, repetitions, or matrices.

## Offline validation

These commands do not launch Codex or discover models:

```powershell
npm run benchmark:refactor-safely:test
npm run benchmark:refactor-safely:validate
```

`validate` materializes Tasks A, B, and C twice and compares their Git SHA, canonical content hash, and sorted file list.

## Approval-gated commands

After separate pilot authorization, provide its reviewed record explicitly:

```powershell
npm run benchmark:refactor-safely:preflight -- --approval <approval.json> --output benchmarks/refactor-safely/reports
npm run benchmark:refactor-safely:pilot -- --approval <approval.json> --runs-root benchmarks/refactor-safely/runs
```

Preflight must prove that both the requested and resolved identifiers are exactly `gpt-5.6-sol`; it never falls back. A missing, aliased, or conflicting identifier produces `BLOCKED` before either measured run.

### Codex CLI compatibility

Compatibility is capability-based, not version-allowlisted. The harness accepts Codex CLI releases whose `exec` surface provides the required model, JSONL, ephemeral-session, and sandbox controls and whose diagnostics can prove the isolated config, exact `never` approval policy, restricted network, CONTROL treatment absence, and DEVBrain-only treatment. Known legacy, current, and forward-shaped diagnostic records are normalized before parity checks.

A CLI version that cannot prove any invariant is reported as `BLOCKED`. The harness does not replace missing controls with weaker flags or infer the actual session model from configuration, catalog membership, or command success.

To derive a report from completed immutable records:

```powershell
npm run benchmark:refactor-safely:report -- --approval <approval.json> --control-record <control-run-record.json> --devbrain-record <devbrain-run-record.json>
```

Raw artifacts use exclusive creation and hashes. Derived metrics cite raw hashes and parser/event provenance. `unknown` is always represented as `null` plus a reason and is never treated as zero.

## Stop control

The pilot ends after the two Task A conditions and their comparison report. It does not execute Tasks B/C, add repetitions, push changes, or begin Phase 5.
