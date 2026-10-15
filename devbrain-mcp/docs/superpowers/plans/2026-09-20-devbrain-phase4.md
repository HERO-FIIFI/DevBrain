# DevBrain MCP Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and freeze seven deterministic, read-only MCP capabilities for architecture, dependency, interface, persistence, and change-impact intelligence.

**Architecture:** Reuse the Phase 1 stack detector and Phase 3 repository, symbol, diff, provenance, redaction, and budget boundaries. Build one bounded in-memory repository model, expose it through thin MCP tool adapters, and label every structural fact or impact candidate with evidence, classification, resolution method, and confidence.

**Tech Stack:** TypeScript, Node.js standard library, Zod, MCP TypeScript SDK, Vitest, ESLint, Docker for clean verification.

**Spec:** `C:/Users/Administrator/.codex/attachments/9e603dde-a46c-4ed5-871e-eb697ab3f155/pasted-text.txt`

## Global Constraints

- Baseline is annotated tag `v0.3.0-phase3` at `2bafdbd`; preserve all Phase 1-3 contracts and verification history.
- Implement exactly seven tools, bringing the registered total to 26.
- Keep repository and database behavior read-only; never execute application code, connect to live databases, or run migrations.
- Hard ceilings are `maxNodes: 500`, `maxEdges: 1500`, `maxDepth: 5`, `maxFiles: 300`, and callers may only request smaller limits.
- Support TypeScript, JavaScript, and Python; framework adapters cover Express, Next.js, FastAPI, Flask, and Django when dependency/configuration evidence exists.
- Preserve path/symlink boundaries, `.gitignore`, redaction, untrusted-content provenance, dirty Git provenance, and Phase 3 Context Pack budgets.
- Use no LLM, embedding API, vector database, remote semantic service, daemon, persistent graph store, or new dependency.
- Add exactly five Phase 4 evaluations, for a total of 20.
- Do not commit or tag until every acceptance gate is verified; the final commit message is `feat: complete DevBrain MCP Phase 4 architecture and change intelligence` and tag is `v0.4.0-phase4`.

## Review Focus

- A diff containing deleted or renamed files must return exact Git provenance without escaping the repository or crashing on absent file content; Task 2 owns this test.
- Duplicate symbols in different packages must remain package/file-qualified instead of silently merging impact paths; Task 2 owns this test.
- Static route/schema/test evidence must never be worded as runtime reachability, deployed database state, or behavioral coverage; Tasks 1, 3, and 4 pin these boundaries.
- Large cyclic graphs must terminate at requested limits and report truncation/count metadata accurately; Task 1 owns this test.
- Connection strings and configuration evidence must preserve useful non-secret structure while removing credentials; Task 3 owns this test.

---

### Task 1: Stabilize Structural Intelligence

**Files:**
- Modify: `src/architecture/model.ts`
- Modify: `src/architecture/graph.ts`
- Modify: `src/architecture/components.ts`
- Modify: `src/tools/dependency-graph.ts`
- Modify: `src/tools/architecture-map.ts`
- Modify: `tests/architecture/graph.test.ts`

**Interfaces:**
- Consumes: `repositoryModel(path?)`, Phase 1 `detectStack`, Phase 3 safe repository enumeration.
- Produces: `structuralEdges(model)`, `boundedGraph(nodes, edges, seeds, limits)`, and evidence-backed dependency/architecture MCP outputs.

- [ ] **Step 1: Add failing boundary and provenance assertions**

Add cases that hand-build an import cycle larger than requested `maxNodes`, request depths 1 and 5, and assert literal count/truncation values. Add ambiguous same-name symbols in two workspaces and assert distinct `symbol:<file>#<name>` IDs.

```ts
expect(result).toMatchObject({
  status: 'partial',
  returnedNodes: 3,
  truncated: true,
  boundary: { evidence: 'static_repository_analysis', runtime: 'not_observed' },
});
expect(symbolIds).toEqual([
  'symbol:apps/api/src/auth.ts#AuthService',
  'symbol:packages/auth/src/auth.ts#AuthService',
]);
```

- [ ] **Step 2: Verify the new tests fail for the intended contract**

Run: `npm test -- tests/architecture/graph.test.ts`

Expected: FAIL on the new count, qualification, or truncation assertion—not on fixture setup.

- [ ] **Step 3: Make the smallest graph/model correction**

Keep traversal iterative with a visited map, retain file-qualified IDs, cap returned arrays before serialization, and derive `truncated` from omitted depth/nodes/edges or the 300-file repository cap. Do not introduce a graph library.

- [ ] **Step 4: Verify structural tests and suite**

Run: `npm test -- tests/architecture/graph.test.ts`

Expected: all structural tests PASS.

Run: `npm test`

Expected: no Phase 1-3 regression.

### Task 2: Complete Change-Impact Intelligence

