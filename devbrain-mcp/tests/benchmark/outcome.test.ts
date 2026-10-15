import { describe, expect, it } from 'vitest';
import { classifyPatch, classifySkillDiscipline } from '../../benchmarks/refactor-safely/harness/outcome.mjs';

const pass = (id: string, dimension: string, critical = true) => ({ id, dimension, status: 'pass', critical, evidence: {} });
const fail = (id: string, dimension: string, critical = true, evidence = {}) => ({ id, dimension, status: 'fail', critical, evidence });
const verification = (overrides: Record<string, number> = {}) => ({ status: 'ok', targeted: { exitCode: 0 }, lint: { exitCode: 0 }, build: { exitCode: 0 }, fullRegression: { exitCode: 0 }, ...Object.fromEntries(Object.entries(overrides).map(([key, exitCode]) => [key, { exitCode }])) });
const correct = [pass('transformation.new_method_defined', 'transformation'), pass('behavior.token_verification', 'behavior'), pass('scope.only_allowed_files_changed', 'scope', false), pass('behavior.harness_verification', 'behavior')];

describe('patch classification is independent of agent discipline', () => {
  it('a correct patch stays SUCCESS even when the agent never ran the full regression', () => {
    expect(classifyPatch(correct, verification())).toEqual({ status: 'SUCCESS', criticalFailures: [], noncriticalFailures: [], errors: [], reasons: [] });
    expect(classifySkillDiscipline({ targetedTestsRun: true, fullRegressionRun: false, lintRun: true, buildRun: true, verificationFailures: 0 })).toEqual({ status: 'incomplete', missing: ['fullRegression'], verificationFailures: 0 });
    expect(classifySkillDiscipline({ targetedTestsRun: true, fullRegressionRun: true, lintRun: true, buildRun: true, verificationFailures: 1 })).toEqual({ status: 'complete', missing: [], verificationFailures: 1 });
    expect(classifySkillDiscipline(null)).toEqual({ status: 'unknown', missing: [], verificationFailures: null });
  });
  it('a critical check failure or a full-regression failure is FAILURE', () => {
    expect(classifyPatch([...correct, fail('behavior.session_restorer', 'behavior')], verification())).toMatchObject({ status: 'FAILURE', criticalFailures: ['behavior.session_restorer'] });
    expect(classifyPatch(correct, verification({ fullRegression: 1 }))).toMatchObject({ status: 'FAILURE', reasons: ['full regression exit code 1'] });
  });
  it('a noncritical scope failure with valid behavior is PARTIAL', () => {
    expect(classifyPatch([...correct, fail('scope.bounded_diff', 'scope', false, { changedLines: 90 })], verification())).toMatchObject({ status: 'PARTIAL', noncriticalFailures: ['scope.bounded_diff'], criticalFailures: [] });
    expect(classifyPatch(correct, verification({ lint: 1 }))).toMatchObject({ status: 'PARTIAL', reasons: ['lint exit code 1'] });
  });
  it('infrastructure failure is HARNESS_ERROR, never patch FAILURE', () => {
    expect(classifyPatch([...correct, { id: 'behavior.x', dimension: 'behavior', status: 'error', critical: true, evidence: { error: 'boom' } }], verification())).toMatchObject({ status: 'HARNESS_ERROR', errors: ['behavior.x'] });
    expect(classifyPatch(correct, { status: 'error', lint: { error: 'spawn ENOENT' } })).toMatchObject({ status: 'HARNESS_ERROR', reasons: ['harness verification error'] });
    expect(classifyPatch(correct, null)).toMatchObject({ status: 'HARNESS_ERROR' });
    expect(classifyPatch(null, verification())).toMatchObject({ status: 'HARNESS_ERROR' });
  });
});
