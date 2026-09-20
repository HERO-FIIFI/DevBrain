# DevBrain `/refactor-safely` Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/refactor-safely` orchestration skill and a reproducible CONTROL-versus-DEVBrain benchmark harness, then—only after a separate execution approval—run exactly the two Task A pilot conditions and stop with an evidence-backed comparison.

**Architecture:** Keep all benchmark and skill code outside the frozen MCP implementation. A dependency-free Node.js harness materializes deterministic fixtures, launches isolated ephemeral Codex sessions, persists immutable JSONL, normalizes events, derives interval-aware exposure metrics, runs external hidden evaluators, and produces separate correctness, discipline, context, scanning, evaluator, and latency results.

**Tech Stack:** Node.js standard library, JavaScript ESM, Vitest, existing TypeScript/ESLint toolchain, Codex CLI JSONL, existing DevBrain MCP build.

**Spec:** `docs/superpowers/specs/2026-09-20-refactor-safely-pilot-design.md`

## Global Constraints

- Work only on `experiment/refactor-safely-pilot`, based on `d2f92462a650123304d3d7c0f1c8c5acc6e4a249` / `v0.4.0-phase4`.
- Do not change files under `src/` merely to support the benchmark; a genuine blocking MCP defect stops work and is documented instead of patched.
- Preserve exactly 26 MCP tools, 20 existing evaluations, and all Phase 1–4 behavior.
- Add no production or development dependency.
- CONTROL and DEVBrain use exact model identifier `gpt-5.6-sol`; there is no fallback.
- A trustworthy requested/resolved model mismatch or absence of resolved-model evidence blocks both measured runs.
- CONTROL receives no DevBrain MCP, skill, Context Pack, impact evidence, or selection reason.
- DEVBrain receives only the explicit DevBrain MCP and `/refactor-safely` treatment additions; every other controllable setting is identical.
- Raw run artifacts are immutable and hash-addressed. Derived values always cite raw hashes, parser version, and event provenance.
- `unknown` is represented as `null` plus a reason and never converted to zero.
- Agent-visible exposure, deterministic scanning, and evaluator reads remain separate domains.
- Patch correctness, agent verification discipline, context efficiency, and latency remain separate results.
- Prepare Tasks A, B, and C. Execute only Task A CONTROL repetition 1 and Task A DEVBrain repetition 1 after the explicit pilot execution gate.
- Do not push, run Tasks B/C, add repetitions, or begin Phase 5.

## Review Focus

- Codex JSONL schema drift must produce explicit partial/unknown metrics or `HARNESS_ERROR`, never plausible fabricated counts; Task 3 owns this test.
- Overlapping Context Pack and manual slices must increase gross exposure while only uncovered line/byte intervals increase unique exposure; Task 3 owns this test.
- Hidden evaluator paths or treatment evidence appearing in CONTROL events must invalidate the run; Tasks 4 and 5 own these tests.
- Identically materialized conditions must have both the same Git SHA and canonical content hash, including on Windows path/line-ending behavior; Task 2 owns this test.
- A correct patch with incomplete agent-run verification must remain technically correct while separately failing skill discipline; Task 5 owns this test.

---

### Task 1: Benchmark records and immutable artifact store

**Files:**
- Create: `benchmarks/refactor-safely/harness/measurements.mjs`
- Create: `benchmarks/refactor-safely/harness/artifacts.mjs`
- Create: `benchmarks/refactor-safely/harness/run-record.mjs`
- Create: `tests/benchmark/measurements.test.ts`
- Create: `tests/benchmark/artifacts.test.ts`

**Interfaces:**
- Produces: `measurement({ value, unit, confidence, sources, unknownReason })`, `unknownMeasurement(unit, reason, sources)`, `ArtifactStore.createRaw(name, content)`, `ArtifactStore.createDerived(name, value, provenance)`, and `newRunRecord(identity)`.
- Consumes: only Node `crypto`, `fs/promises`, and `path`.

- [ ] **Step 1: Write failing measurement-invariant tests**

Add literal assertions that reject `confidence: 'unknown'` with a numeric value, reject non-unknown measurements with `null`, and preserve zero as a known value.

```ts
expect(() => measurement({ value: 0, unit: 'calls', confidence: 'exact', sources: [] })).not.toThrow();
expect(() => measurement({ value: 0, unit: 'bytes', confidence: 'unknown', sources: [], unknownReason: 'not observable' })).toThrow('UNKNOWN_VALUE_MUST_BE_NULL');
expect(unknownMeasurement('bytes', 'subprocess reads are not observable', [])).toMatchObject({ value: null, confidence: 'unknown' });
```

