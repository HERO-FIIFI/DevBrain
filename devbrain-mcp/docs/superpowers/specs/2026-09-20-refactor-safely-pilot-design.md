# DevBrain `/refactor-safely` Pilot Design

**Status:** Approved and frozen on 2026-09-20

**Baseline:** `d2f92462a650123304d3d7c0f1c8c5acc6e4a249` (`v0.4.0-phase4`)

## Purpose

Build the first DevBrain orchestration skill and run a controlled two-run pilot that can answer four questions independently:

1. Does DevBrain reduce repository source exposed to a coding agent?
2. Does DevBrain improve patch correctness or reduce regressions?
3. Does the treatment agent substitute DevBrain retrieval for broad reads, or add DevBrain context and reread the same material?
4. What measurable latency and tool-call overhead does governance introduce?

The experiment may produce a positive, negative, mixed, or inconclusive result. It must not collapse these questions into one DevBrain score.

## Frozen boundaries

- Work occurs on `experiment/refactor-safely-pilot`.
- `master`, `v0.4.0-phase4`, the 26 MCP tools, and existing MCP behavior remain unchanged.
- No Phase 5 MCP tools are added.
- The pilot runs Task A once under CONTROL and once under DEVBrain. Tasks B and C are prepared but not executed.
- The full benchmark and additional repetitions remain blocked until explicit review approval.
- Both measured agents use the exact model identifier `gpt-5.6-sol`; there is no fallback.
- A model-discovery command is an implementation detail. The invariant is reliable evidence that the requested and resolved model is exactly `gpt-5.6-sol`, or the pilot stops before either measured run.

## `/refactor-safely` skill

The skill is an orchestration and judgment layer over existing DevBrain tools, not a reimplementation. Its required workflow is:

```text
request -> repository state -> target resolution -> pre-change impact
        -> bounded context -> confidence/truncation assessment -> bounded plan
        -> implementation -> diff inspection -> post-change impact
        -> targeted verification -> diagnosis/targeted expansion when needed
        -> full verification -> evidence-backed conclusion
```

The skill prefers DevBrain retrieval and bounded slices before broad repository reads. A sufficient Context Pack replaces unnecessary rereading. Context expands only for a recorded reason such as truncation, ambiguity, low confidence, unresolved imports, missing impact paths, a new test failure, or exclusion of a directly relevant candidate.

Each expansion records its reason, triggering evidence, files, lines, and bytes. Low-confidence, inferred, potential, or truncated evidence may justify targeted expansion but never unrestricted exploration.

Before editing, the skill records direct and relevant transitive dependents, routes/interfaces, persistence relationships, tests, confidence, and truncation. After editing, it compares the Git diff and post-change impact against expected scope, searches for missed old references, and identifies unexpected files or paths. It then performs targeted verification, diagnosis and bounded correction when needed, followed by applicable lint, build, and full regression checks.

Its completion result separates patch state from agent verification behavior and reports changed files, summary, pre/post impact, execution evidence, expansions, unresolved risks, and final status. Potential impact is never described as guaranteed breakage.

## Conditions

The harness derives both invocations from one shared runtime configuration. The commands must match after removing only the intended treatment differences.

### CONTROL

- Identical visible task and fixture.
- Normal coding-agent repository tools.
- No DevBrain MCP server, DevBrain tool, Context Pack, impact list, selection reason, or skill instructions.
- Local Codex configuration ignored so unrelated MCP servers and skills cannot leak in.
- Any DevBrain tool event makes the run a `HARNESS_ERROR`.

### DEVBrain

- Identical visible task and fixture.
- Explicit DevBrain MCP configuration only.
- Explicit `/refactor-safely` skill path.
- Normal repository tools remain available so substitution versus accumulation can be measured rather than forced.
- Existing Phase 2 execution approvals are prepared deterministically for the fixture where required; approval behavior is not bypassed by modifying MCP code.

