import { HYPOTHESIS_STATUSES, validateEvidenceReference, violation } from './contracts.mjs';
import { CONTEXT_EXPANSION_REASONS, checkContextBudget } from './context-governance.mjs';

const EVENT_TYPES = new Set([
  'fix_applied',
  'verification_failed',
  'evidence_retrieved',
  'hypothesis_transition',
  'context_expanded',
  'fix_reverted',
  'verification_passed',
]);
const VERIFICATION_TYPES = new Set(['verification_failed', 'verification_passed']);
const FIX_ATTEMPT_MAXIMUM = 2;
// Three total runs are enough to label mixed outcomes as suspected flakiness;
// extending that series is bounded at five attempts for discrimination.
const STABILITY_ATTEMPT_MAXIMUM = 5;
const ATTEMPT_RESULTS = new Set(['passed', 'failed', 'blocked', 'unavailable']);
const STRONG_CONFIDENCE = new Set(['high', 'medium']);
// A bounded run series classifies; it never estimates. These claims are refused outright.
const INFERENCE_FIELDS = Object.freeze([
  'failureRate',
  'failureProbability',
  'probability',
  'pValue',
  'significance',
  'statisticalSignificance',
  'confidenceInterval',
]);
// A failed fix demotes the hypothesis it rested on; re-supporting it is not a reassessment.
const REASSESSMENT_TARGETS = new Set(['REJECTED', 'INCONCLUSIVE']);

// Ordered: the first unmet requirement present is the action to take next.
const ACTION_BY_CODE = new Map([
  ['FIX_ATTEMPT_BUDGET_EXHAUSTED', 'stop_and_report'],
  ['CONTEXT_EXPANSION_BUDGET_EXHAUSTED', 'stop_and_report'],
  ['FIX_ALREADY_VERIFIED', 'stop_and_report'],
  ['FIX_VERIFICATION_REQUIRED', 'verify_fix'],
  ['FAILURE_EVIDENCE_REQUIRED', 'retrieve_evidence'],
  ['HYPOTHESIS_REASSESSMENT_REQUIRED', 'reassess_hypothesis'],
  ['CONTEXT_EXPANSION_REASON_INVALID', 'retrieve_evidence'],
  ['CONTEXT_EXPANSION_TRIGGER_REQUIRED', 'retrieve_evidence'],
]);

function text(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireEvent(event) {
  if (!event || typeof event !== 'object') throw new Error('INVALID_FIX_TRACE_EVENT');
  if (!EVENT_TYPES.has(event.type)) throw new Error('UNKNOWN_FIX_TRACE_EVENT');
  if (!text(event.eventId)) throw new Error('FIX_TRACE_EVENT_ID_REQUIRED');
  // A fix must name the hypothesis it rests on, or no later transition can reassess it.
  if (event.type === 'fix_applied' && !text(event.hypothesisId)) {
    throw new Error('FIX_HYPOTHESIS_ID_REQUIRED');
  }
  if (VERIFICATION_TYPES.has(event.type) && !text(event.executionId)) {
    throw new Error('VERIFICATION_EXECUTION_ID_REQUIRED');
  }
  if (event.type === 'hypothesis_transition') {
    if (!text(event.hypothesisId)) throw new Error('FIX_TRACE_HYPOTHESIS_ID_REQUIRED');
    if (!HYPOTHESIS_STATUSES.includes(event.from) || !HYPOTHESIS_STATUSES.includes(event.to)) {
      throw new Error('INVALID_FIX_TRACE_HYPOTHESIS_TRANSITION');
    }
  }
}

function requireTrace(trace) {
  if (!Array.isArray(trace)) throw new Error('FIX_TRACE_MUST_BE_ARRAY');
  trace.forEach(requireEvent);
  return trace;
}

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}