- [ ] **Step 2: Run the measurement test red**

Run: `npm test -- tests/benchmark/measurements.test.ts`

Expected: FAIL because the benchmark modules do not exist.

- [ ] **Step 3: Implement the minimal record constructors**

Use the confidence union `exact | reported | partial | unknown`. Make every run record carry `runId`, task/condition/repetition, agent model/configuration, baseline hashes, separated context domains, tools, changes, harness verification, agent behavior, patch result, timing, notes, and metric provenance.

- [ ] **Step 4: Write failing immutable-artifact behavior tests**

Create a temporary store, write one raw artifact, and assert a second write to the same name fails. Assert the SHA-256 sidecar matches literal bytes and a derived record names the raw hash and parser version.

```ts
await store.createRaw('codex-events.jsonl', '{"type":"thread.started"}\n');
await expect(store.createRaw('codex-events.jsonl', 'replacement')).rejects.toThrow('ARTIFACT_ALREADY_EXISTS');
expect(await store.verify('codex-events.jsonl')).toEqual({ valid: true, bytes: 26, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
```

- [ ] **Step 5: Run red, implement exclusive-write/fsync/hash/read-only behavior, and rerun green**

Run: `npm test -- tests/benchmark/artifacts.test.ts`

Expected before implementation: FAIL on missing store behavior. Expected after implementation: PASS. On Windows, read-only mode is evidence-in-depth; exclusive creation and hash verification are the platform-independent immutability controls.

- [ ] **Step 6: Run the complete suite and commit**

Run: `npm test`

Expected: existing 121 tests plus the new benchmark tests PASS.

Commit:

```text
feat: add immutable benchmark evidence records
```

---

### Task 2: Deterministic task fixtures and materialization

**Files:**
- Create: `benchmarks/refactor-safely/harness/fixtures.mjs`
- Create: `benchmarks/refactor-safely/tasks/task-a/manifest.json`
- Create: `benchmarks/refactor-safely/tasks/task-a/repository/**`
- Create: `benchmarks/refactor-safely/tasks/task-b/manifest.json`
- Create: `benchmarks/refactor-safely/tasks/task-b/repository/**`
- Create: `benchmarks/refactor-safely/tasks/task-c/manifest.json`
- Create: `benchmarks/refactor-safely/tasks/task-c/repository/**`
- Create: `tests/benchmark/fixtures.test.ts`

**Interfaces:**
- Produces: `loadTask(taskId)`, `materializeTask(task, destination)`, `canonicalRepositoryHash(root)`, and `{ repositorySha, contentSha256, files }` snapshots.
- Consumes: manifest fields `taskId`, `visiblePrompt`, `allowedChangedFiles`, `requiredChangedFiles`, `targetedCommand`, `lintCommand`, `buildCommand`, and `fullRegressionCommand`.

- [ ] **Step 1: Write the failing deterministic-materialization test**

Materialize Task A twice. Assert identical content hashes and Git SHAs, exact sorted paths, fixed clean status, and LF repository bytes independent of the host checkout.

```ts
expect(first.contentSha256).toBe(second.contentSha256);
expect(first.repositorySha).toBe(second.repositorySha);
expect(first.files).toEqual(second.files);
expect(first.status).toBe('clean');
```

Also mutate one copied byte and assert the content hash differs.

- [ ] **Step 2: Run the fixture test red**

Run: `npm test -- tests/benchmark/fixtures.test.ts`

Expected: FAIL because no task or materializer exists.

- [ ] **Step 3: Build Task A and the deterministic materializer**

Task A contains `AuthService.validateToken`, three production callers, two visible test files, and a separate `validateTokenFormat`. Use fixed Git author/committer identity and `2000-01-01T00:00:00Z` timestamps. Hash sorted POSIX paths plus a NUL delimiter plus exact bytes; exclude `.git`, generated output, and benchmark artifacts.

Make the manifest's allowlist literal:

```json
{
  "allowedChangedFiles": [
    "src/auth/auth-service.js",
    "src/http/auth-middleware.js",
    "src/session/session-restorer.js",
    "src/cli/inspect-token.js",
    "tests/visible/auth-service.test.js",
    "tests/visible/integration.test.js"
  ]
}
```

