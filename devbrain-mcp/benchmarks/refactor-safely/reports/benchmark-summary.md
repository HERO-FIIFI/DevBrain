# `/refactor-safely` Task A pilot report

**Status:** `BLOCKED`  
**Recommendation:** `REMEDIATE`  
**Measured runs completed:** 0

The pilot stopped at the exact-model preflight. No Skill forward-test, CONTROL session, DEVBrain session, Task B/C session, or extra repetition was launched.

## Model evidence

- Requested identifier: `gpt-5.6-sol`
- Resolved identifier: `UNKNOWN`
- Installed CLI: `codex-cli 0.149.0-alpha.4.3`
- Preflight result: `BLOCKED` — `codex exec --help` does not expose the planned `--ask-for-approval` flag.
- The live catalog lists `gpt-5.6-sol`, but catalog presence is not proof that a session resolved to that exact model.

Available identifiers reported by `codex debug models`:

- `gpt-reserve` (hidden)
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
- `gpt-5.5`
- `codex-auto-review` (hidden)

## Why execution did not continue

The mismatch is not safely fixed by merely removing one flag. This CLI documents `--ignore-user-config` as skipping `$CODEX_HOME/config.toml`, while the frozen treatment harness places its explicit DevBrain MCP entry in that run-private configuration. Continuing could therefore produce a nominal DEVBrain run without its intended treatment, invalidating the experiment.

The exact-model probe also never ran, so `resolvedModel` remains `null`, not `gpt-5.6-sol` and not zero-equivalent.

## Preserved evidence

- `model-preflight.json` — SHA-256 `98eacb2b2baeeae97a1848f656e8920a179ed07b7a95fefecabc7de62d81886a`
- `model-catalog-evidence.json` — concise catalog identifiers and visibility
- `pilot-approval.json` — approval scope and readiness commit

## Required remediation

Design and test a current-CLI invocation that preserves all frozen invariants: private configuration, strict CONTROL isolation, explicit DEVBrain-only MCP/Skill treatment, identical shared settings, `approval_policy=never`, and trustworthy requested/resolved model evidence. Because this changes the reviewed execution mechanism, obtain a new execution approval after remediation. Do not reuse this approval to run the pilot.