export function checkAttemptBudgets(trace = []) {
  const events = requireTrace(trace);
  const fixAttemptsUsed = eventsOfType(events, 'fix_applied').length;
  const context = checkContextBudget({ expansions: eventsOfType(events, 'context_expanded') });
  const overBudget = fixAttemptsUsed > FIX_ATTEMPT_MAXIMUM;
  const violations = [
    ...(overBudget
      ? [violation(
        'FIX_ATTEMPT_BUDGET_EXHAUSTED',
        `used ${fixAttemptsUsed} fix attempts; maximum is ${FIX_ATTEMPT_MAXIMUM}`,
        eventsOfType(events, 'fix_applied').map(({ eventId }) => eventId),
      )]
      : []),
    ...context.violations.map(({ code, detail }) => violation(code, detail)),
  ];
  return {
    status: overBudget || context.status === 'exhausted' ? 'exhausted' : 'within_budget',
    fixAttemptsUsed,
    fixAttemptsMaximum: FIX_ATTEMPT_MAXIMUM,
    expansionsUsed: context.expansionsUsed,
    violations,
  };
}

function explainsFailure(event, failure) {
  if (event.type !== 'evidence_retrieved') return false;
  try {
    validateEvidenceReference(event.evidence);
  } catch {
    return false;
  }
  return event.evidence.classification === 'observed'
    && event.evidence.unknown !== true
    && event.evidence.executionId === failure.executionId;
}

function reassesses(event, failedFix) {
  return event.type === 'hypothesis_transition'
    && event.hypothesisId === failedFix.hypothesisId
    && REASSESSMENT_TARGETS.has(event.to);
}

function expansionReasons(expansion) {
  const reasons = [];
  if (!CONTEXT_EXPANSION_REASONS.includes(expansion.reason)) {
    reasons.push(violation(
      'CONTEXT_EXPANSION_REASON_INVALID',
      'a context expansion must cite a governed expansion reason',
      [expansion.eventId],
    ));
  }
  if (!text(expansion.trigger)) {
    reasons.push(violation(
      'CONTEXT_EXPANSION_TRIGGER_REQUIRED',
      'a context expansion must cite the observed event that triggered it',
      [expansion.eventId],
    ));
  }
  return reasons;
}

function retryReasons(history, lastFixIndex) {
  const failedFix = history[lastFixIndex];
  const after = history.slice(lastFixIndex + 1);
  const outcomes = after.filter((event) => VERIFICATION_TYPES.has(event.type));
  const outcome = outcomes[outcomes.length - 1] ?? null;

  if (!outcome) {
    return [violation(
      'FIX_VERIFICATION_REQUIRED',
      'the previous fix has no recorded verification outcome',
      [failedFix.eventId],
    )];
  }
  if (outcome.type === 'verification_passed') {
    return [violation(
      'FIX_ALREADY_VERIFIED',
      'the previous fix passed verification; the fix loop is over',
      [outcome.eventId],
    )];
  }

  const since = after.slice(after.indexOf(outcome) + 1);
  const reasons = [];
  if (!since.some((event) => explainsFailure(event, outcome))) {
    reasons.push(violation(
      'FAILURE_EVIDENCE_REQUIRED',
      'observed evidence for the failed verification must be retrieved before another fix',
      [outcome.eventId],
    ));
  }
  if (!since.some((event) => reassesses(event, failedFix))) {
    reasons.push(violation(
      'HYPOTHESIS_REASSESSMENT_REQUIRED',
      'the hypothesis the failed fix rested on must be rejected or marked inconclusive',
      [failedFix.eventId, failedFix.hypothesisId],
    ));
  }
  reasons.push(...eventsOfType(since, 'context_expanded').flatMap(expansionReasons));
  return reasons;
}

/**
 * Decides whether one more fix attempt is earned. The trailing fix_applied, when
 * present, is the attempt under assessment; everything before it is history.
 */
