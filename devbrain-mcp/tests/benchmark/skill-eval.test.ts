import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPANSION_REASONS, assessContextSufficiency, gradeDecision, loadScenarios } from '../../benchmarks/refactor-safely/harness/skill-eval.mjs';

const byId = async (id: string) => (await loadScenarios()).find((scenario: any) => scenario.id === id);
const violations = (scenario: any, decision: any) => gradeDecision(scenario, decision).violations.map((entry: any) => entry.code);
const accepted = (scenario: any, decision: any) => gradeDecision(scenario, decision).status === 'accepted';

describe('scenario records', () => {
  it('loads exactly the eight scenarios the plan names', async () => {
    const scenarios = await loadScenarios();
    expect(scenarios.map((scenario: any) => scenario.id)).toEqual(['straightforward', 'ambiguous_symbol', 'truncated_references', 'low_confidence_impact', 'targeted_test_failure', 'unexpected_post_impact', 'unrelated_diff', 'full_regression_failure']);
    const raw = JSON.parse(await readFile(path.join(process.cwd(), 'skills', 'refactor-safely', 'evals', 'scenarios.json'), 'utf8'));
    expect(raw.skill).toBe('refactor-safely');
  });
  it('bounds the expansion reason vocabulary to the evidence contract', () => {
    expect(EXPANSION_REASONS).toEqual(['truncation', 'ambiguity', 'low_confidence', 'unresolved_import', 'missing_impact_path', 'budget_exclusion', 'test_failure', 'unexpected_post_impact', 'diff_mismatch']);
  });
});

describe('observable Context Pack sufficiency', () => {
  it('returns the unmet criteria each scenario declares', async () => {
    for (const scenario of await loadScenarios()) {
      const result = assessContextSufficiency(scenario.evidence);
      expect(result.sufficient, scenario.id).toBe(scenario.expected.sufficient);
      expect(result.unmet.map((entry: any) => entry.criterion), scenario.id).toEqual(scenario.expected.unmet);
    }
  });
  it('treats budget exclusion of a dependent as unmet criterion 5', async () => {
    const scenario = await byId('straightforward');
    const evidence = { ...scenario.evidence, contextPack: { ...scenario.evidence.contextPack, items: ['src/auth/auth-service.js'], excluded: { budgetExcludedItems: 3 } } };
    expect(assessContextSufficiency(evidence).unmet.map((entry: any) => entry.criterion)).toEqual([2, 5]);
  });
  it('treats an unrecorded unknown as unmet criterion 7 without licensing exploration', async () => {
    const scenario = await byId('straightforward');
    const result = assessContextSufficiency({ ...scenario.evidence, unknowns: [{ note: 'dynamic dispatch in plugins', recorded: false }] });
    expect(result.unmet).toEqual([{ criterion: 7, reason: 'unrecorded unknown: dynamic dispatch in plugins' }]);
  });
});