**Files:**
- Modify: `src/architecture/impact.ts`
- Modify: `src/tools/change-impact.ts`
- Modify: `src/tools/get-diff.ts`
- Create: `tests/architecture/impact.test.ts`

**Interfaces:**
- Consumes: `repositoryModel`, `model.dependents`, `collectRoutes`, `repositorySchema`, `migrationChains`, and exported `diffArguments`.
- Produces: `changeImpact(model, seed, limits)` and `devbrain_change_impact` output for symbol, file, working-tree, staged, commit, and range seeds.

- [ ] **Step 1: Write failing file/symbol impact tests**

Create a fixture where route → service → repository → schema and tests import the service. Assert direct, transitive, interface, persistence, and test candidates, each with a literal relationship path and `classification: 'potential'`.

```ts
expect(byId('route:GET /users')).toMatchObject({
  category: 'interface',
  relationshipPath: [
    'file:src/services/users.ts',
    'file:src/routes/users.ts',
    'route:GET /users',
  ],
  classification: 'potential',
  confidence: 'high',
});
```

Include a missing symbol that returns `resolved: false`, `impacts: []`, and `confidence: 'unknown'` without claiming safety.

- [ ] **Step 2: Run the file/symbol tests red**

Run: `npm test -- tests/architecture/impact.test.ts`

Expected: FAIL where a category, path, bound, or unresolved-state contract is missing.

- [ ] **Step 3: Implement only the missing traversal behavior**

Use reverse import traversal with a visited set. Rank literal categories in this order: direct, interface, persistence, test, transitive, configuration. Slice to `maxResults` and preserve `totalCandidates`, `depthReached`, and `truncated`.

- [ ] **Step 4: Write failing Git-seed tests**

Test working-tree, staged, commit, and range modes. Include modified, deleted, and renamed files; assert repository SHA/branch/dirty state and the exact changed-file list returned by Git evidence.

```ts
expect(result).toMatchObject({
  repository: { dirty: true, dirtyFileCount: 1 },
  seed: { type: 'diff', mode: 'working_tree', resolved: true },
  changed: { files: ['src/services/users.ts'] },
});
```

- [ ] **Step 5: Run Git-seed tests red, implement, and rerun green**

Run: `npm test -- tests/architecture/impact.test.ts`

Expected before implementation: FAIL on missing rename/delete/range behavior.

Expected after the minimal correction: all impact tests PASS.

### Task 3: Harden Interface and Persistence Adapters

**Files:**
- Modify: `src/architecture/adapters.ts`
- Modify: `src/architecture/persistence.ts`
- Modify: `src/lib/redaction.ts`
- Modify: `src/tools/api-inventory.ts`
- Modify: `src/tools/route-inventory.ts`
- Modify: `src/tools/database-schema.ts`
- Modify: `src/tools/migration-status.ts`
- Modify: `tests/architecture/interfaces.test.ts`
- Modify: `tests/architecture/persistence.test.ts`
- Modify: `tests/redaction.test.ts`

**Interfaces:**
- Consumes: dependency-backed framework detection, static source text, repository-safe reads.
- Produces: normalized route/API records, repository-declared schema records, repository-only migration chain findings, and redacted datasource metadata.

- [ ] **Step 1: Add failing unsupported/dynamic/security cases**

Cover unsupported framework syntax, unresolved dynamic routes, ambiguous layering, malformed SQL, duplicate migration identifiers, missing parents, migration cycles, and credential-bearing PostgreSQL/MySQL/MongoDB/Redis URLs.

```ts
expect(redactString('postgresql://user:secret@db/app'))
  .toBe('postgresql://user:[REDACTED]@db/app');
expect(JSON.stringify(result)).not.toContain('secret');
expect(result).toMatchObject({
  databaseState: 'repository_declared_only',
  boundary: { runtime: 'not_observed' },
});
```

- [ ] **Step 2: Run adapter tests red**

Run: `npm test -- tests/architecture/interfaces.test.ts tests/architecture/persistence.test.ts tests/redaction.test.ts`

Expected: each new test fails on its named behavior.

- [ ] **Step 3: Correct adapters without universal-regex claims**

Keep one adapter per supported framework/ORM. Require dependency/configuration evidence before claiming a framework, return low/medium confidence for unresolved/dynamic constructs, resolve ORM model names within their adapter/file namespace first, and retain the URL `@` delimiter while redacting only credentials.

- [ ] **Step 4: Verify adapter tests and suite**

Run the targeted command from Step 2, then `npm test`.

Expected: targeted and full suites PASS with no secret in output.

### Task 4: Prove Phase 3 Context Pack Integration

**Files:**
- Modify: `src/tools/context-pack.ts`
- Modify: `tests/context/context-pack.test.ts`
- Modify: `tests/architecture/impact.test.ts`

**Interfaces:**
- Consumes: optional `architectureRelevance`, explicit file/symbol seeds, diff seed fallback, Phase 3 budgets and manifest persistence.
- Produces: at most ten deterministic `impact_reference` candidates ranked between Git diff and text relevance, without increasing requested budgets.