export function assessNextFixAttempt(trace = []) {
  const events = requireTrace(trace);
  const pending = events.length > 0 && events[events.length - 1].type === 'fix_applied';
  const history = pending ? events.slice(0, -1) : events;

  const budgets = checkAttemptBudgets(history);
  const reasons = [...budgets.violations];
  if (budgets.fixAttemptsUsed >= FIX_ATTEMPT_MAXIMUM
    && !reasons.some(({ code }) => code === 'FIX_ATTEMPT_BUDGET_EXHAUSTED')) {
    reasons.push(violation(
      'FIX_ATTEMPT_BUDGET_EXHAUSTED',
      `${budgets.fixAttemptsUsed} fix attempts were already made; maximum is ${FIX_ATTEMPT_MAXIMUM}`,
      eventsOfType(history, 'fix_applied').map(({ eventId }) => eventId),
    ));
  }

  const lastFixIndex = history.findLastIndex((event) => event.type === 'fix_applied');
  if (lastFixIndex !== -1) reasons.push(...retryReasons(history, lastFixIndex));

  const nextAction = [...ACTION_BY_CODE.keys()].find((code) => reasons.some((reason) => reason.code === code));
  return {
    permitted: reasons.length === 0,
    nextAction: nextAction ? ACTION_BY_CODE.get(nextAction) : 'apply_bounded_fix',
    reasons,
  };
}

