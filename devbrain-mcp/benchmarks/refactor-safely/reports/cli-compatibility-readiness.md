# DevBrain `/refactor-safely` CLI Compatibility Readiness

**Date:** 2026-09-21  
**Installed CLI:** `codex-cli 0.149.0-alpha.4.3`  
**Branch:** `experiment/refactor-safely-pilot`  
**Verdict:** **BLOCKED**

The launch/config adapter is compatible with the installed CLI and proves treatment isolation. The pilot still cannot be retried because this CLI's successful `codex exec --json` session does not expose a trustworthy resolved-model identifier. `gpt-5.6-sol` is configured, accepted, present as a non-alias catalog model, and produces a response, but those facts are not treated as actual-session resolution evidence.

No Task A repository was materialized and neither measured pilot condition was executed during remediation.

## Read-only capability discovery

The following installed surfaces were inspected successfully: `codex --version`, `codex --help`, `codex exec --help`, `codex mcp --help`, `codex mcp list --help`, `codex debug models --help`, `codex debug prompt-input --help`, `codex features --help`, `codex doctor --help`, and `codex app-server --help`. The machine-readable report records LF-normalized stdout byte lengths and SHA-256 hashes for every discovery result.

`codex exec` supports:

```text
--config, --enable, --disable, --strict-config, --image, --model,
--oss, --local-provider, --profile, --sandbox, --approve-for-me,
--dangerously-bypass-approvals-and-sandbox,
--dangerously-bypass-hook-trust, --cd, --add-dir, --thread-source,
--skip-git-repo-check, --ephemeral, --ignore-user-config,
--ignore-rules, --output-schema, --color, --json,
--output-last-message, --help, --version
```

It does not support the old assumed `exec --ask-for-approval` option. The top-level interactive command has an approval option, but that is not the non-interactive benchmark interface and is not substituted.

Supported inspection mechanisms used by the adapter are `doctor --json`, `mcp list --json`, `debug models`, and `debug prompt-input`.

## Old assumption to actual interface

| Old assumption | Installed interface | Outcome |
|---|---|---|
| `exec --ask-for-approval never` | `approval_policy = "never"` in isolated `config.toml`; `doctor --json` reports `Never` | Exact policy, remediated |
| `--ignore-user-config` while retaining treatment | Run-private `CODEX_HOME` with generated `config.toml`; omit that flag | Isolation and treatment both preserved |
| `debug models` returns one ID per line | JSON object containing `models` | Parser corrected |
| `doctor` names workspace-write directly | It summarizes filesystem access as `restricted` | Exact `--sandbox workspace-write` argument plus config are retained as request evidence |
| Exec JSONL reports actual model | Four normal events, no model field | **Blocking** |

## Shared launch and condition configurations

Both conditions use this same launch surface:

```text
codex exec --model gpt-5.6-sol --json --ephemeral --strict-config
  --sandbox workspace-write --ignore-rules <VISIBLE_TASK>
```

Both generated configs explicitly set approval `never`, sandbox `workspace-write`, web search disabled, workspace network disabled, shell environment inheritance `none`, and unrelated apps/remote-plugin/multi-agent features disabled. Each session receives a fresh run-private `CODEX_HOME`; the ordinary user configuration is outside that tree.

CONTROL's generated home contains only `config.toml`. Live inspection found zero enabled MCP servers and zero model-visible skills.

DEVBrain receives the identical common config plus one required `devbrain` MCP entry and one enabled copied `refactor-safely` skill. Its copied skill excludes evaluation scenarios. Live inspection found exactly the `devbrain` server and exactly `refactor-safely`, with no unrelated server or skill.

The normalized invocation-equivalence tests permit only the frozen treatment fields: `treatment.mcpConfiguration` and `treatment.skillInstruction`.

## Approval-policy equivalence

The harness does not use `--approve-for-me`, because that would be a different policy. It expresses `never` through the configuration interface this exec version actually supports. `doctor --json` reported `Never` independently for both isolated condition homes. Both also reported configured model `gpt-5.6-sol` and restricted network access.

## Model-resolution gate

`debug models` and the cache expose the literal `gpt-5.6-sol` entry with no alias mapping. A fresh non-benchmark one-word probe exited zero and returned `OK`. Its JSONL event sequence was:

```text
thread.started -> turn.started -> item.completed -> turn.completed
```

The only top-level fields across those events were `type`, `thread_id`, `item`, and `usage`; neither JSONL nor stderr contained a model field. The app-server schema does describe a model on app-server thread responses, but that is a different launch/session interface and cannot prove the model used by a `codex exec` measured session.

Therefore:

```yaml
requestedModel: gpt-5.6-sol
configuredModel: gpt-5.6-sol
catalogMembership: exact, non-alias
resolvedModelForActualExecSession: null
confidence: unknown
```

Unknown is not converted to zero or inferred from successful command acceptance. The frozen model gate correctly remains closed.

## Verification

- Benchmark tests: **PASS**, 17 files / 140 tests.
- Full DevBrain tests: **PASS**, 44 files / 261 tests.
- Lint: **PASS**.
- Build: **PASS**.
- MCP registration/evaluations: unchanged at 26 tools / 20 evaluations.
- `git diff v0.4.0-phase4 -- src evals.xml`: empty.
- `master` and `v0.4.0-phase4`: both still resolve to `d2f92462a650123304d3d7c0f1c8c5acc6e4a249`.
- Existing blocked-attempt report artifacts: byte-unchanged relative to `e9700d0`.

## Commits and state

- `e9700d0cecb33e6534814041922ca2ae14274db8` — immutable blocked-attempt evidence.
- `08f97c1` — installed CLI launch/config compatibility remediation.
- `071f01e` — validated user cleanup removing an unused treatment binding; no behavior change.
- The compatibility report is committed separately after verification; no push is performed.

## Decision

**BLOCKED.** Isolation, runtime parity, and exact approval behavior are ready, but the installed measured `codex exec` interface supplies no trustworthy evidence of its actual resolved model. Task A must not be retried unless a reliable actual-session mechanism becomes available and a new retry approval is given.