Both conditions use `codex exec --ephemeral --json`, `gpt-5.6-sol`, workspace-write sandboxing, approval policy `never`, disabled web search, identical environment allowlists and time limits, and fresh sessions.

## Run data flow

1. Verify the frozen baseline commit/tag and clean source tree.
2. Materialize the task fixture in a randomized temporary directory.
3. Initialize its Git repository with fixed identity and timestamps.
4. Record its baseline Git SHA and a canonical SHA-256 over sorted paths and file bytes.
5. Require both conditions to have identical Git and content hashes; mismatch invalidates both as `HARNESS_ERROR`.
6. Resolve and verify the pinned model. Failure stops before measured runs.
7. Launch one fresh agent session with the condition-specific delta.
8. Stream raw JSONL and stderr to exclusive-write artifacts.
9. Snapshot the resulting repository, Git diff, and content hash.
10. Run harness-owned visible verification.
11. Run the hidden evaluator outside the agent workspace.
12. Derive provenance-linked metrics and the comparison report.

No benchmark run uses a DevBrain Git worktree, modifies `master`, pushes a branch, resumes another session, or receives another run's context.

## Isolation

The agent working root contains only the materialized task repository. Hidden evaluators remain in the benchmark source tree outside that root, their paths are absent from prompts, and they execute afterward in a separate process. A canary plus raw-event audit checks for evaluator access. Detected access is a harness failure, not an agent failure.

CONTROL ignores all user configuration and receives no treatment path. DEVBrain also ignores user configuration and receives only the explicit experimental MCP and skill configuration. Raw invocation artifacts prove the shared settings and the condition delta.

## Immutable artifacts and metric provenance

Each run stores write-once raw evidence:

```text
raw/codex-events.jsonl
raw/codex-stderr.log
raw/invocation.json
raw/environment.json
raw/repository-before.json
raw/repository-after.json
raw/visible-verification.json
raw/hidden-evaluation.json
raw/artifact-hashes.json
derived/run-record.json
derived/metric-provenance.json
```

Raw artifacts are exclusively created, flushed, SHA-256 hashed, and made read-only. Derived records name the raw hash, event IDs or line numbers, parser version, and derivation rule. Parser revisions produce new derived artifacts rather than rewriting raw evidence.

Measurements use `exact`, `reported`, `partial`, or `unknown` confidence. Unknown values are `null` with a reason and are never converted to zero. Actual token consumption is recorded only when directly reported by the host.

## Exposure accounting

Three read domains are never mixed:

1. Agent-visible exposure: the primary context-efficiency domain.
2. Deterministic-tool scanning: infrastructure/computational overhead.
3. Evaluator reads: scoring overhead, excluded from the agent comparison.

Agent-visible payload is divided into:

- repository source exposure;
- DevBrain metadata exposure;
- verification output exposure;
- task instruction exposure;
- skill instruction exposure;
- other tool output exposure.

Both repository-source exposure and total measurable agent-visible payload are reported.

Repository source records gross bytes/lines, unique bytes/lines, duplicate bytes, and duplication ratio. Unique exposure deduplicates normalized file intervals rather than filenames. Overlapping ranges contribute only their uncovered interval to unique exposure. Rereading a Context Pack range increases gross exposure while its overlap remains deduplicated, exposing additive behavior.

Context Pack source slices and metadata/selection reasons are measured separately. Recognized command/MCP events receive exact attribution. Unattributable source output keeps exact aggregate output bytes while file/range values become partial or unknown.

Harness content scans are exact. DevBrain repository/analyzed/candidate/selected counters are reported values. DevBrain's underlying filesystem bytes read remain unknown unless existing output exposes them. Git, compiler, test-runner, and other subprocess-internal reads are also unknown rather than estimated.

Evaluator explicit reads use an instrumented API. Its subprocess-internal reads remain unknown and separate.

## Agent behavior and discipline

The event parser records total calls, process calls, reads, searches, DevBrain calls, test/lint/build calls, normalized repeated searches, repeated file/range reads, verification failures, and context expansions.

