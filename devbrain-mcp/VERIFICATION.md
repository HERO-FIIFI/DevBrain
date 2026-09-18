# DEVBrain Phase 1 Verification

Verified on 2026-09-16.

## Quality gates

- Build: **PASS** — `npm run build`, zero TypeScript errors.
- Tests: **PASS** — `npm test`, 12 files and 29 tests passed.
- Lint: **PASS** — `npm run lint`, zero errors.
- Tools: **PASS** — `devbrain_repo_map`, `devbrain_project_health`, `devbrain_git_history`, `devbrain_dependency_audit`, and `devbrain_find_todos` are registered.
- Fixture verification: **PASS** — npm/React, pnpm monorepo, pip/FastAPI, Poetry/Django, mixed/conflicting lockfiles, unknown ecosystem, and bounded TODO results passed.
- Real repository verification: **PASS** — `Qwen_Tui` (Python/pip, single-package) and `AutoResolve` (TypeScript/JavaScript/Python with npm/pip and React/Next.js/FastAPI evidence) were mapped successfully. Only characteristics are recorded here; repository contents were not copied.
- MCP Inspector verification: **PASS** — official Inspector CLI listed 5 tools with 0 strict schema findings; all 5 were called successfully through stdio. All are read-only/non-destructive; only dependency audit has `openWorldHint: true`.
- Structured output: **PASS** — protocol calls returned validated `structuredContent` matching each `outputSchema`.
- Security tests: **PASS** — canonical boundary and symlink escape rejection, literal argument handling with `shell: false`, timeout enforcement, stdout limiting, and representative secret redaction passed.
- Evaluation set: **PASS** — `evals.xml` parses and contains exactly 5 multi-tool `qa_pair` entries. Four fixture evaluations were manually replayed against built tools; the scoped-history evaluation is recreated and verified by the deterministic Git tool test.

## Inspector call outcomes

- `devbrain_repo_map`: `complete` on AutoResolve.
- `devbrain_project_health`: `complete` on Qwen_Tui.
- `devbrain_git_history`: `complete` on Qwen_Tui with limit 2.
- `devbrain_dependency_audit`: `partial` on the Poetry fixture because unsupported remote checks remain explicit.
- `devbrain_find_todos`: `complete` with a limit of 1 and truncation metadata on the mixed fixture.

## Known limitations and residual risks

- Yarn and Poetry update/vulnerability checks remain explicit `not_run` results where stable structured, lockfile-aware commands are not available.
- Python installed-version matching is not claimed unless deterministic local evidence is available.
- Registry/advisory availability and locally installed package-manager executables affect remote sub-check statuses without invalidating inventory.
- Process timeouts force-kill the spawned process; descendant-process cleanup remains platform-dependent.
- Very large non-Git traversals stop at the file-discovery ceiling and return `partial`; very large Git listings are constrained by subprocess output limits.

## Verified baseline

- Commit SHA: `a9ebc678c646e106677f1f40522c9194c334383b` (short `a9ebc67`)
- Tag: `v0.1.0-phase1` (annotated; tag object `5fe70c81445b32aaca1447ac631e0aacce739f03`)
- Branch: `master`
- Working tree at verification: clean

The gates above were verified against the tree recorded in `a9ebc67`. This file
was amended afterwards to record that SHA, so the commit carrying this text is
necessarily a later one; `v0.1.0-phase1` continues to point at the verified
baseline `a9ebc67`.

---

# Phase 2 — Trusted Execution & Evidence

Acceptance remediation verified on 2026-09-17 and 2026-09-18. The pre-remediation reference is `0517a7e62f1e0f23e319302436c19ad64c28752e`.

## Phase 1 preservation

- Baseline SHA: `a9ebc678c646e106677f1f40522c9194c334383b`.
- Annotated baseline tag: `v0.1.0-phase1` (tag object `5fe70c81445b32aaca1447ac631e0aacce739f03`).
- Regression: **PASS** — all Phase 1 tool and library tests remain in the 20-file/67-test Phase 2 suite; the five Phase 1 tools remain registered with their original contracts.
- Phase 1 history was not rewritten.

## Quality gates

- Tests: **PASS** — `npm test`, 20 files and 67 tests passed on Windows; the same 20 files and 67 tests passed in an ephemeral `node:22-bookworm` container.
- Lint: **PASS** — `npm run lint` on Windows and in the container, zero errors.
- Build: **PASS** — `npm run build` on Windows and in the container, zero TypeScript errors.
- Container isolation: the repository was mounted read-only, copied to the container filesystem with `node_modules` excluded, and dependencies/build outputs remained ephemeral.

