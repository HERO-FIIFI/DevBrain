# Evidence contract

How DevBrain evidence is read, when a Context Pack is enough, and how every expansion beyond it is recorded.

## Classification and confidence

DevBrain labels each relationship and impact candidate:

| Field | Values | Meaning |
|---|---|---|
| `classification` | `observed` | Seen directly in the source (an import, a call, a route declaration). |
| | `inferred` | Derived by a deterministic heuristic (a test that references a component, a layer guess). |
| | `potential` | May be affected if the seed changes; nothing has shown that it is. |
| `confidence` | `high`, `medium`, `low`, `unknown` | How reliable the resolution method was. |
| `resolutionMethod` | e.g. `static_import`, `textual`, `heuristic` | What produced the evidence. |

Consequences for decisions:

- `observed`/`high` evidence can be acted on directly.
- `inferred` or `medium` evidence needs one corroborating slice before you edit based on it.
- `low` or `potential` evidence is a place to look, never a place to edit blindly and never a claim of breakage.
- `unknown` is unknown. Do not treat it as zero and do not treat it as a reason to read the whole repository.

## Static versus runtime

Everything DevBrain returns is static. A declared route is not a route proven reachable; a repository schema is
not the production database; a static call is not an execution; a test that references a symbol is not behavioral
coverage. Verification (steps 9 and 10) is the only runtime evidence in this workflow.

## Context Pack sufficiency

A pack is sufficient only when every applicable criterion holds. Check them against the pack and the pre-change
impact result, in this order.

| # | Criterion | Where to look | Unmet when |
|---|---|---|---|
| 1 | Target definition is file-qualified | `devbrain_read_symbol` `status`, `file` | status is `ambiguous`, `not_found`, or the pack has no item for the definition |
| 2 | Direct dependents and relevant tests are present, or the evidence explicitly supports none | pack `items`, impact `impacts` with category `direct`/`test` | an impact candidate has no corresponding pack item and no reason to be excluded |
| 3 | Target ambiguity is resolved | `candidates` | more than one candidate remains and no file qualifier was applied; low textual confidence alone does not resolve it |
| 4 | Directly relevant impact paths are not truncated | impact `truncated`, `totalCandidates` vs returned | `truncated: true` and the missing candidates could be direct dependents |
| 5 | No directly relevant candidate was budget-excluded | pack `excluded.budgetExcludedItems` | greater than zero and the excluded candidates include a dependent or test |
| 6 | Medium heuristic symbol evidence is corroborated | symbol `resolutionMethod`, `confidence` | `heuristic`/`medium` without a bounded definition slice plus caller or import evidence |
| 7 | Remaining unknowns are recorded and do not require broad exploration | your own notes | an unknown could only be resolved by reading files without a specific reason |

If a criterion fails, expand only toward it. Examples:

- #3 fails: call `devbrain_read_symbol` with the `file` that matches the request; do not read every candidate.
- #4 fails: call `devbrain_find_references` or `devbrain_change_impact` with a larger `maxResults`/depth for the
  seed, not for the repository.
- #5 fails: call `devbrain_context_pack` again with a larger budget or `devbrain_read_file_slice` for the excluded
  candidate.
- #6 fails: `devbrain_read_file_slice` around the definition and one `devbrain_find_references` call.

If all criteria hold, broad rereading is prohibited. Permitted reads after that point are diff-driven (step 7),
failure-driven (a `devbrain_diagnose_log` frame), or evidence-driven (a post-change impact path you did not
predict). Each is still bounded to the file range the trigger names.

## Expansion record

Every read beyond the Context Pack is recorded with:

```yaml
reason: truncation | ambiguity | low_confidence | unresolved_import | missing_impact_path | budget_exclusion | test_failure | unexpected_post_impact | diff_mismatch
trigger: the evidence that failed a criterion (tool, field, value) or the failing frame / unexpected path
tool: the DevBrain tool or shell command used to expand
file: repository-relative path
lines: [start, end]
bytes: bytes returned
```

An expansion without a reason from this list is unbounded exploration and must not happen. Reads that do not fit
the list are not forbidden because they are useless; they are forbidden because the reason would be invented after
the fact, and an invented reason cannot be reviewed.

## Trust gates

`devbrain_run_*` tools may return `approval_required`. The approval is granted outside the agent by a human with
the `devbrain approve` CLI. Running the same command through the shell to avoid the gate defeats the reason the
gate exists (pinned execution definitions and durable evidence). Report the approval id and stop.
