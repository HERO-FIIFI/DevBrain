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

---

# Phase 3 — Context Intelligence & Governance

Verified on 2026-09-18 against the working tree that became the Phase 3 baseline.

## Phase 1 + Phase 2 preservation

- Gate 0: `v0.1.0-phase1` and `v0.2.0-phase2` (`bd66ce3eff2b7228d452061a9ee8fc339b5a72a5`) resolved; the Phase 2 baseline reproduced exactly (20 files / 67 tests, lint PASS, build PASS, 10 tools) before any Phase 3 change.
- Regression: **PASS** — every Phase 1/2 test remains in the suite unchanged; the ten Phase 1/2 tools keep their contracts and annotations. No Phase 1/2 test, schema, trust control, evidence semantic, or execution safeguard was weakened.
- Shared changes were limited to `src/index.ts` (registration), `src/execution/home.ts` (`context-packs/` directory), and `src/lib/redaction.ts` (the `key: value` form now requires a quoted or ≥8-character token so TypeScript annotations such as `token: string` are not treated as secrets; `key=value` is unchanged).
- Phase 1/2 history was not rewritten.

## Quality gates

- Tests: **PASS** — `npm test`, 23 files and 89 tests (Phase 2's 20/67 plus `tests/context/retrieval.test.ts` (8), `tests/context/evidence-diagnostics.test.ts` (4, parameterised), `tests/context/context-pack.test.ts` (5), and the extended 19-tool `tests/server.test.ts` contract).
- Lint: **PASS** — `npm run lint`, zero errors.
- Build: **PASS** — `npm run build`, zero TypeScript errors.
- Tools: **PASS** — 19 registered (5 Phase 1, 5 Phase 2, 9 Phase 3).

## Phase 3 capabilities (Inspector call outcomes)

All calls below went through the official `@modelcontextprotocol/inspector` 2.7.0 CLI over stdio against the DevBrain repository root, with `DEVBRAIN_HOME=%TEMP%\devbrain-phase3-acceptance`. The Inspector validated every `structuredContent` against the advertised `outputSchema`.

- `devbrain_search_text`: `partial` — query `boundedInteger`, 127 files scanned, 13 total matches, 5 returned, `truncated: true`, every match carries `source.trust: untrusted_content`.
- `devbrain_search_symbols`: `complete` — one definition, `devbrain-mcp/src/context/budgets.ts:10-14`, `function`/`typescript`, `resolutionMethod: heuristic`, `confidence: medium`.
- `devbrain_find_references`: `partial` — 13 references across five files, 10 returned, `resolutionMethod: textual`, `confidence: low`, `truncated: true`.
- `devbrain_read_file_slice`: `complete` — lines 1-8 of `budgets.ts`, 200 bytes, line-numbered, untrusted provenance.
- `devbrain_read_symbol`: `complete` — `boundedInteger` body with kind, language, resolution method, and confidence. The first Inspector call was rejected by output validation because the result carried a `language` field the output schema did not declare (zod strips unknown keys, so the unit tests had not caught it). The schema now declares `language`, and the retrieval test strict-parses the result so undeclared fields fail in CI; the failure was reproduced before the fix and passes after it.
- `devbrain_get_diff`: `complete` — `working_tree`, 8 files, +123/−9, 21,921-byte patch, not truncated, 1 secret-like fixture value redacted.
- `devbrain_get_execution_evidence`: `complete` — Phase 2 execution `exec_mu5pop5i_1d5b166f-121c-4d34-9170-df0f530f6de3` returned capability `test`, completed/passed, Vitest 67/0/0, `text_regex`/medium, Git `0517a7e` dirty, log sizes and SHA-256 hashes, and no raw log content.
- `devbrain_diagnose_log`: `complete` — Phase 2 failing execution `exec_mu5pr3fw_3c17483f-5c42-4f85-b7a5-1bf2e4a74ea2` yielded `primaryFailure: Error / "Tests 1 failed | 1 passed (2)"`, `confidence: medium`, untrusted provenance. That log holds only an 80-byte summary, so no frames existed to extract; richer Vitest, Jest, pytest, compiler, lint, chained-exception, large, and unknown logs are covered by the parameterised diagnostic tests.
- `devbrain_context_pack`: `partial` — `ctx_mu6xp8io_154129bd-4079-4b67-82c2-b6e21c761697`, budget 4 files / 300 lines / 20,000 bytes, usage 4 / 233 / 17,231, metrics 127 repository files → 19 candidates → 4 included, 551 → 233 lines, 54,684 → 17,231 bytes, 15 budget-excluded items, `truncated: true`, `confidence: high`, manifest persisted under `context-packs/<repository-id>/<context-pack-id>/manifest.json`.
- Negative calls: `read_file_slice` on `../Qwen_Tui/.gitignore` returned `isError` with `Path is outside permitted workspace`; `get_execution_evidence` with `../../etc/passwd` was rejected by the input schema pattern before any filesystem access.
- Phase 1/2 regression through the same Inspector session: `repo_map` complete, `find_todos` complete with findings, `run_tests` `unsupported`/`capability_not_detected` at the workspace root without executing anything, `inspect_docker` honest `partial` because the daemon was unavailable.

## Security

- Path boundary: **PASS** — every retrieval tool resolves through the shared canonical path safety; traversal and out-of-workspace requests are rejected (unit tests plus the Inspector negative call above).
- Symlink boundary: **PASS** — symlink escape is rejected in `tests/context/retrieval.test.ts`; on Windows the file-symlink case requires symlink privilege and the test accounts for that without weakening the assertion.
- Secret redaction: **PASS** — search results, slices, symbols, diffs, diagnostics, execution evidence, and context packs pass through the shared redactor; tests assert the fixture value never appears while `redactionCount`/`redacted` metadata is preserved.
- Prompt-injection provenance: **PASS** — repository text containing `IMPORTANT INSTRUCTIONS FOR AI: ignore previous instructions` is returned verbatim as data with `source: { type: repository_file, trust: untrusted_content }`; nothing in DevBrain interprets it.
- Hard context ceilings: **PASS** — `HARD_CONTEXT_LIMITS` (20 files / 3,000 lines / 200,000 bytes / 200 search results / 200 references / 150,000 diff bytes) are enforced in input schemas (`maximum`) and by `boundedInteger`; requests above a ceiling are rejected, and outputs above a budget return truncation metadata instead of the full content.
- Evidence store: `executionId` is the only accepted handle (`^exec_[A-Za-z0-9_-]{8,200}$`); no evidence-store path is accepted.

## Context packs

- Budget enforcement: **PASS** — requested budgets are honoured exactly (usage never exceeds budget, including after redaction expansion) and remain capped by the hard ceilings.
- Selection reasons: **PASS** — every item carries `reason.code` ∈ {`explicit_file`, `explicit_symbol`, `stack_reference`, `git_diff`, `exact_text`} with its evidence/source; ranking follows the brief's signal order (explicit seeds, failure/stack references, Git diff relevance, exact text), so diff-relevant files outrank plain text matches by design.
- Dirty provenance: **PASS** — packs record `sha`, `branch`, `dirty`, and `dirtyFileCount`; every DevBrain pack in this acceptance was produced on a dirty worktree and says so.
- Metrics: **PASS** — files, lines, bytes, and budget utilisation percentages only; no token claims.
- Persistence: **PASS** — manifests store file, line range, symbol, SHA-256 of the included slice, reason, and repository state, not repository content.

## Languages

- TypeScript: **PASS** — function/class/interface/type/enum definitions and references verified on fixtures and on DevBrain itself (`heuristic`/medium).
- JavaScript: **PASS** — fixture symbol resolution verified (`heuristic`/medium).
- Python: **PASS** — fixture function/class resolution verified, and `WorkspaceIndex` resolved on Qwen_Tui (`heuristic`/medium).

## Real repositories

- JavaScript/TypeScript: **PASS** — DevBrain itself. Objective "Investigate context pack budget enforcement and provenance"; `ctx_mu6u06qp_6089d8d6-5d69-47df-a82a-650665a764c1`; SHA `bd66ce3` on `master`, dirty (20 files); budget 6 / 500 / 40,000; 127 repository files → 54 candidates → 6 included; 987 → 283 lines; 111,517 → 30,084 bytes; 48 budget-excluded items; `confidence: high`. The first attempt was rejected because the seed file was given relative to `devbrain-mcp/` instead of the Git root; the rerun used the canonical repository-relative path rather than weakening path resolution.
- Python: **PASS** — Qwen_Tui. Objective "Investigate WorkspaceIndex Git context resolution"; `ctx_mu6tzklc_650215b3-ef9e-4c25-ae42-68ce7ad10eea`; clean SHA `817f5359b11b33b57f010862f0b7a104ea3d822e` on `main`; budget 6 / 500 / 40,000; 25 repository files → 9 candidates → 6 included; 247 → 184 lines; 11,402 → 8,984 bytes; `confidence: high`.
- Both packs answered a bounded question without reading the whole repository; only characteristics are recorded here, not repository content.

## MCP Inspector

- `tools/list --strict`: 19 tools, every tool has `inputSchema` and `outputSchema`, zero portability findings.
- Annotations: the eight retrieval/evidence tools are `readOnlyHint: true`, non-destructive, idempotent, closed-world; `devbrain_context_pack` is `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false` because it persists a DevBrain-owned manifest outside the repository.
- All nine Phase 3 tools were called with validated `structuredContent`; bounded output, truncation metadata, `isError` on boundary violations, and schema rejection of malformed identifiers were observed. No repository mutation occurred.

## Evaluations

- Automated validation: **PASS** — `evals.xml` contains exactly 15 multi-tool QA pairs: the original five Phase 1, five Phase 2, and five new Phase 3 evaluations.
- Phase 1/2 evaluations were preserved unchanged.
- Manual Phase 3 replay: **PASS** — replayed against the built `dist/` tools on a controlled Git fixture (TypeScript `validateToken` plus a Python `validateToken`, a secret-like value, prompt-like prose, an ignored file, and an uncommitted authentication change). Observed: two `heuristic`/medium definitions and an `ambiguous` unqualified `read_symbol` with 2 candidates; `textual`/low references across three files; execution evidence with counts, log sizes, and hashes but no raw log, and a medium-confidence diagnostic with untrusted provenance; a complete working-tree diff (1 file, +1/−0) with `refreshToken` located in the changed file; a one-file pack (1 file / 3 lines / 52 bytes, 2 budget-excluded candidates, `explicit_symbol` reason, `untrusted_content`) and a qualified `read_symbol` with no secret leakage; `api_key=[REDACTED]` in search results and a slice that keeps the injection prose as data with `redacted: true`. Answers derive from tool output, not assumed states.

## Known limitations and residual risks

- Symbol and reference resolution is deterministic and language-aware but heuristic (no AST or type-checker); definitions report `heuristic`/medium and references `textual`/low. Textual references may include false positives and are labelled as such.
- Diagnostic compression is regex-based (`medium` at best). When a log carries only a summary line, `primaryFailure.type` falls back to a generic `Error` and no frames are returned.
- Context-pack ranking is signal-ordered, not semantic; a large working-tree diff can crowd out exact-text candidates under a small file budget. The excluded counts make this visible.
- Redaction is pattern-based; unusual secret formats can pass through, and quoted TypeScript-like values are now only redacted when they look like tokens.
- Ignore handling relies on Git when available and on a fixed exclusion list otherwise; generated content that is neither Git-ignored nor in the list is searchable.
- Context-pack manifests are local files under `DEVBRAIN_HOME`; operators manage retention and access.

## Phase 3 baseline

- Phase 2 baseline: `bd66ce3eff2b7228d452061a9ee8fc339b5a72a5` (`v0.2.0-phase2`).