## Phase 2 capabilities

- `devbrain_run_build`: registered; approval-required and authorized paths verified. Real JS/TS execution `exec_mu5pn67v_d8feb037-8f6a-4930-ace6-b7c6ef271497` completed/passed.
- `devbrain_run_tests`: registered; approval-required and authorized paths verified through both direct MCP logic and Inspector. Inspector execution `exec_mu5pop5i_1d5b166f-121c-4d34-9170-df0f530f6de3` completed/passed with 67 tests.
- `devbrain_run_targeted_tests`: registered; target validation and authorized execution verified. Execution `exec_mu5pnfqm_99dbf049-3806-47f5-9ad0-d166705e7fec` completed/passed with 6 tests.
- `devbrain_run_lint`: registered; approval-required and authorized paths verified. Execution `exec_mu5pnhbi_c34d8a9a-69d8-4a2e-9519-540a103eb667` completed/passed.
- `devbrain_inspect_docker`: registered and live-verified as observational. Docker client/server 29.4.3 returned bounded container/image metadata, health, ports, Compose correlation, sanitized bind/volume sources, and no environment values.

## Trust and approval model

- Repository identity: **PASS** — identity binds canonical location, initial commit, and sanitized remote evidence; replacement at a trusted path receives a different identity.
- External registry: **PASS** — trust, approvals, and execution evidence are under `~/.devbrain/` or an explicit external `DEVBRAIN_HOME`, never authoritative repository state.
- Capability-specific trust: **PASS** — build, test, targeted-test, and lint approvals are independent.
- Definition pinning: **PASS** — invocation and repository-controlled definition fingerprint are rediscovered; a change produces `approval_required` without execution.
- Approval flow: **PASS** — MCP created exact pending requests; the separate administrative CLI inspected and approved them.
- MCP self-approval prevention: **PASS** — Inspector listed no trust/approval MCP tool; `tests/server.test.ts` enforces that absence.

## Execution safety and semantics

- Resolution uses canonical cwd, executable/argument arrays, and `shell: false`; there is no arbitrary command input.
- Timeout defaults/ceilings are enforced for all four capabilities. Process-runner tests verify full descendant termination, including Windows `taskkill /T /F` behavior.
- Targeted tests reject missing targets, traversal, absolute paths, unsupported names, and symlink escape through shared canonical path safety.
- Engineering non-zero exits remain `executionStatus: completed` with `resultStatus: failed`; timeouts remain `timed_out`/`unknown`.

## Evidence and provenance

