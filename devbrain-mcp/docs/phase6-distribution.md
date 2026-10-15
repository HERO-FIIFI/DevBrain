# Phase 6 distribution checklist

## Worktree decisions

| Worktree | State | Decision |
| --- | --- | --- |
| `phase5/distribution-environment-hardening` | complete, clean, `47972de` | Phase 6 baseline |
| `experiment/refactor-safely-pilot` | dirty, unfinished bug-hunt/UV experiments | preserved; not integrated |
| detached `DevBrain-phase4` | no unique work, frozen Phase 4 | preserved; no cherry-pick |

## Install contract

`npx -y devbrain-mcp@latest setup --yes` is project mode. It detects the Git root, installs a repository-keyed runtime below `~/.devbrain/installations`, probes the packaged server, edits only the DevBrain Codex section, validates the post-write handshake, and returns JSON with `schemaVersion`, package identity, scope, paths, preflight, handshake, tool count, restart, and verification fields. The runtime is persistent after npx exits and supports paths containing spaces. Global mode is not claimed.

## Release checklist

- [x] npm name `devbrain-mcp` is unregistered at preparation time.
- [x] `npm pack --dry-run` contains only README, package metadata, and `dist`.
- [x] clean temporary project/tarball install passes on Windows.
- [x] persistent launcher survives temporary runner/cache removal.
- [x] 26 MCP tools reconnect after fresh process.
- [x] production dependency audit has zero vulnerabilities.
- [ ] npm authentication/ownership confirmation.
- [ ] explicit publish authorization.

No npm publish, public release, or release tag is performed by Phase 6 preparation.
