# DevBrain lifecycle administration

Phase 5 adds lifecycle commands to the existing `devbrain` executable. Build DevBrain first with `npm run build`, then invoke `node dist/admin.js ...` from this checkout or use the installed `devbrain` bin.

## Setup

From a Git repository:

```powershell
devbrain setup --server "C:/path/to/devbrain-mcp/dist/index.js"
```

Setup discovers the Git root, chooses `<git-root>/.codex/config.toml` by default, resolves Node, performs an actual MCP initialization and `tools/list` probe, and prints the proposed change. It does not write without explicit authorization:

```powershell
devbrain setup --server "C:/path/to/devbrain-mcp/dist/index.js" --yes
```

Use `--workspace`, `--config`, or `--server` to select supported explicit inputs. Use `--dry-run` to generate the complete plan without writing. DevBrain never newly installs `required = true` unless critical path, runtime, launch, and MCP preflight checks pass.

## Doctor

```powershell
devbrain doctor
devbrain doctor --json
```

Doctor is read-only by default. It reports stable checks DB001?DB011 for server, cwd, environment workspace, Git root policy, Node, MCP initialization, configuration collisions, TOML validity, unrelated-setting preservation, and safe required activation.

Results and exit codes:

| Exit | Result | Meaning |
| ---: | --- | --- |
| 0 | `READY` | Critical checks pass and there are no warnings. |
| 1 | `READY_WITH_WARNINGS` | Critical checks pass; operator review is needed. |
| 2 | `NOT_READY` / validation failure | A supported configuration or preflight check failed. |
| 3 | internal lifecycle failure | The command or host failed outside a supported validation condition. |

A parent workspace containing one nested Git repository produces an explicit warning and identifies the Git root. It is not silently treated as corruption.

## Repair

```powershell
devbrain doctor --repair --dry-run
devbrain doctor --repair --yes
```

Repair is conservative. It prints the current value, proposed value, reason, file, and backup location. It repairs both `cwd` and `DEVBRAIN_WORKSPACE_ROOT` together only when Git independently verifies the replacement repository root. A duplicated segment such as `Documents/Documents` is evidence of a bad configured path; it is never repaired through string replacement.

Before mutation DevBrain parses the candidate, completes preflight, and creates a timestamped sibling backup. Writes use a same-directory temporary file, fsync, atomic rename, reread validation, and rollback. A failed post-write check restores the exact original bytes where the filesystem permits.

## Uninstall

```powershell
devbrain uninstall --dry-run
devbrain uninstall --yes
```

Uninstall backs up the selected config and removes only:

```toml
[mcp_servers.devbrain]
[mcp_servers.devbrain.env]
```

Other MCP servers, project trust, comments, settings, and DevBrain user data are preserved.

## Configuration discovery and precedence

DevBrain inspects only bounded supported locations: the user/global Codex config, selected workspace, verified repository, and applicable parent `.codex/config.toml` files. It reports equivalent duplicates as warnings and conflicting applicable definitions as failures. It does not scan the whole filesystem or modify unrelated definitions.

The lifecycle TOML reader deliberately supports the scalar/array forms needed by Codex MCP configuration. Malformed or unsupported input is refused rather than rewritten speculatively.

## Windows and recovery

- Spaces, Unicode, forward slashes, backslashes, mixed separators, relative segments, drive-letter variants, and filesystem canonicalization are covered.
- Existing symlinks/junctions resolve through the host filesystem; config-file symlink replacement is refused.
- If Codex cannot start because a required DevBrain entry is invalid, run doctor directly through the built admin script, select the affected config with `--config`, and use `--repair --dry-run` before authorizing repair.
- A backup path is printed before every supported mutation. Restore that exact backup manually if host-level failure prevents automatic rollback.

**A user should not need to inspect Codex databases, WAL files, VS Code internal state, or session storage to diagnose a supported DevBrain configuration failure.**

## Security boundary

Configuration and paths are untrusted. Doctor never executes `command` or `args` copied from TOML. Probes use only the independently selected Node runtime and server file, literal argument arrays, `shell: false`, bounded output/time, process-tree cleanup, and redacted diagnostics. Probe success is point-in-time evidence and does not guarantee a later IDE process has identical permissions or environment.