- Every authorized run produced an immutable `executionId`, timestamps, command/cwd, duration, exit code, Git state, environment, separate logs, hashes, and bounded/redacted response tails.
- JS/TS provenance captured SHA `0517a7e62f1e0f23e319302436c19ad64c28752e`, branch `master`, and nine dirty files. These runs prove the SHA plus uncommitted remediation state, not the clean commit alone.
- Package-manager provenance captured Node `v24.15.0` separately from npm `11.12.1`; Windows regression tests verify that the npm launcher, not `node.exe --version`, is probed.
- External evidence persisted under `%TEMP%\devbrain-phase2-acceptance-20260917` for host executions and `%TEMP%\devbrain-phase2-container-evidence` for the containerized Python execution.
- Containerized Python execution `exec_mu6rl522_de69ca83-0400-4675-b8a7-17cfd0b5f129` persisted `metadata.json`, `result.json`, `stdout.log`, and `stderr.log` outside the auto-removed container. Recomputed hashes matched `sha256:77de117daaf1e148b8fc5282188ea0ae24edf4a0dd25a24832f0b93eda5ec12b` and the empty-stream SHA-256 `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- stdout/stderr separation, atomic structured writes, non-overwrite behavior, log hashing, secret redaction, 8 KiB response tails, and truncation metadata are covered by automated and live evidence.

## Parsing verification

- Priority contract: **PASS** — actual JSON report content is `json_reporter`/high; actual JUnit XML is `junit_xml`/high; otherwise parsing falls through to text, exit-code-only, or unknown. DevBrain does not inject reporters or mutate configuration.
- Vitest: **SUPPORTED** — actual runs use `text_regex`/medium. The regression distinguishes `Test Files 2 passed` from `Tests 17 passed`, and covers mixed pass/fail, skipped tests, and absent summaries. Authorized failing full and targeted executions each reported 1 passed/1 failed without inventing a failing-test name.
- Jest: **SUPPORTED** — authorized fixture execution `exec_mu5pxiti_0c9784ea-a6b8-4356-a7a0-033585a47a34` reported 2 passed using `text_regex`/medium.
- pytest: **SUPPORTED** — containerized real-repository execution `exec_mu6rl522_de69ca83-0400-4675-b8a7-17cfd0b5f129` reported 10 passed using `text_regex`/medium.
- Fallback: **PASS** — unrecognized completed output is `exit_code_only`/low; non-completed execution is `unknown`/unknown. Machine-readable labels are never assigned to regex output.
- Limitation: text parsing currently reports counts and bounded failure totals but does not reliably extract failing test names/messages.

## Real repositories

- JavaScript/TypeScript: **PASS** — DevBrain itself, a real npm/TypeScript Git repository. Build, full tests, targeted tests, and lint all completed/passed with durable execution IDs. Evidence explicitly recorded the dirty remediation worktree.
- Python: **PASS WITH DIRTY EVIDENCE** — Qwen_Tui at clean source SHA `817f5359b11b33b57f010862f0b7a104ea3d822e` was copied into an ephemeral Docker environment with its existing application image and externally prepared pytest tooling. DevBrain execution completed/passed 10 tests under Python 3.13.15, but import/test artifacts made the copied worktree dirty (four files); this does not prove the clean SHA alone passed.
- The initial host Python attempt is retained as negative environment evidence: `exec_mu5pnknd_47c783ac-42ca-44b8-9a40-c718d685dc20` completed/failed with exit-code-only/low because host Python had no pytest. It is not counted as a suite failure or PASS.

## MCP Inspector

- Official `@modelcontextprotocol/inspector` CLI listed all ten tools. Strict schema portability completed with zero findings after unavailable package-manager versions were represented by omission rather than an array-form nullable type.
- All five Phase 1 tools were called through Inspector with validated `structuredContent`; repository map, project health, Git history, and TODO search completed, while dependency audit honestly returned partial for its controlled unsupported path.
- All five Phase 2 tools were called. Build/targeted-test/lint returned valid `approval_required` results after fixture approvals changed their pinned definitions; tests exercised an authorized completed/passed result; Docker returned a live complete result.
- Input/output schemas, annotations, structured content, bounded output, approval-required semantics, authorized result semantics, Docker redaction, and `isError` behavior were observed. No MCP approval tool exists.

## Evaluations

- Automated validation: **PASS** — `evals.xml` contains exactly ten multi-tool QA pairs: the original five Phase 1 evaluations plus exactly five Phase 2 evaluations.
- Phase 1 evaluations were preserved and not overwritten.
- Manual Phase 2 replay: **PASS** — first-contact Vitest returned `approval_required`; controlled build failure returned completed/failed; passing lint was correlated with dirty project health; failing full and targeted Vitest runs both reported 1 passed/1 failed at medium confidence; Docker availability/health was kept independent from test evidence.
- Evaluation answers derive from fixture outputs and captured provenance rather than assumed PASS states.

## Known limitations and residual risks

- **No sandbox:** repository-controlled commands execute with DevBrain process permissions after authorization. Trust is the primary boundary; deny inspection is defense-in-depth.
- Docker inspection is observational, but Docker daemon access may itself imply significant host privileges.
- Structured parsing is available only when existing repository output is actual JSON or JUnit XML. DevBrain does not install or configure reporters.
- Evidence storage is local and protected by host/container filesystem controls; operators must manage retention and access.
- Dirty-worktree evidence must not be treated as proof that the recorded clean commit passed.
- Package-manager/runtime availability can leave a capability unsupported or version provenance unknown.

## Phase 2 baseline

- Pre-remediation SHA: `0517a7e62f1e0f23e319302436c19ad64c28752e`.
- Verified implementation SHA: `1912ad3e45472497e1ed89bfbdd0fc04db04b19e`.
- Final documentation SHA: the commit containing this necessarily self-referential line; resolve it without fabrication as the commit target of `v0.2.0-phase2` (`git rev-list -n 1 v0.2.0-phase2`).
- Final tag: annotated `v0.2.0-phase2`, identifying the documentation-complete baseline.
