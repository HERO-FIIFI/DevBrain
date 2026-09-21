// Independent outcome dimensions. Patch correctness is classified from hidden checks plus harness verification;
// agent verification discipline is classified from observed behavior. The two are never combined into one score.

export const PATCH_STATUSES = Object.freeze(['SUCCESS', 'PARTIAL', 'FAILURE', 'HARNESS_ERROR']);
const VERIFICATION_KEYS = ['targeted', 'lint', 'build', 'fullRegression'];

/**
 * SUCCESS: every check and harness command passes. PARTIAL: only noncritical checks or non-regression commands fail.
 * FAILURE: a critical check or the full regression fails. HARNESS_ERROR: an evaluator or infrastructure error.
 */
export function classifyPatch(checks, harnessVerification) {
  if (!Array.isArray(checks) || !harnessVerification) return { status: 'HARNESS_ERROR', criticalFailures: [], noncriticalFailures: [], errors: [], reasons: [!Array.isArray(checks) ? 'hidden evaluation missing' : 'harness verification missing'] };
  const errors = checks.filter((check) => check.status === 'error').map((check) => check.id);
  if (errors.length || harnessVerification.status !== 'ok') return { status: 'HARNESS_ERROR', criticalFailures: [], noncriticalFailures: [], errors, reasons: harnessVerification.status !== 'ok' ? ['harness verification error'] : ['evaluator check error'] };
  const criticalFailures = checks.filter((check) => check.status === 'fail' && check.critical).map((check) => check.id);
  const noncriticalFailures = checks.filter((check) => check.status === 'fail' && !check.critical).map((check) => check.id);
  const reasons = VERIFICATION_KEYS.filter((key) => harnessVerification[key]?.exitCode !== 0).map((key) => `${key === 'fullRegression' ? 'full regression' : key} exit code ${harnessVerification[key]?.exitCode ?? 'unknown'}`);
  const regressionFailed = harnessVerification.fullRegression?.exitCode !== 0;
  const status = criticalFailures.length || regressionFailed ? 'FAILURE' : noncriticalFailures.length || reasons.length ? 'PARTIAL' : 'SUCCESS';
  return { status, criticalFailures, noncriticalFailures, errors, reasons };
}

/** Whether the agent itself ran targeted tests, lint, build, and full regression; failures are reported, not judged. */
export function classifySkillDiscipline(agentBehavior) {
  if (!agentBehavior) return { status: 'unknown', missing: [], verificationFailures: null };
  const missing = [['targetedTestsRun', 'targeted'], ['lintRun', 'lint'], ['buildRun', 'build'], ['fullRegressionRun', 'fullRegression']].filter(([key]) => agentBehavior[key] !== true).map(([, label]) => label);
  return { status: missing.length ? 'incomplete' : 'complete', missing, verificationFailures: agentBehavior.verificationFailures ?? null };
}
