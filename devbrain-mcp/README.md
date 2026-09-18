# DevBrain MCP

DevBrain is a local MCP server for bounded repository intelligence, trusted engineering execution, durable execution evidence, and read-only Docker inspection. It provides structured facts and provenance to coding agents; it is not a code-generation agent.

## Requirements and installation

- Node.js 20 or newer
- Git for repository identity and provenance
- The repository's existing package manager or Python tooling for execution capabilities
- Docker CLI and daemon access only when Docker inspection is requested

```bash
npm install
npm run build
```

Run the server over stdio with `npm start`. Set `DEVBRAIN_WORKSPACE_ROOT` to the directory DevBrain may inspect; it defaults to the process working directory.

```json
{
  "mcpServers": {
    "devbrain": {
      "command": "node",
      "args": ["C:/path/to/devbrain-mcp/dist/index.js"],
      "cwd": "C:/path/to/allowed/workspace",
      "env": { "DEVBRAIN_WORKSPACE_ROOT": "C:/path/to/allowed/workspace" }
    }
  }
}
```

## Phase 1 — Repository Intelligence

Phase 1 is non-mutating repository inspection:

- `devbrain_repo_map` returns a bounded structural map, detected stacks, workspaces, scripts, entry points, and configuration evidence.
- `devbrain_project_health` returns Git state, upstream divergence, hygiene observations, dependency-environment state, and red flags.
- `devbrain_git_history` returns bounded commit metadata and short statistics without patches.
- `devbrain_dependency_audit` inventories direct dependencies and reports update/vulnerability checks with explicit degraded states.
- `devbrain_find_todos` returns bounded TODO/FIXME/HACK/XXX locations while respecting Git ignore rules when available.

## Phase 2 — Trusted Execution & Evidence

Phase 2 adds four capability-oriented execution tools and observational Docker inspection:

- `devbrain_run_build`: runs an explicitly detected and approved build definition.
- `devbrain_run_tests`: runs an explicitly detected and approved full test definition.
- `devbrain_run_targeted_tests`: runs one validated repository-contained test target without accepting arbitrary extra arguments.
- `devbrain_run_lint`: runs an explicitly detected and approved lint definition.
- `devbrain_inspect_docker`: reports bounded Docker version, container status/health/ports, images, sanitized mount metadata, and deterministic Compose labels. It performs no lifecycle operation.

Execution inputs contain a repository path, an optional bounded timeout, and—for targeted tests—a repository-relative target. There is no arbitrary command MCP interface.

## Trusted Execution Model

**DevBrain Phase 2 does not sandbox repository-controlled code. Trusted build, test, and lint commands execute with the permissions of the DevBrain process. Trust authorization is the primary security boundary; command inspection and deny controls are defense-in-depth.**

Trust is capability-specific: approving `test` does not approve `build`, `targeted_test`, or `lint`. The MCP server can create an approval request but exposes no trust or approval tool, so an MCP client cannot grant itself execution authority.

### Repository Identity

Trust binds to the canonical repository location plus identity evidence derived from the repository's initial commit and remote identity. Replacing a repository at a previously trusted path changes its identity and does not inherit approval.

### External Trust Registry

Authoritative state is outside inspected repositories under `~/.devbrain/` (or `DEVBRAIN_HOME` when explicitly configured):

```text
~/.devbrain/
  trust-registry.json
  approvals/
  executions/<repository-id>/<execution-id>/
```

Do not copy this runtime state into a repository or commit it.

### Execution-Definition Pinning

Approval binds to repository identity, capability, invocation, working directory, repository-controlled definition, and its SHA-256 fingerprint. DevBrain rediscovers and fingerprints the definition before every run. A changed script or configuration returns `approval_required` and does not execute.

### Human Approval CLI

Review pending requests and approve only an exact definition you trust:

```bash
devbrain approval list
devbrain approval inspect apr_...
devbrain approve apr_...

devbrain trust list
devbrain trust inspect C:/path/to/repo
devbrain trust revoke C:/path/to/repo
devbrain trust revoke C:/path/to/repo test
```

