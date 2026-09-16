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