Set `requiredChangedFiles` only to files whose scoped reference must change. Do not derive either hidden scope contract from the resulting agent diff.

- [ ] **Step 4: Add behavior tests for the untouched Task A baseline**

Run the fixture's targeted test, lint, build, and full regression commands in a materialized repository. Assert `validateTokenFormat` behavior separately and record literal expected CLI/middleware/session outputs.

Run: `npm test -- tests/benchmark/fixtures.test.ts`

Expected: PASS.

- [ ] **Step 5: Prepare Tasks B and C without executing agents**

Task B implements a positional-to-request-object service contract across interface, implementation, route, CLI, doubles, and tests. Task C implements an internal persistence-field rename across SQL, mapper/repository, service, serializer, and tests while the public response stays unchanged. Add baseline behavior tests and materialization equality checks for both.

- [ ] **Step 6: Run the complete suite and commit**

Run: `npm test`

Expected: all fixture and prior tests PASS.

Commit:

```text
feat: add deterministic refactor benchmark tasks
```

---

### Task 3: JSONL normalization and exposure accounting

**Files:**
- Create: `benchmarks/refactor-safely/harness/events.mjs`
- Create: `benchmarks/refactor-safely/harness/exposure.mjs`
- Create: `benchmarks/refactor-safely/harness/derive.mjs`
- Create: `tests/benchmark/fixtures/control-events.jsonl`
- Create: `tests/benchmark/fixtures/devbrain-events.jsonl`
- Create: `tests/benchmark/events.test.ts`
- Create: `tests/benchmark/exposure.test.ts`
- Create: `tests/benchmark/derive.test.ts`

**Interfaces:**
- Produces: `normalizeEvent(raw, lineNumber)`, `classifyToolEvent(event)`, `ExposureLedger.add(exposure)`, `deriveRunMetrics(events, artifacts, parserVersion)`.
- Normalized exposure: `{ domain, category, file?, startLine?, endLine?, sourceBytes, metadataBytes, eventId, confidence }`.
- Categories: `repository_source`, `devbrain_metadata`, `verification_output`, `task_instruction`, `skill_instruction`, `other_tool_output`.

- [ ] **Step 1: Write failing event-normalization tests**

Use literal JSONL samples for thread/turn events, shell command execution, MCP tool calls, agent messages, usage, and an unknown future event. Assert unknown events are retained with `kind: 'unknown'` rather than dropped.

```ts
expect(normalizeEvent({ type: 'future.event', payload: 1 }, 9)).toMatchObject({ kind: 'unknown', lineNumber: 9, rawType: 'future.event' });
```

- [ ] **Step 2: Run the event test red, implement a tolerant normalizer, and rerun green**

Run: `npm test -- tests/benchmark/events.test.ts`

Expected: red before implementation, green afterward. Do not invent a tool classification for an unrecognized command.

- [ ] **Step 3: Write failing overlap/double-count tests**

Add a Context Pack exposure for `auth-service.js:20-80`, followed by a manual slice `auth-service.js:1-150`. Assert both contribute to gross exposure, lines 20-80 contribute only once to unique exposure, and duplicate bytes equal gross minus unique using hand-derived fixture bytes.

```ts
expect(summary.repositorySource).toMatchObject({
  grossLines: 212,
  uniqueLines: 150,
  duplicateLines: 62,
});
```

Also assert the Context Pack selection reason bytes enter `devbrain_metadata`, not repository source.

- [ ] **Step 4: Run overlap tests red and implement the per-file interval ledger**

Run: `npm test -- tests/benchmark/exposure.test.ts`

Expected: FAIL before `ExposureLedger`; PASS after it deduplicates normalized per-line intervals and keeps exact UTF-8 bytes for returned source lines. When exact byte attribution is impossible, emit partial/unknown instead of allocating bytes proportionally.

- [ ] **Step 5: Write failing domain-separation and unknown-propagation tests**

Assert total measurable payload is the sum of measurable agent-visible categories, while deterministic scans and evaluator reads never enter that sum. Assert an unknown subprocess scan remains null in both per-run and comparison output.

- [ ] **Step 6: Implement derived metrics and additive/substitutive classification**

Classify treatment behavior as `substitutive`, `additive`, `mixed`, or `unknown` from observed overlap and post-pack broad reads. This is a descriptive derived result, not a correctness score.

