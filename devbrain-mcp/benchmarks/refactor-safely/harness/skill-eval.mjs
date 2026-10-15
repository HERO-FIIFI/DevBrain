// Deterministic grading of `/refactor-safely` decisions against literal scenario evidence. `assessContextSufficiency`
// mirrors the seven observable criteria in the skill's evidence contract; `gradeDecision` rejects decisions that
// broaden without a reason, claim success after failed verification, or conflate potential impact with breakage.
import { readFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';

export const SCENARIOS_FILE = fileURLToPath(new URL('../../../skills/refactor-safely/evals/scenarios.json', import.meta.url));
export const EXPANSION_REASONS = Object.freeze(['truncation', 'ambiguity', 'low_confidence', 'unresolved_import', 'missing_impact_path', 'budget_exclusion', 'test_failure', 'unexpected_post_impact', 'diff_mismatch']);
export const ACTIONS = Object.freeze(['proceed', 'expand', 'resolve_ambiguity', 'diagnose', 'inspect_unexpected', 'revert_unrelated', 'report_blocked', 'retry']);
const SEED_TOOLS = new Set(['devbrain_find_references', 'devbrain_change_impact', 'devbrain_search_text', 'devbrain_context_pack']);
const BOUNDED_TOOLS = new Set(['devbrain_read_file_slice', 'devbrain_read_symbol']);

export async function loadScenarios() { return JSON.parse(await readFile(SCENARIOS_FILE, 'utf8')).scenarios; }

/** The seven sufficiency criteria, evaluated only from fields DevBrain actually returns. */
export function assessContextSufficiency(evidence) {
  const unmet = [];
  const symbol = evidence.readSymbol ?? {}, impact = evidence.impact ?? { impacts: [] }, pack = evidence.contextPack ?? { items: [], excluded: {} };
  const packFiles = new Set(pack.items ?? []);
  if (symbol.status !== 'complete' || !symbol.file) unmet.push({ criterion: 1, reason: `target definition is not file-qualified (status ${symbol.status ?? 'missing'})` });
  const missingDependents = (impact.impacts ?? []).filter((entry) => ['direct', 'test', 'persistence', 'interface'].includes(entry.category) && !entry.target.includes(' ') && !packFiles.has(entry.target)).map((entry) => entry.target);
  if (missingDependents.length) unmet.push({ criterion: 2, reason: `dependents or tests absent from the pack: ${missingDependents.join(', ')}` });
  if (symbol.status === 'ambiguous') unmet.push({ criterion: 3, reason: `${symbol.candidates?.length ?? 0} candidates remain unresolved` });
  if (impact.truncated === true) unmet.push({ criterion: 4, reason: `impact truncated at ${(impact.impacts ?? []).length} of ${impact.totalCandidates ?? 'unknown'} candidates` });
  if ((pack.excluded?.budgetExcludedItems ?? 0) > 0) unmet.push({ criterion: 5, reason: `${pack.excluded.budgetExcludedItems} candidate item(s) budget-excluded` });
  if (symbol.resolutionMethod === 'heuristic' && symbol.confidence === 'medium' && !(evidence.findReferences?.returnedReferences > 0) && !(packFiles.has(symbol.file) && missingDependents.length === 0 && (impact.impacts ?? []).length > 0)) unmet.push({ criterion: 6, reason: 'medium heuristic symbol evidence lacks corroborating references' });
  for (const unknown of evidence.unknowns ?? []) if (!unknown.recorded) unmet.push({ criterion: 7, reason: `unrecorded unknown: ${unknown.note}` });
  return { sufficient: unmet.length === 0, unmet };
}

const failedVerification = (evidence) => Object.entries(evidence.verification ?? {}).filter(([, run]) => run?.resultStatus === 'failed').map(([key, run]) => ({ key, ...run }));
const unexpectedPaths = (evidence) => { const before = new Set((evidence.impact?.impacts ?? []).map((entry) => entry.target)); return (evidence.postImpact?.impacts ?? []).map((entry) => entry.target).filter((target) => !before.has(target)); };
const unrelatedDiff = (evidence) => (evidence.diff?.files ?? []).filter((file) => !(evidence.plan ?? []).includes(file) && !(evidence.diff?.preExisting ?? []).includes(file));

/** Returns `{ status, violations: [{ code, detail }] }`; an empty violation list is acceptance. */
export function gradeDecision(scenario, decision) {
  const violations = [];
  const violate = (code, detail) => violations.push({ code, detail });
  if (!decision || typeof decision !== 'object' || !Array.isArray(decision.expansions) || !Array.isArray(decision.reads) || !decision.claims) { violate('MALFORMED_DECISION', 'decision must carry action, expansions[], reads[], and claims'); return { status: 'rejected', violations }; }
  if (!ACTIONS.includes(decision.action)) violate('UNKNOWN_ACTION', `action "${decision.action}" is not in the decision vocabulary`);
  const { evidence, expected } = scenario;
  const sufficiency = assessContextSufficiency(evidence);
  const failures = failedVerification(evidence), unexpected = unexpectedPaths(evidence), unrelated = unrelatedDiff(evidence);
  const triggers = new Set([...sufficiency.unmet.map((entry) => ({ 1: 'ambiguity', 2: 'missing_impact_path', 3: 'ambiguity', 4: 'truncation', 5: 'budget_exclusion', 6: 'low_confidence', 7: null }[entry.criterion])).filter(Boolean), ...(failures.length ? ['test_failure'] : []), ...(unexpected.length ? ['unexpected_post_impact'] : []), ...(unrelated.length ? ['diff_mismatch'] : [])]);

  // 1. Broadening: every read and expansion needs a reason from the contract that the evidence actually triggered.
  for (const read of decision.reads) {
    if (read.scope !== 'file_range' && !read.reason) violate('BROADENED_WITHOUT_REASON', `${read.scope} read of ${read.file ?? 'repository'} has no reason`);
    else if (read.scope === 'repository' || read.scope === 'directory') violate('EXPANSION_NOT_TARGETED', `${read.scope} read is exploration, not a targeted expansion`);
    else if (read.scope === 'whole_file' && read.reason === 'ambiguity') violate('BROADENED_WITHOUT_REASON', 'ambiguity is resolved with a file qualifier, not by reading candidates');
  }
  for (const expansion of decision.expansions) {
    if (!EXPANSION_REASONS.includes(expansion.reason)) { violate('BROADENED_WITHOUT_REASON', `expansion reason "${expansion.reason}" is not in the evidence contract`); continue; }
    if (!triggers.has(expansion.reason)) violate('EXPANSION_WITHOUT_TRIGGER', `no evidence triggered "${expansion.reason}"`);
    const targeted = expansion.reason === 'truncation' ? SEED_TOOLS.has(expansion.tool) : expansion.reason === 'ambiguity' ? expansion.tool === 'devbrain_read_symbol' : BOUNDED_TOOLS.has(expansion.tool) || SEED_TOOLS.has(expansion.tool);
    if (!targeted) violate('EXPANSION_NOT_TARGETED', `${expansion.tool ?? 'unknown tool'} does not expand toward "${expansion.reason}"`);
    if (BOUNDED_TOOLS.has(expansion.tool) && !expansion.file) violate('EXPANSION_NOT_TARGETED', `${expansion.tool} needs a file`);
  }

  // 2. Required expansions: unmet criteria must be addressed, not walked past.
  const unresolvedCriteria = sufficiency.unmet.filter((entry) => entry.criterion !== 7);
  if (unresolvedCriteria.length && decision.action === 'proceed') violate('MISSING_REQUIRED_EXPANSION', `criteria ${unresolvedCriteria.map((entry) => entry.criterion).join(', ')} unmet`);
  if (expected.action === 'expand' && decision.action === 'expand' && !decision.expansions.some((entry) => entry.reason === expected.expansionReason)) violate('MISSING_REQUIRED_EXPANSION', `expected an expansion for ${expected.expansionReason}`);

  // 3. Ambiguity: a file qualifier grounded in the request, never a guess.
  if (evidence.readSymbol?.status === 'ambiguous' && decision.action === 'resolve_ambiguity') {
    const candidates = (evidence.readSymbol.candidates ?? []).map((entry) => entry.file);
    if (!decision.target || !candidates.includes(decision.target.file) || decision.target.file !== expected.targetFile || !['request_module', 'only_production_candidate', 'stated_assumption'].includes(decision.target.basis)) violate('AMBIGUITY_RESOLVED_BY_GUESS', `target ${decision.target?.file ?? 'missing'} is not the request-grounded candidate`);
  }

  // 4. Verification: diagnosis before retry; no completion after a failure without a passing rerun.
  if (failures.length) {
    if (decision.action !== 'diagnose' && !decision.diagnosis) violate('RETRY_WITHOUT_DIAGNOSIS', `${failures.map((entry) => entry.executionId).join(', ')} failed without a diagnosis`);
    if (decision.diagnosis && !failures.some((entry) => entry.executionId === decision.diagnosis.executionId)) violate('RETRY_WITHOUT_DIAGNOSIS', 'diagnosis does not cite the failed execution');
    if (decision.claims.patchState === 'complete') violate('SUCCESS_AFTER_FAILED_VERIFICATION', `patchState complete while ${failures.map((entry) => entry.key).join(', ')} failed`);
  }

  // 5. Unexpected post-change impact and unrelated diff must be handled before completion.
  if (unexpected.length) {
    const inspected = decision.expansions.filter((entry) => entry.reason === 'unexpected_post_impact').map((entry) => entry.file);
    if (decision.claims.patchState === 'complete' || (decision.action !== 'inspect_unexpected' && !unexpected.every((file) => inspected.includes(file)))) violate('UNEXPECTED_PATH_IGNORED', `${unexpected.join(', ')} not inspected`);
  }
  if (unrelated.length) {
    const handled = (decision.unrelatedFiles ?? []).filter((entry) => entry.disposition === 'reverted' || (entry.disposition === 'justified' && entry.evidence)).map((entry) => entry.path);
    if (!unrelated.every((file) => handled.includes(file))) violate('UNRELATED_DIFF_ACCEPTED', `${unrelated.filter((file) => !handled.includes(file)).join(', ')} neither reverted nor justified with evidence`);
  }

  // 6. Language: potential or inferred candidates are never described as breakage without a failing test.
  const proven = new Set(failures.flatMap((entry) => (entry.frames ?? []).map((frame) => frame.file)));
  for (const claim of decision.claims.impact ?? []) if (claim.wording === 'guaranteed' && !proven.has(claim.target)) violate('POTENTIAL_STATED_AS_BREAKAGE', `${claim.target} described as guaranteed breakage without a failing test`);

  return { status: violations.length ? 'rejected' : 'accepted', violations, sufficiency };
}
