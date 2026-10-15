# Completion record

Return this structure at the end of every refactor. Patch state and verification discipline are separate fields
because a correct patch that was not fully verified is a different outcome from a verified one, and a reviewer
needs to see which they are looking at.

```yaml
request: one sentence restating the refactor

repository:
  sha: from step 1
  dirtyBefore: true | false
  preExistingChanges: [files that were already modified before you started]

target:
  symbol: name
  file: repository-relative path
  resolution: complete | ambiguous-resolved-with-file | assumption
  lookAlikes: [names deliberately left unchanged]

preImpact:
  direct: [file or symbol ids]
  transitive: [...]
  interfaces: [routes / exported APIs]
  persistence: [tables / columns / migrations]
  tests: [...]
  truncated: true | false
  lowestConfidence: high | medium | low | unknown

contextPack:
  id: contextPackId
  files: n
  lines: n
  budgetExcludedItems: n
  sufficiency: sufficient | expanded
  expansions:
    - reason: one of the expansion reasons
      trigger: what failed
      tool: which tool
      file: path
      lines: [start, end]
      bytes: n

changedFiles:
  - path: ...
    why: definition | caller | adapter | test | contract

postImpact:
  unexpectedPaths: [paths not predicted by preImpact, each with what you did about it]
  oldNameRemainingHits: [each with why it is intentional]

verification:
  targeted: { executionId, result: passed | failed | approval_required | not_run }
  lint:     { executionId, result }
  build:    { executionId, result }
  full:     { executionId, result }
  diagnoses: [executionId -> frames used, fix applied]

patchState: complete | incomplete | blocked
verificationDiscipline:
  targetedRun: true | false
  lintRun: true | false
  buildRun: true | false
  fullRegressionRun: true | false

unresolvedRisks:
  - potential impact candidates that were not exercised by any test, described as potential
  - anything the static evidence could not settle

summary: two or three sentences a reviewer can act on
```

Wording rules for the summary and risks:

- Impact candidates are "may affect" or "potentially affected", never "breaks" unless a test proved it.
- `patchState: complete` requires every planned file changed, no unexplained diff, no unexplained old-name hit,
  and no failed verification. Anything else is `incomplete`, or `blocked` when a trust gate or an unresolvable
  ambiguity stopped the work.
- If a verification step did not run, say so in `verificationDiscipline` and in the summary. Do not describe an
  unverified patch as verified.
