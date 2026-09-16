# DevBrain MCP

DevBrain is a local repository-intelligence MCP server. It gives coding agents bounded, structured, evidence-backed facts about a repository; it is not a code-generation agent.

Phase 1 keeps a strict boundary: **MCP tools provide capabilities and data; future Skills will orchestrate tools and make engineering judgments.** No build, test, deployment, browser, database, or production-readiness actions are included.

## Requirements and installation

- A supported Node.js LTS release (20 or newer)
- Git for repository-aware results
- The relevant package manager when dependency update/audit checks are requested

```bash
npm install
npm run build
```

## Running over stdio

```bash
npm start
```

The server writes MCP traffic to stdout. Set `DEVBRAIN_WORKSPACE_ROOT` to the directory DevBrain may inspect; it defaults to the process working directory.

Example MCP client configuration:

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

## Tools

### `devbrain_repo_map`

Input: optional `path`. Returns the canonical repository root, languages, package managers, frameworks, workspace structure, scripts, entry points, important configuration, top-level directories, and detection evidence. It is a bounded high-level map, not a file dump. A non-Git directory is mapped as the requested root with explicit partial Git behavior in other tools.

### `devbrain_project_health`

Input: optional `path`. Returns branch/detached state, working-tree counts, upstream divergence, last commit metadata, basic repository hygiene, dependency-environment observations, and red-flag labels. Environment freshness is conservative (`present`, `missing`, `possibly_stale`, or unknown); it does not make deployment decisions.

### `devbrain_git_history`

Inputs: optional `path`, `since`, `author`, and repository-relative `historyPath`; `limit` defaults to 20 and is capped at 100. Returns commit metadata and short statistics without patch contents. Non-Git directories return `unsupported`.

### `devbrain_dependency_audit`

Inputs: optional `path` and bounded `limit`. Returns direct dependency inventory independently from update and vulnerability checks. npm, pnpm, Yarn, pip, and Poetry are detected. Network/tooling failures produce explicit `offline`, `not_run`, `unsupported`, or `error` sub-results and never become zero findings. Yarn and Poetry checks are intentionally limited where no stable structured command is available.

### `devbrain_find_todos`

Inputs: optional `path`, literal marker `pattern`, and `limit` (default 100, maximum 500). Searches repository-owned text source files for TODO/FIXME/HACK/XXX by default, respects Git ignore rules when Git is available, and returns file/line/column/tag with short context and grouped totals.

## Security model

Phase 1 is read-only. All input paths are resolved canonically and must remain under the allowed workspace; symlink escapes are rejected. External processes use executable-plus-argument arrays with `shell: false`, timeouts, and stdout/stderr limits. Tool output passes through shared secret redaction and never intentionally returns environment values or `.env` contents. Results and summaries are bounded.

Dependency update and vulnerability checks may contact package registries or advisory services and therefore advertise `openWorldHint: true`. The other four tools do not.

## Development

```bash
npm test
npm run lint
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

Fixtures cover npm/React, pnpm workspaces, pip/FastAPI, Poetry/Django, mixed stacks, unknown ecosystems, lockfile conflicts, and TODO markers. See [VERIFICATION.md](./VERIFICATION.md) for the latest executed quality-gate evidence.
