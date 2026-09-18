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