The CLI is the administrative boundary. Approval is deliberately absent from MCP.

## Execution Pipeline

Every run follows separated stages:

```text
DISCOVER → RESOLVE → AUTHORIZE → EXECUTE → PARSE → EVIDENCE
```

Processes use executable-plus-argument arrays with `shell: false` and a canonical working directory. DevBrain does not install dependencies, modify configuration, create reporters, fix lint, format source, or run migrations. Approved repository scripts can still have their own side effects.

## Evidence Store

Every authorized run receives an immutable `executionId`. Its external evidence directory contains `metadata.json`, `result.json`, `stdout.log`, and `stderr.log`. Structured files use atomic writes, and stdout/stderr are stored separately with SHA-256 hashes. MCP responses return redacted tails capped at approximately 8 KiB per stream rather than full logs.

The provenance envelope records the exact executable and arguments, canonical cwd, timestamps, duration, exit code when available, Git SHA/branch/dirty state, platform/architecture, runtime and package-manager versions when available, and durable log paths/hashes.

## Dirty Worktree Semantics

`git.dirty: false` ties the evidence to the recorded commit under the captured environment. `git.dirty: true` means the run covered that SHA plus uncommitted working-tree state; it does not prove the clean commit passed. DevBrain reports this distinction and leaves acceptance policy to its caller.

## Timeout Policy

| Capability | Default | Hard ceiling |
| --- | ---: | ---: |
| Lint | 60 seconds | 5 minutes |
| Build | 5 minutes | 15 minutes |
| Targeted tests | 2 minutes | 10 minutes |
| Full tests | 10 minutes | 30 minutes |

Timeouts terminate the process tree, including descendant cleanup through `taskkill /T /F` on Windows. Execution state (`completed`, `timed_out`, or `execution_error`) remains separate from engineering result (`passed`, `failed`, `partial`, `unknown`, or `not_applicable`).

## Result Parsing / Parse Confidence

DevBrain attempts actual JSON reporter output, then actual JUnit XML, then framework text parsing, and finally exit-code-only or unknown interpretation. `json_reporter` and `junit_xml` are reported only when machine-readable content was parsed. Text-derived Vitest, Jest, and pytest counts use `text_regex` with medium confidence; unrecognized completed output falls back to `exit_code_only` with low confidence. Parsing never installs tooling or changes repository configuration.

## Docker Inspection

`devbrain_inspect_docker` may run only observational Docker commands. It cannot start, stop, restart, remove, execute in, build, pull, or push containers/images. Container environment values are not requested or returned, bind-mount sources are sanitized, and all collections are bounded.

**`devbrain_inspect_docker` is observational, but access to the Docker daemon may itself imply significant host privileges depending on platform and configuration.**

## Phase 3 — Context Intelligence & Governance

Phase 3 adds deterministic, local context retrieval and evidence packaging. DevBrain remains a capability layer: it can locate, bound, measure, redact, and package evidence, but it does not decide what code to change or whether a fix is correct.

- `devbrain_search_text` performs bounded literal repository search with optional file globs.
- `devbrain_search_symbols` locates TypeScript, JavaScript, and Python definitions with explicit resolution confidence.
- `devbrain_find_references` returns bounded textual symbol occurrences labelled as low-confidence textual evidence.
- `devbrain_read_file_slice` returns one canonical, line-numbered file range.
- `devbrain_read_symbol` returns one definition or an explicit ambiguity/not-found state.
- `devbrain_get_diff` returns structured working-tree, staged, commit, or range evidence with complete file statistics and a bounded patch.
- `devbrain_get_execution_evidence` retrieves bounded Phase 2 evidence by `executionId`, never by filesystem path.
- `devbrain_diagnose_log` extracts bounded errors, failing-test clues, chained causes, and file/line frames from stored execution logs.
- `devbrain_context_pack` persists and returns a deterministic evidence package under requested and hard budgets.

### Context Security Model

