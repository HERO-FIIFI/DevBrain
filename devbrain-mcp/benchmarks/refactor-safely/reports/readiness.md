# `/refactor-safely` pilot readiness

**Decision:** `READY_FOR_EXECUTION_APPROVAL`  
**Branch:** `experiment/refactor-safely-pilot`  
**Task 9:** `BLOCKED_PENDING_EXPLICIT_APPROVAL`

Tasks 1–8 are implemented. No model discovery, live Codex Skill forward-test, CONTROL run, or DEVBrain run was executed during readiness work.

## Acceptance evidence

| Gate | Result |
|---|---:|
| Benchmark tests | PASS — 16 files / 133 tests |
| Complete regression | PASS — 43 files / 254 tests |
| ESLint | PASS |
| TypeScript build | PASS |
| Deterministic fixture validation | PASS — Tasks A/B/C each reproduced identical Git/content hashes |
| Artifact and metric invariants | PASS |
| CONTROL/treatment isolation tests | PASS |
| Hidden-evaluator canary isolation | PASS |
| Pilot matrix/stop control | PASS |

Task A materializes as Git SHA `76f12443b576d898552e8eac9d56750fd3c43e80` and canonical content SHA-256 `62ce3c3bf75273dfed033f8bc624ffc7c8403da7678817a9e00aa8163919792b` in both copies. Task B and C preparation hashes are recorded in `readiness.json`; neither task was executed by an agent.

## Frozen Phase 4 boundary

- `master`: `d2f92462a650123304d3d7c0f1c8c5acc6e4a249`
- `v0.4.0-phase4^{commit}`: `d2f92462a650123304d3d7c0f1c8c5acc6e4a249`
- Diff from the tag under `src/` and `evals.xml`: empty
- Registered MCP tools: 26
- Existing evaluations: 20

## Acceptance remediation

Fresh full-suite testing exposed a Windows timeout path where `taskkill` could launch but fail, leaving the child process alive. Commit `7f4c1f6` keeps tree termination as the preferred path and adds a bounded direct-child fallback. The focused timeout regression passes in 1.647 seconds, followed by the passing benchmark and complete suites above.

## Explicit unknowns and pending live gates

- Resolved model: `null` — model discovery and the live resolution probe were not authorized at this gate. Before either measured run, requested and resolved identifiers must both be exactly `gpt-5.6-sol`, with no fallback.
- Live Skill forward-tests: `null` — deterministic validation covers eight scenarios, but fresh live sessions remain a pre-pilot requirement.
- Subprocess filesystem reads: `null` where unobservable; they are never converted to zero or mixed into agent-visible exposure.

The bundled Skill validator passed during Task 6. A fresh local invocation could not import PyYAML in the installed Python; no dependency was installed and the already-passing deterministic Skill tests were used for this readiness rerun.

## Next gate

Task 9 requires a separate, explicit pilot execution approval. After that approval, the harness must run the live Skill forward-tests and exact-model preflight, then exactly one Task A CONTROL condition and one Task A DEVBrain condition. It must stop after producing the comparison report. Tasks B/C, extra repetitions, pushing, and Phase 5 remain prohibited.