- [ ] **Step 7: Run targeted/full tests and commit**

Run: `npm test -- tests/benchmark/events.test.ts tests/benchmark/exposure.test.ts tests/benchmark/derive.test.ts`

Run: `npm test`

Expected: all PASS.

Commit:

```text
feat: measure benchmark context exposure
```

---

### Task 4: Condition parity, model gate, and process isolation

**Files:**
- Create: `benchmarks/refactor-safely/harness/conditions.mjs`
- Create: `benchmarks/refactor-safely/harness/model-gate.mjs`
- Create: `benchmarks/refactor-safely/harness/process.mjs`
- Create: `benchmarks/refactor-safely/harness/approvals.mjs`
- Create: `tests/benchmark/conditions.test.ts`
- Create: `tests/benchmark/model-gate.test.ts`
- Create: `tests/benchmark/isolation.test.ts`

**Interfaces:**
- Produces: `sharedInvocation(run)`, `controlInvocation(run)`, `devbrainInvocation(run)`, `assertConditionParity(control, treatment)`, `discoverModels()`, `resolveModelEvidence(events)`, `assertPinnedModel(evidence)`, `spawnCodex(invocation, sinks)`, and `prepareDevBrainApprovals(repo, home)`.
- The only permitted parity delta is `{ mcpConfiguration, skillInstruction }` plus treatment-owned DevBrain environment paths necessary for that MCP entry.

- [ ] **Step 1: Write failing parity and CONTROL-isolation tests**

Build both invocations and assert normalized arguments/environment are identical outside an explicit allowlisted delta. Inject a DevBrain MCP event into a CONTROL trace and assert `CONTROL_TREATMENT_LEAK`.

- [ ] **Step 2: Run parity tests red and implement invocation builders**

Run: `npm test -- tests/benchmark/conditions.test.ts`

Expected: FAIL before builders; PASS after both derive from one immutable shared configuration using exact `gpt-5.6-sol`, `--ephemeral`, `--json`, `--ignore-user-config`, workspace-write, approval `never`, and no search.

- [ ] **Step 3: Write failing model-gate tests**

Cover exact catalog/event match, absent model, alias-only model, conflicting resolved model, discovery-command failure, and CLI rejection. Every non-exact case must return `BLOCKED` before a measured run.

```ts
expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: null })).toMatchObject({ status: 'BLOCKED' });
expect(assertPinnedModel({ requested: 'gpt-5.6-sol', resolved: 'gpt-5.6-sol' })).toMatchObject({ status: 'ready' });
```

- [ ] **Step 4: Implement discovery adapters without hard-coding one CLI surface**

Try the installed CLI's supported catalog/session metadata surfaces and record the raw evidence. `codex debug models` may be one adapter, not an invariant. Require trustworthy resolved-model evidence; command acceptance alone is insufficient under the frozen protocol.

- [ ] **Step 5: Write failing evaluator-canary and working-root isolation tests**

Assert the Codex cwd contains only the task repository, prompts contain no evaluator path, randomized canary content does not appear in events, and any event referencing the evaluator/canary path invalidates the run.

- [ ] **Step 6: Implement process streaming and isolation**

Stream stdout JSONL and stderr directly into exclusive raw sinks. Enforce a hard timeout, terminate the process tree on timeout, and retain partial raw evidence. Do not execute a real model in unit tests; use a fixture child process.

- [ ] **Step 7: Prepare treatment execution approvals through existing public behavior**

Against the materialized fixture and run-specific `DEVBRAIN_HOME`, request `test`, `targeted_test`, `lint`, and `build` capabilities through the existing built tools, require `approval_required`, then invoke the existing `devbrain approve <approval-id>` CLI. Record approval IDs/status without editing the approval store directly.

- [ ] **Step 8: Run targeted/full tests and commit**

Run: `npm test -- tests/benchmark/conditions.test.ts tests/benchmark/model-gate.test.ts tests/benchmark/isolation.test.ts`

Run: `npm test`

Expected: all PASS without a measured agent run.

Commit:

```text
feat: isolate benchmark agent conditions
```

---

### Task 5: Hidden evaluators and independent outcome dimensions

**Files:**
- Create: `benchmarks/refactor-safely/evaluators/common.mjs`
- Create: `benchmarks/refactor-safely/evaluators/task-a.mjs`
- Create: `benchmarks/refactor-safely/evaluators/task-b.mjs`
- Create: `benchmarks/refactor-safely/evaluators/task-c.mjs`
- Create: `benchmarks/refactor-safely/harness/outcome.mjs`
- Create: `tests/benchmark/evaluators.test.ts`
- Create: `tests/benchmark/outcome.test.ts`

