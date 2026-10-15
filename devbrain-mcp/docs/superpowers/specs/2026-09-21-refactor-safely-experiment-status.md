# DevBrain `/refactor-safely` Experiment Status

**Frozen:** 2026-09-21  
**Phase 4 baseline:** `d2f92462a650123304d3d7c0f1c8c5acc6e4a249` (`v0.4.0-phase4`)  
**Experiment branch:** `experiment/refactor-safely-pilot`  
**Readiness evidence:** `ee4ef2df1ae80a8bceaf350ee18d19f0fb19bfce`  
**Status:** `BLOCKED — EXTERNAL OBSERVABILITY LIMITATION`

## Established

- `/refactor-safely` and the controlled benchmark harness are implemented.
- CONTROL isolation passes: its generated home exposes no MCP server or skill.
- DEVBrain isolation passes: its generated home exposes only DevBrain and `/refactor-safely`.
- Runtime parity and exact `never` approval policy pass.
- The requested literal model is `gpt-5.6-sol`; it is configured and present as a non-alias catalog entry.
- Benchmark tests, full DevBrain regression, lint, and build pass in the readiness evidence.
- Phase 4 remains frozen at 26 tools and 20 evaluations.
- No measured CONTROL or DEVBrain pilot run has occurred.

## Blocker and unknowns

The installed measured `codex exec --json` interface does not report a trustworthy actual-session resolved-model identifier. Configuration, catalog membership, command acceptance, and a successful response do not prove which model served the session. The frozen protocol requires exact requested/resolved equality before either condition starts, so the model gate remains closed.

Consequently:

- actual-session resolved model: `unknown`;
- CONTROL outcome: `unknown` because it was not run;
- DEVBrain outcome: `unknown` because it was not run;
- comparative context, correctness, discipline, and latency effects: `unknown`;
- A/B conclusion: **none**.

Unknown is not converted to zero and no result is inferred from readiness tests.

## Resume condition and sequence

Resume only when the actual measured session exposes trustworthy resolved-model evidence and a fresh execution approval is given. Resume at:

```text
model preflight
  -> execution approval
  -> Task A CONTROL repetition 1
  -> Task A DEVBrain repetition 1
  -> comparison report
  -> stop
```

Tasks B/C, additional repetitions, and the full benchmark remain unauthorized. Do not weaken the model gate, manufacture evidence, retry Task A, change the Phase 4 MCP implementation, or infer any benchmark conclusion while blocked.