Patch correctness and agent verification discipline remain distinct. A correct patch that the agent did not fully verify is still technically correct, while the skill completion contract may fail. The run record separately reports harness-observed patch verification and whether the agent ran targeted tests, lint, build, and full regression.

## Benchmark tasks

All fixtures are dependency-free Node.js ESM repositories using `node:test` and standard-library lint/build scripts.

### Task A: low blast radius (executed in pilot)

Visible request:

> Rename `AuthService.validateToken()` to `AuthService.verifyToken()` throughout the repository without changing runtime behavior. Update necessary callers and tests, avoid unrelated edits, and run appropriate verification.

The fixture contains the definition, three production callers (HTTP middleware, session restorer, and CLI inspector), two visible test files, and an unrelated similarly named `validateTokenFormat` function that must remain unchanged. The task is deliberately solvable by a competent CONTROL agent using a simple symbol search.

The fixture manifest defines `allowedChangedFiles` independently from `requiredChangedFiles`. Allowed files are the definition, three callers, and both visible tests. Required files are derived from which fixture files actually contain the scoped old method reference. An allowed file need not change; any file outside the allowlist is unrelated scope.

Hidden evaluation favors behavioral invariants: the new method and all callers work, valid/invalid/expired/malformed behavior is unchanged, middleware/session/CLI behavior remains stable, the scoped old method is absent, `validateTokenFormat` is unchanged, harness-run verification passes, and the diff remains bounded.

### Task B: medium blast radius (prepared only)

Change a service contract from a positional identifier to a named request object across its public interface, implementation, HTTP route, CLI adapter, test doubles, and visible tests. Hidden checks focus on cross-component completeness and stable route/CLI behavior rather than implementation shape.

### Task C: high blast radius (prepared only)

Rename an internal persistence field across SQL declaration, row mapper/repository, service, API serializer, and tests while preserving the external API field. Hidden checks establish mapping/storage behavior, public API stability, removal of the old internal name where required, regression results, and bounded scope without prescribing a specific internal structure.

## Hidden evaluation and outcome classification

Evaluators receive the completed repository and immutable run metadata, never modify the repository, and emit deterministic checks with identifiers, status, evidence, and criticality.

Patch dimensions are transformation correctness, behavioral correctness, and scope discipline. Agent discipline is reported separately. A per-run task checklist score may summarize completion but is never combined with context or latency into one score.

- `HARNESS_ERROR`: model, isolation, fixture identity, telemetry, evaluator, or infrastructure failure.
- `SUCCESS`: required transformation, behavior, harness verification, hidden checks, and scope checks pass.
- `PARTIAL`: a noncritical completeness or scope check fails while required behavior and full regression remain valid.
- `FAILURE`: required transformation is incomplete, behavior changes, hidden behavioral checks fail, or full regression fails.

## Testing and gates

The implementation follows test-driven development. Synthetic JSONL fixtures exercise event parsing, interval overlap, Context Pack double counting, unknown propagation, condition-delta validation, and model-gate failures. Fixture/evaluator tests prove deterministic SHAs, behavioral checks, allowlist/required-list semantics, evaluator isolation, and outcome classification.

The skill is validated against straightforward, ambiguous, truncated, low-confidence, targeted-failure, unexpected-impact, unrelated-diff, and full-regression-failure scenarios. Behavioral forward-testing is used where prose inspection cannot prove decision quality.

Before either pilot run:

- all new harness tests pass;
- all 27 existing DevBrain test files / 121 tests pass;
- existing lint and build pass;
- the 26-tool and 20-evaluation baseline remains unchanged;
- model resolution succeeds exactly;
- Task A fixture identity and hidden-evaluator isolation checks pass.

After one CONTROL and one DEVBrain run, the harness produces individual records and a comparison reporting repository exposure, total payload, correctness, verification discipline, tool behavior, duration, Context Pack governance, substitution versus accumulation, limitations, issues, and a recommendation of `PROCEED`, `REMEDIATE`, or `BLOCKED`. Execution then stops.