**Interfaces:**
- Produces: `evaluateTaskA(root, manifest)`, `evaluateTaskB(root, manifest)`, `evaluateTaskC(root, manifest)`, `classifyPatch(checks, harnessVerification)`, and `classifySkillDiscipline(agentBehavior)`.
- Check shape: `{ id, dimension, status, critical, evidence }`, where dimension is `transformation | behavior | scope`.

- [ ] **Step 1: Write failing Task A evaluator tests against controlled patches**

Create literal variants: correct scoped patch, missed caller, behavior regression, accidental `validateTokenFormat` rename, allowed-but-unneeded file unchanged, unrelated file change, and formatting churn. Assert behavioral checks dominate implementation shape.

- [ ] **Step 2: Run evaluator tests red**

Run: `npm test -- tests/benchmark/evaluators.test.ts`

Expected: FAIL because evaluators do not exist.

- [ ] **Step 3: Implement instrumented evaluator reads and Task A checks**

The evaluator imports and executes the completed fixture, scans only required scoped identifiers, runs harness-owned targeted/lint/build/full commands, compares changed paths to `allowedChangedFiles`, and compares required paths to `requiredChangedFiles`. Record explicit read bytes separately; spawned-process internal reads remain unknown.

- [ ] **Step 4: Prepare behavioral Task B/C evaluators**

Task B asserts contract and adapter behavior, not exact implementation layout. Task C asserts stored/read mapping and unchanged public API, not a preferred mapper structure. Test both against at least two behaviorally valid implementation shapes.

- [ ] **Step 5: Write failing outcome-separation tests**

Assert a correct patch with `agentBehavior.fullRegressionRun: false` remains patch `SUCCESS` while skill discipline is incomplete. Assert infrastructure failure is `HARNESS_ERROR`, never patch `FAILURE`.

- [ ] **Step 6: Implement classifications and rerun green**

Run: `npm test -- tests/benchmark/evaluators.test.ts tests/benchmark/outcome.test.ts`

Expected: all PASS.

- [ ] **Step 7: Run the complete suite and commit**

Run: `npm test`

Commit:

```text
feat: add hidden refactor benchmark evaluators
```

---

### Task 6: Implement and validate `/refactor-safely`

**Files:**
- Create: `skills/refactor-safely/SKILL.md`
- Create: `skills/refactor-safely/agents/openai.yaml`
- Create: `skills/refactor-safely/references/evidence-contract.md`
- Create: `skills/refactor-safely/references/completion-template.md`
- Create: `skills/refactor-safely/evals/scenarios.json`
- Create: `benchmarks/refactor-safely/harness/skill-eval.mjs`
- Create: `tests/benchmark/skill-eval.test.ts`

**Interfaces:**
- The skill consumes existing DevBrain MCP tools and returns a concise evidence-backed completion record.
- `assessContextSufficiency(evidence)` in the evaluation harness returns observable unmet criteria for scenario grading; it is not exposed to or called by the skill as a magic boolean.

- [ ] **Step 1: Initialize the skill skeleton with the bundled skill initializer**

Run the Skill Creator initializer with `--resources references`. Remove every generated placeholder. Keep automatic discovery enabled and set interface metadata only to identify the refactor workflow.

- [ ] **Step 2: Define observable Context Pack sufficiency**

Document that a pack is sufficient only when all applicable conditions hold:

1. The requested target resolves to a file-qualified definition.
2. Direct dependents and relevant tests are present or the evidence explicitly supports none.
3. Target ambiguity is resolved; low textual confidence alone is insufficient.
4. Directly relevant impact paths are not truncated.
5. No directly relevant candidate was budget-excluded.
6. Medium heuristic symbol evidence is corroborated by a bounded definition slice and caller/import evidence.
7. Remaining unknowns are recorded and do not require broad exploration.

If a criterion fails, expand only toward that failed criterion and record the expansion. If all pass, the skill prohibits broad rereading and permits only diff-, failure-, or newly evidenced targeted reads.

- [ ] **Step 3: Write the skill workflow and references**