describe('decision grading', () => {
  it('accepts proceeding on sufficient evidence and rejects broadening without a reason', async () => {
    const scenario = await byId('straightforward');
    expect(accepted(scenario, { action: 'proceed', expansions: [], reads: [], claims: { patchState: null, impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'expand', expansions: [{ reason: 'curiosity', tool: 'devbrain_read_file_slice', file: 'src/auth/auth-service.js', lines: [1, 80] }], reads: [], claims: { patchState: null, impact: [] } })).toContain('BROADENED_WITHOUT_REASON');
    expect(violations(scenario, { action: 'proceed', expansions: [], reads: [{ scope: 'repository' }], claims: { patchState: null, impact: [] } })).toContain('BROADENED_WITHOUT_REASON');
    expect(violations(scenario, { action: 'proceed', expansions: [], reads: [{ scope: 'whole_file', file: 'src/http/auth-middleware.js' }], claims: { patchState: null, impact: [] } })).toContain('BROADENED_WITHOUT_REASON');
    expect(violations(scenario, { action: 'expand', expansions: [{ reason: 'truncation', tool: 'devbrain_find_references', file: null, lines: null }], reads: [], claims: { patchState: null, impact: [] } })).toContain('EXPANSION_WITHOUT_TRIGGER');
  });
  it('requires ambiguity to be resolved with a file qualifier, not by reading every candidate', async () => {
    const scenario = await byId('ambiguous_symbol');
    expect(accepted(scenario, { action: 'resolve_ambiguity', target: { file: 'src/auth/auth-service.js', basis: 'request_module' }, expansions: [{ reason: 'ambiguity', tool: 'devbrain_read_symbol', file: 'src/auth/auth-service.js', lines: null }], reads: [], claims: { patchState: null, impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'proceed', expansions: [], reads: [], claims: { patchState: null, impact: [] } })).toContain('MISSING_REQUIRED_EXPANSION');
    expect(violations(scenario, { action: 'resolve_ambiguity', target: { file: 'tests/helpers/fake-auth.js', basis: 'request_module' }, expansions: [], reads: [], claims: { patchState: null, impact: [] } })).toContain('AMBIGUITY_RESOLVED_BY_GUESS');
    expect(violations(scenario, { action: 'resolve_ambiguity', target: { file: 'src/auth/auth-service.js', basis: 'request_module' }, expansions: [], reads: [{ scope: 'whole_file', file: 'src/auth/auth-service.js', reason: 'ambiguity' }, { scope: 'whole_file', file: 'tests/helpers/fake-auth.js', reason: 'ambiguity' }], claims: { patchState: null, impact: [] } })).toContain('BROADENED_WITHOUT_REASON');
  });
  it('requires truncation to expand toward the seed with a reference or impact tool', async () => {
    const scenario = await byId('truncated_references');
    expect(accepted(scenario, { action: 'expand', expansions: [{ reason: 'truncation', trigger: 'impact.truncated', tool: 'devbrain_find_references', file: null, lines: null }], reads: [], claims: { patchState: null, impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'expand', expansions: [{ reason: 'truncation', trigger: 'impact.truncated', tool: 'shell', file: 'src', lines: null }], reads: [{ scope: 'directory', file: 'src', reason: 'truncation' }], claims: { patchState: null, impact: [] } })).toContain('EXPANSION_NOT_TARGETED');
    expect(violations(scenario, { action: 'proceed', expansions: [], reads: [], claims: { patchState: null, impact: [] } })).toContain('MISSING_REQUIRED_EXPANSION');
  });
  it('rejects conflating low-confidence potential impact with breakage', async () => {
    const scenario = await byId('low_confidence_impact');
    const good = { action: 'expand', expansions: [{ reason: 'low_confidence', trigger: 'readSymbol.confidence=medium', tool: 'devbrain_read_file_slice', file: 'db/schema.sql', lines: [1, 8] }, { reason: 'low_confidence', trigger: 'impact.confidence=low', tool: 'devbrain_find_references', file: null, lines: null }], reads: [], claims: { patchState: null, impact: [{ target: 'GET /members/:id', wording: 'potential' }] } };
    expect(accepted(scenario, good)).toBe(true);
    expect(violations(scenario, { ...good, claims: { patchState: null, impact: [{ target: 'GET /members/:id', wording: 'guaranteed' }] } })).toContain('POTENTIAL_STATED_AS_BREAKAGE');
    expect(violations(scenario, { action: 'expand', expansions: [{ reason: 'low_confidence', trigger: 'impact.confidence=low', tool: 'shell', file: null, lines: null }], reads: [{ scope: 'repository', reason: 'low_confidence' }], claims: { patchState: null, impact: [] } })).toContain('EXPANSION_NOT_TARGETED');
  });
  it('requires diagnosis before retry and forbids success after a failed targeted run', async () => {
    const scenario = await byId('targeted_test_failure');
    expect(accepted(scenario, { action: 'diagnose', diagnosis: { executionId: 'exec_t1', frames: [{ file: 'src/session/session-restorer.js', line: 10 }] }, expansions: [{ reason: 'test_failure', trigger: 'exec_t1', tool: 'devbrain_read_file_slice', file: 'src/session/session-restorer.js', lines: [1, 25] }], reads: [], claims: { patchState: 'incomplete', impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'retry', diagnosis: null, expansions: [], reads: [], claims: { patchState: 'incomplete', impact: [] } })).toContain('RETRY_WITHOUT_DIAGNOSIS');
    expect(violations(scenario, { action: 'proceed', diagnosis: null, expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toEqual(expect.arrayContaining(['SUCCESS_AFTER_FAILED_VERIFICATION', 'RETRY_WITHOUT_DIAGNOSIS']));
  });
  it('requires an unexpected post-change impact path to be inspected before completion', async () => {
    const scenario = await byId('unexpected_post_impact');
    expect(accepted(scenario, { action: 'inspect_unexpected', expansions: [{ reason: 'unexpected_post_impact', trigger: 'postImpact src/billing/invoice.js', tool: 'devbrain_read_file_slice', file: 'src/billing/invoice.js', lines: [1, 40] }], reads: [], claims: { patchState: 'incomplete', impact: [{ target: 'src/billing/invoice.js', wording: 'potential' }] } })).toBe(true);
    expect(violations(scenario, { action: 'proceed', expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toContain('UNEXPECTED_PATH_IGNORED');
    expect(violations(scenario, { action: 'inspect_unexpected', expansions: [{ reason: 'unexpected_post_impact', trigger: 'postImpact', tool: 'shell', file: null, lines: null }], reads: [{ scope: 'directory', file: 'src/billing', reason: 'unexpected_post_impact' }], claims: { patchState: null, impact: [] } })).toContain('EXPANSION_NOT_TARGETED');
  });
  it('requires an unrelated diff to be reverted or justified before completion', async () => {
    const scenario = await byId('unrelated_diff');
    expect(accepted(scenario, { action: 'revert_unrelated', unrelatedFiles: [{ path: 'README.md', disposition: 'reverted' }], expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toBe(true);
    expect(accepted(scenario, { action: 'revert_unrelated', unrelatedFiles: [{ path: 'README.md', disposition: 'justified', evidence: 'README documents the renamed method by name' }], expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'proceed', unrelatedFiles: [], expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toContain('UNRELATED_DIFF_ACCEPTED');
    expect(violations(scenario, { action: 'revert_unrelated', unrelatedFiles: [{ path: 'README.md', disposition: 'justified' }], expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toContain('UNRELATED_DIFF_ACCEPTED');
  });
  it('forbids claiming completion when the full regression failed even though the targeted run passed', async () => {
    const scenario = await byId('full_regression_failure');
    expect(accepted(scenario, { action: 'diagnose', diagnosis: { executionId: 'exec_f4', frames: [{ file: 'tests/visible/integration.test.js', line: 22 }] }, expansions: [{ reason: 'test_failure', trigger: 'exec_f4', tool: 'devbrain_read_file_slice', file: 'tests/visible/integration.test.js', lines: [10, 30] }], reads: [], claims: { patchState: 'incomplete', impact: [] } })).toBe(true);
    expect(violations(scenario, { action: 'proceed', diagnosis: null, expansions: [], reads: [], claims: { patchState: 'complete', impact: [] } })).toContain('SUCCESS_AFTER_FAILED_VERIFICATION');
    expect(violations(scenario, { action: 'report_blocked', diagnosis: null, expansions: [], reads: [], claims: { patchState: 'blocked', impact: [] } })).toContain('RETRY_WITHOUT_DIAGNOSIS');
  });
  it('rejects malformed decisions instead of guessing', async () => {
    const scenario = await byId('straightforward');
    expect(violations(scenario, { action: 'teleport', expansions: [], reads: [], claims: { patchState: null, impact: [] } })).toContain('UNKNOWN_ACTION');
    expect(violations(scenario, null)).toContain('MALFORMED_DECISION');
  });
});