function structuralKey(value) {
  if (Array.isArray(value)) return `[${value.map(structuralKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${structuralKey(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requireStabilityAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object') throw new Error('INVALID_STABILITY_ATTEMPT');
  for (const field of ['executionId', 'invocationFingerprint', 'repositorySha', 'environmentFingerprint']) {
    if (!text(attempt[field])) throw new Error(`STABILITY_ATTEMPT_${field.toUpperCase()}_REQUIRED`);
  }
  if (!ATTEMPT_RESULTS.has(attempt.result)) throw new Error('INVALID_STABILITY_ATTEMPT_RESULT');
  if (attempt.result === 'failed' && !attempt.failureSignature) {
    throw new Error('STABILITY_FAILURE_SIGNATURE_REQUIRED');
  }
}

function seriesMismatch(attempts) {
  const [first] = attempts;
  return attempts.some((attempt) => (
    attempt.repositorySha !== first.repositorySha
    || attempt.invocationFingerprint !== first.invocationFingerprint
  ));
}

function groupSignatures(failures) {
  const groups = new Map();
  for (const { executionId, failureSignature } of failures) {
    const key = structuralKey(failureSignature);
    const group = groups.get(key) ?? { signature: failureSignature, executionIds: [] };
    group.executionIds.push(executionId);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function observedDifference(attempt) {
  const difference = attempt.environmentDifference;
  if (!difference || typeof difference !== 'object' || !text(difference.dimension)
    || difference.value === undefined) {
    return null;
  }
  try {
    validateEvidenceReference(difference);
  } catch {
    return null;
  }
  return difference.classification === 'observed'
    && difference.unknown !== true
    && STRONG_CONFIDENCE.has(difference.confidence)
    ? difference
    : null;
}

function differenceKey(difference) {
  return `${difference.dimension}=${structuralKey(difference.value)}`;
}

const UNCORRELATED = Object.freeze({
  correlated: false,
  dimension: null,
  failingExecutionIds: [],
  contrastingExecutionIds: [],
});

/**
 * An environment difference explains a failure only when it was observed on every
 * failing run, recorded by the environment fingerprint, and absent from a run that
 * behaved differently. Anything less is an unexplained failure, not an excuse.
 */
function correlateEnvironment(failures, passes, limitations) {
  const differences = failures.map(observedDifference);
  if (differences.some((difference) => difference === null)) return UNCORRELATED;

  const keys = new Set(differences.map(differenceKey));
  if (keys.size !== 1) return UNCORRELATED;
  const [difference] = differences;

  if (failures.length < 2) {
    limitations.push('a single failure with an observed environment difference is not a consistent association');
    return UNCORRELATED;
  }
  if (passes.length === 0) return UNCORRELATED;
  if (passes.some((attempt) => {
    const passDifference = observedDifference(attempt);
    return passDifference !== null && differenceKey(passDifference) === differenceKey(difference);
  })) {
    return UNCORRELATED;
  }

  const failingFingerprints = new Set(failures.map(({ environmentFingerprint }) => environmentFingerprint));
  if (passes.some(({ environmentFingerprint }) => failingFingerprints.has(environmentFingerprint))) {
    limitations.push('the environment fingerprint does not record the observed environment difference');
    return UNCORRELATED;
  }

  return {
    correlated: true,
    dimension: difference.dimension,
    failingExecutionIds: failures.map(({ executionId }) => executionId),
    contrastingExecutionIds: passes.map(({ executionId }) => executionId),
  };
}

function inferenceViolations(attempts) {
  return attempts.flatMap((attempt) => {
    const claimed = INFERENCE_FIELDS.filter((field) => attempt[field] !== undefined);
    return claimed.length === 0 ? [] : [violation(
      'STATISTICAL_INFERENCE_NOT_PERMITTED',
      `a bounded run series cannot estimate ${claimed.join(', ')}`,
      [attempt.executionId],
    )];
  });
}

function stabilityConfidence(kind) {
  if (kind === 'DETERMINISTIC_FAILURE') return 'high';
  return kind === 'UNKNOWN' ? 'unknown' : 'medium';
}

function stabilityKind(failures, passes, signatureGroups, environmentCorrelation, attemptCount, hasEnvironmentClue) {
  if (failures.length === 0) return 'UNKNOWN';
  if (signatureGroups.length > 1) return 'REPEATED_INSTABILITY';
  if (environmentCorrelation.correlated) return 'ENVIRONMENTAL_FAILURE';
  if (failures.length === 1) return passes.length > 0 ? 'SUSPECTED_FLAKY' : 'UNKNOWN';
  // A reported environment difference that cannot be corroborated is a
  // divergent clue, so do not downgrade it to ordinary suspected flakiness.
  return passes.length > 0
    ? (hasEnvironmentClue || attemptCount > 3 ? 'REPEATED_INSTABILITY' : 'SUSPECTED_FLAKY')
    : 'DETERMINISTIC_FAILURE';
}

/**
 * The single authority for run-series stability. Bounded repeated runs classify;
 * they never estimate a rate, and an unexplained failure stays UNKNOWN.
 */
export function classifyStability(attempts = []) {
  if (!Array.isArray(attempts)) throw new Error('STABILITY_ATTEMPTS_MUST_BE_ARRAY');
  attempts.forEach(requireStabilityAttempt);
  const executionIds = attempts.map(({ executionId }) => executionId);
  if (new Set(executionIds).size !== executionIds.length) {
    throw new Error('DUPLICATE_STABILITY_EXECUTION_ID');
  }

  const violations = [
    ...inferenceViolations(attempts),
    ...(attempts.length > STABILITY_ATTEMPT_MAXIMUM
      ? [violation(
        'FLAKINESS_DISCRIMINATION_BUDGET_EXHAUSTED',
        `used ${attempts.length} stability attempts; maximum is ${STABILITY_ATTEMPT_MAXIMUM}`,
        executionIds,
      )]
      : []),
  ];
  if (attempts.length > 1 && seriesMismatch(attempts)) {
    return {
      kind: 'UNKNOWN',
      status: 'invalid_series',
      executionIds,
      signatureGroups: [],
      environmentCorrelation: UNCORRELATED,
      confidence: 'unknown',
      limitations: ['attempts disagree on repository sha or invocation fingerprint'],
      violations: [violation(
        'STABILITY_SERIES_MISMATCH',
        'attempts must share one repository sha and invocation fingerprint to form a series',
        executionIds,
      ), ...violations],
    };
  }

  const failures = attempts.filter(({ result }) => result === 'failed');
  const passes = attempts.filter(({ result }) => result === 'passed');
  const limitations = attempts
    .filter(({ result }) => result === 'blocked' || result === 'unavailable')
    .map(({ executionId, result }) => `attempt ${executionId} was ${result}`);

  const signatureGroups = groupSignatures(failures);
  const environmentCorrelation = correlateEnvironment(failures, passes, limitations);
  const hasEnvironmentClue = failures.some((attempt) => attempt.environmentDifference !== undefined);
  const kind = stabilityKind(failures, passes, signatureGroups, environmentCorrelation, attempts.length, hasEnvironmentClue);
  if (kind === 'UNKNOWN' && failures.length === 1) {
    limitations.push('stability is unknown after one observed failure');
  }

  return {
    kind,
    status: 'classified',
    executionIds,
    signatureGroups,
    environmentCorrelation,
    confidence: stabilityConfidence(kind),
    limitations,
    violations,
  };
}