Keep `SKILL.md` focused on decisions and routing. Put the expansion schema/evidence semantics in `evidence-contract.md` and the final result fields in `completion-template.md`. Require pre/post impact, scoped diff inspection, targeted-to-full verification, diagnosis before retry, no drive-by edits, and separate patch/discipline conclusions.

- [ ] **Step 4: Validate skill packaging**

Run the bundled `quick_validate.py skills/refactor-safely` and require a clean result.

- [ ] **Step 5: Write failing scenario-evaluation tests**

The eight scenario records cover straightforward evidence, ambiguous symbol, truncated references, low-confidence impact, targeted test failure, unexpected post-change impact, unrelated diff, and full-regression failure. Tests assert the evaluator rejects decisions that broaden without reason, claim success after failed verification, or conflate potential impact with breakage.

- [ ] **Step 6: Implement scenario grading and run deterministic tests**

Run: `npm test -- tests/benchmark/skill-eval.test.ts`

Expected: PASS after the evaluation harness checks structured decisions against literal scenario evidence. Do not test prose with grep.

- [ ] **Step 7: Run independent behavioral forward-tests**

After deterministic tests pass, use fresh isolated non-benchmark sessions to present the raw scenarios and skill, without intended answers. Store these as skill-evaluation artifacts, not pilot runs. If model execution is not yet authorized at this gate, stop with deterministic validation complete and list forward-testing as a pre-pilot requirement.

- [ ] **Step 8: Refine only from demonstrated failures, validate, and commit**

Run the skill validator and benchmark tests again after any correction.

Commit:

```text
feat: add refactor safely orchestration skill
```

---

### Task 7: Orchestrator, reports, and pilot stop control

**Files:**
- Create: `benchmarks/refactor-safely/harness/runner.mjs`
- Create: `benchmarks/refactor-safely/harness/report.mjs`
- Create: `benchmarks/refactor-safely/cli.mjs`
- Create: `benchmarks/refactor-safely/protocol.json`
- Create: `benchmarks/refactor-safely/README.md`
- Modify: `package.json`
- Create: `tests/benchmark/runner.test.ts`
- Create: `tests/benchmark/report.test.ts`

**Interfaces:**
- CLI commands: `prepare`, `validate`, `preflight-model`, `run --task task-a --condition control|devbrain --repetition 1`, and `report --pilot`.
- `runCondition(spec)` returns one completed run artifact path; it never schedules another condition.
- `runPilotAfterApproval()` contains a literal two-item run matrix and rejects any task/repetition outside it.

- [ ] **Step 1: Write failing orchestration tests**

Use fake Codex/evaluator processes. Assert fixture identity is checked before launch, CONTROL runs first in a fresh root, DEVBrain uses a different fresh root, a failed condition does not get silently retried, and the matrix contains exactly two Task A runs.

- [ ] **Step 2: Run runner tests red and implement the state machine**

Run: `npm test -- tests/benchmark/runner.test.ts`

Expected: red before implementation; green after explicit states `prepared -> model_verified -> agent_complete -> harness_verified -> evaluated -> derived` and terminal `blocked | harness_error` paths.

- [ ] **Step 3: Write failing report tests**

Use literal run records to assert the report prints individual runs, repository gross/unique/duplicate exposure, total measurable payload, deterministic scanning, evaluator reads, Context Pack candidate-to-selected counts, agent discipline, patch results, duration, substitution classification, limitations, and `PROCEED | REMEDIATE | BLOCKED` without a combined DevBrain score.

- [ ] **Step 4: Implement reports and machine-readable summary**

Produce `reports/benchmark-summary.json` and `reports/benchmark-summary.md`. With one repetition, report the individual value, mean, median, and range as the same observed value and explicitly state that no statistical inference is possible.

- [ ] **Step 5: Add package scripts and operator documentation**

Add scripts for benchmark tests, validation, model preflight, the approval-gated pilot command, and report generation. README must state that the pilot command is prohibited until the separate execution approval and that it never proceeds to Tasks B/C.

- [ ] **Step 6: Run targeted/full tests and commit**

Run: `npm test -- tests/benchmark/runner.test.ts tests/benchmark/report.test.ts`

Run: `npm test`

Commit:

```text
feat: orchestrate refactor benchmark pilot
```

---

### Task 8: Pre-pilot acceptance and execution approval gate

**Files:**
- Modify: `benchmarks/refactor-safely/README.md`
- Create: `benchmarks/refactor-safely/reports/readiness.json`
- Create: `benchmarks/refactor-safely/reports/readiness.md`

