# DevBrain

Evidence-backed repository intelligence and trusted execution for coding agents.

DevBrain is a local [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that gives coding agents bounded, machine-readable evidence about a repository: structure, dependencies, symbols, architecture, change impact, execution results, and provenance.

It is not an autonomous coding agent. DevBrain supplies facts and controlled capabilities; the agent, reviewer, or developer remains responsible for deciding what to change.

## Install

```bash
npx -y devbrain-mcp@rc setup --yes
```

Run setup from the target Git repository. It configures the MCP server for that workspace. Verify the installation with:

```bash
npx -y devbrain-mcp@rc doctor --json
```

## Documentation

- [Package README](./devbrain-mcp/README.md) — tools, configuration, and usage
- [Lifecycle administration](./devbrain-mcp/docs/phase5-lifecycle.md)
- [Distribution architecture](./devbrain-mcp/docs/phase6-distribution.md)
- [Verification evidence](./devbrain-mcp/VERIFICATION.md)
- [Project website](https://hero-fiifi.github.io/DevBrain/)

## Status

Current package line: `0.6.0-rc.1`.

This is a release candidate. Review the verification record and security boundaries before enabling trusted execution in a new environment.