- [ ] **Step 1: Add a failing ranking/budget regression**

Build the same Context Pack with `architectureRelevance` false and true. Assert an unrelated exact-text match loses to a direct impact only when enabled, while both outputs remain within identical literal budgets.

```ts
expect(ranked.items?.[0].reason.code).toBe('direct_impact');
expect(ranked.usage).toMatchObject({ files: 2 });
expect(ranked.usage!.lines).toBeLessThanOrEqual(40);
expect(ranked.usage!.bytes).toBeLessThanOrEqual(4000);
```

- [ ] **Step 2: Run the integration test red**

Run: `npm test -- tests/context/context-pack.test.ts`

Expected: FAIL on ranking, selection reason, or budget preservation.

- [ ] **Step 3: Apply the minimal deterministic ranking fix**

Reuse `changeImpact`; do not duplicate graph traversal. Cap architecture candidates at ten, deduplicate by file using the existing rank order, redact before byte slicing, and retain source trust as `untrusted_content`.

- [ ] **Step 4: Verify Context Pack and full regression**

Run: `npm test -- tests/context/context-pack.test.ts tests/architecture/impact.test.ts`

Run: `npm test`

Expected: both commands PASS and the Phase 3 budget tests remain unchanged.

### Task 5: Evaluations and Documentation

**Files:**
- Modify: `evals.xml`
- Modify: `tests/evals.test.ts`
- Modify: `README.md`
- Modify: `VERIFICATION.md`

**Interfaces:**
- Consumes: verified outputs from Tasks 1-4.
- Produces: exactly 20 automated evaluation records and user-facing static-vs-runtime/confidence documentation.

- [ ] **Step 1: Add five Phase 4 evaluation records**

Add exactly these question classes: direct/transitive service dependencies; route impact; repository-defined database structures; working-tree diff impact; architecture-ranked Context Pack. Each answer must state observed/inferred/potential distinctions and cite tool evidence.

- [ ] **Step 2: Update the eval count test first and observe failure**

```ts
expect(pairs).toHaveLength(20);
expect(new Set(pairs.map((pair) => pair.id)).size).toBe(20);
```

Run: `npm test -- tests/evals.test.ts`

Expected before adding records: FAIL with 15 received; expected 20.

- [ ] **Step 3: Add eval records and verify**

Run: `npm test -- tests/evals.test.ts`

Expected: PASS with exactly 20.

- [ ] **Step 4: Extend README and VERIFICATION**

Document all headings required by the Phase 4 brief. Record only actual commands, SHAs, dirty states, result counts, confidence, and limitations observed during Task 6; use `NOT_APPLICABLE` or `PARTIAL` instead of invented PASS claims.

### Task 6: Acceptance, Inspector, Real Repositories, and Freeze

**Files:**
- Modify: `VERIFICATION.md`
- Verify: all source, tests, schemas, docs, and Git metadata.

**Interfaces:**
- Consumes: the complete Phase 4 worktree.
- Produces: reproducible acceptance evidence, one final commit, and annotated tag `v0.4.0-phase4`.

- [ ] **Step 1: Run local quality gates fresh**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run build
```

Expected: all exit 0; record exact file/test totals.

- [ ] **Step 2: Run the same gates in Docker**

Use a clean Node image with the repository mounted, install from `package-lock.json`, and run test/lint/build. Record image identity and exact output; do not add Docker lifecycle tools to DevBrain.

- [ ] **Step 3: Verify real repositories**

Run all seven Phase 4 tools against at least one real JS/TS repository and one real Python repository. Record SHA, dirty state, detected architecture, graph counts, routes, schema/migrations or `NOT_APPLICABLE`, one impact seed, confidence, and Context Pack budget result.

- [ ] **Step 4: Run MCP Inspector and manually replay five evaluations**

List all 26 tools, call every Phase 4 tool through stdio, validate input/output schemas and `structuredContent`, and record zero unexplained strict-schema findings. Replay the five Phase 4 evaluation questions from tool output.

- [ ] **Step 5: Audit requirements and working tree**

Run:

```powershell
& 'C:\Program Files\Git\cmd\git.exe' diff --check
& 'C:\Program Files\Git\cmd\git.exe' status --short
& 'C:\Program Files\Git\cmd\git.exe' diff --stat
```

Compare each Phase 4 acceptance line to fresh evidence. Preserve unrelated user-owned files.

- [ ] **Step 6: Freeze only after every applicable gate passes**

Commit exactly the reviewed Phase 4 files with:

```text
feat: complete DevBrain MCP Phase 4 architecture and change intelligence
```

Create annotated tag `v0.4.0-phase4`. Push the commit and tag only after local and Docker verification, real-repository acceptance, Inspector, evaluation replay, and final status checks all pass.