**Interfaces:**
- Consumes all implementation/test outputs.
- Produces a readiness decision only; it does not run either measured condition.

- [ ] **Step 1: Run all benchmark tests fresh**

Run: `npm test -- tests/benchmark`

Expected: every harness, fixture, parser, evaluator, outcome, skill-eval, runner, and report test PASS.

- [ ] **Step 2: Reproduce the frozen MCP regression**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: all exit zero; tool count remains 26 and evaluation count remains 20.

- [ ] **Step 3: Verify Phase 4 immutability**

Run `git diff v0.4.0-phase4 -- src evals.xml` and require only planned non-MCP package-script changes outside `src`/`evals.xml`; specifically require no `src/` or `evals.xml` diff. Recheck that `master` and the tag still resolve to `d2f9246`.

- [ ] **Step 4: Validate fixtures, hidden isolation, artifacts, and parser coverage**

Run the harness `validate` command without launching Codex. Record identical Task A materializations, evaluator canary isolation, synthetic JSONL coverage, allowed/required file sets, and raw/derived write-once behavior.

- [ ] **Step 5: Create and commit the readiness report**

The report must list any unknowns that can only be resolved by the live model preflight. It must state `READY_FOR_EXECUTION_APPROVAL`, `REMEDIATE`, or `BLOCKED`.

Commit:

```text
test: verify refactor pilot readiness
```

- [ ] **Step 6: STOP and request explicit pilot execution approval**

Do not run model discovery, skill forward-tests requiring live Codex (if not separately authorized), CONTROL, or DEVBrain. Present the implementation commits and readiness evidence for review.

---

### Task 9: Execute exactly two pilot runs after approval

**Files:**
- Create: `benchmarks/refactor-safely/runs/task-a-control-1/**`
- Create: `benchmarks/refactor-safely/runs/task-a-devbrain-1/**`
- Create: `benchmarks/refactor-safely/reports/benchmark-summary.json`
- Create: `benchmarks/refactor-safely/reports/benchmark-summary.md`

**Interfaces:**
- This task is blocked until the user explicitly approves pilot execution after Task 8.
- Produces the requested pilot completion report and then stops.

- [ ] **Step 1: Resolve the exact model before measured execution**

Run the model preflight. Require trustworthy evidence that requested and resolved identifiers are both `gpt-5.6-sol`. If unavailable, write a `BLOCKED` report with the available identifiers/evidence and stop without either measured run.

- [ ] **Step 2: Re-materialize and compare both baselines**

Create both randomized repositories, then require exact equality of Git SHA, canonical content SHA-256, sorted file list, visible task bytes, and shared invocation settings.

- [ ] **Step 3: Run Task A CONTROL repetition 1**

Launch one ephemeral session. Preserve raw JSONL/stderr before derivation, run harness verification and the hidden evaluator afterward, verify artifacts, and derive the CONTROL record. Do not retry an agent failure.

- [ ] **Step 4: Run Task A DEVBrain repetition 1**

Create a new session and repository. Prepare existing Phase 2 approvals, provide the explicit MCP/skill treatment, preserve/evaluate/derive identically, and do not reuse CONTROL context.

- [ ] **Step 5: Audit isolation and instrumentation before comparison**

Require no DevBrain event in CONTROL, no hidden evaluator access, identical baseline/task/model/runtime evidence, valid raw hashes, complete event parsing provenance, and explicit unknowns. Infrastructure defects become `HARNESS_ERROR` and recommendation `REMEDIATE`.

- [ ] **Step 6: Generate the pilot comparison**

Report CONTROL and DEVBrain independently, then differences for repository gross/unique/duplicate exposure, total measurable payload, correctness, discipline, latency, tool calls, Context Pack governance, and substitution versus accumulation. State instrumentation limitations and avoid significance claims.

- [ ] **Step 7: Run final regression and preserve evidence**

Run `npm test`, `npm run lint`, and `npm run build`. Verify every raw hash and Git status. Commit controlled pilot artifacts if they contain no credentials or non-fixture private data; otherwise preserve locally and document exclusions without weakening raw-evidence hashes.

- [ ] **Step 8: STOP with the requested pilot report**

Return the exact report structure from the frozen request and a recommendation of `PROCEED`, `REMEDIATE`, or `BLOCKED`. Do not execute Task B, Task C, another Task A repetition, or any full-benchmark run.