Repository content is untrusted data. Every returned repository item carries `source.type: repository_file` and `source.trust: untrusted_content`; execution-log diagnostics use the same untrusted-content discipline. Text such as “ignore previous instructions” is returned only as quoted repository evidence and is never executed or treated as an instruction by DevBrain.

Phase 3 uses no LLM, embedding model, vector database, remote semantic search, or network service. MCP supplies deterministic capabilities and evidence; Skills and callers retain judgment and sequencing.

### Bounded Retrieval and Context Budgets

Searches respect Git ignore rules when available and exclude `.git`, dependency environments, build output, coverage, caches, binaries, and generated directories. Canonical path checks reject traversal and symlink escape.

Hard ceilings apply even when callers request more:

| Resource | Hard ceiling |
| --- | ---: |
| Context-pack files | 20 |
| Lines | 3,000 |
| Bytes | 200,000 |
| Search matches | 200 |
| References | 200 |
| Diff patch | 150,000 bytes |

All bounded tools return explicit counts and truncation state. There is no unlimited or recursive whole-repository response mode.

### Symbol and Reference Resolution

Initial TypeScript, JavaScript, and Python symbol discovery uses deterministic language-specific syntax heuristics and reports `resolutionMethod: heuristic`, `confidence: medium`. Reference lookup is textual and reports low confidence; it does not claim semantic identity. Multiple definitions produce an ambiguity result rather than a guessed selection.

### Diagnostic Compression

Execution evidence retrieval returns normalized state, provenance, parser confidence, log sizes, and hashes without full logs. Diagnostic compression examines bounded stored logs for common Vitest, Jest, pytest, compiler, lint, stack-frame, and chained-exception patterns. Its extracted structure is heuristic and confidence-labelled; Phase 2 logs remain authoritative.

### Context Packs

Context packs rank only deterministic signals: explicit seed files/symbols, execution stack frames, working-tree diff files, and exact objective terms. Each included item records a selection reason, file/range, repository-content trust, redaction state, and content hash. Unexplained files are not included.

Every pack receives a `contextPackId` and stores a content-free manifest at:

```text
~/.devbrain/context-packs/<repository-id>/<context-pack-id>/manifest.json
```

The manifest records repository SHA/branch/dirty state, budgets, usage, selected ranges and reasons, hashes, exclusions, confidence, and file/line/byte metrics. It does not duplicate repository content. A dirty pack represents the recorded SHA plus working-tree state, not the clean commit alone.

Context metrics report repository, candidate, and included files/lines/bytes plus budget utilization. DevBrain does not claim token savings without model-specific tokenization.

### Secret Redaction and Prompt-Injection Boundary

Search results, slices, symbols, diffs, diagnostics, execution evidence, and context packs reuse shared secret redaction. Returned metadata indicates redaction without exposing detected values. Prompt-like repository prose remains visible only as provenance-labelled untrusted evidence so a caller can assess it without DevBrain obeying it.

### Phase 3 Known Limitations

- Symbol resolution is heuristic rather than AST/type-checker semantic analysis.
- Reference matches are textual and can include false positives.
- Diagnostic parsers cover common formats but cannot reconstruct every custom runner output.
- Context packs deliberately stop at deterministic evidence; they do not summarize, recommend edits, calculate change impact, or perform architecture analysis.
- Context-pack manifest persistence is DevBrain-owned external state, so that tool is non-idempotent even though it does not mutate the repository.

## Security Model and Limitations

- Canonical paths must remain under `DEVBRAIN_WORKSPACE_ROOT`; symlink escapes and invalid targeted-test paths are rejected.
- Command inspection blocks representative dangerous definitions but is not a sandbox.
- Secrets are redacted from returned content; full external logs remain sensitive local evidence and inherit host filesystem protections.
- Structured parsing depends on output the repository already produces. Otherwise DevBrain degrades honestly to text or exit-code evidence.
- Package-manager and runtime availability can make a capability unsupported or leave version provenance unknown.
- Docker results are a point-in-time observation, not proof of future health or isolation.

## Development

```bash
npm test
npm run lint
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

See [VERIFICATION.md](./VERIFICATION.md) for executed quality and acceptance evidence.
