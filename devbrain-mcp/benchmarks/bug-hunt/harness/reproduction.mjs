import { validateEvidenceReference, violation } from './contracts.mjs';

const ATTEMPT_RESULTS = new Set(['passed', 'failed', 'blocked', 'unavailable']);
const FAILURE_EVIDENCE_SOURCES = new Set(['execution', 'diagnostic', 'artifact']);
const IMMUTABLE_HASH = /^sha256:[0-9a-f]{64}$/;

function requireAttempt(attempt) {
  if (!attempt || typeof attempt !== 'object') throw new Error('INVALID_REPRODUCTION_ATTEMPT');
  for (const field of ['executionId', 'invocationFingerprint', 'repositorySha', 'environmentFingerprint']) {
    if (typeof attempt[field] !== 'string' || attempt[field].trim() === '') {
      throw new Error(`REPRODUCTION_ATTEMPT_${field.toUpperCase()}_REQUIRED`);
    }
  }
  if (!ATTEMPT_RESULTS.has(attempt.result)) throw new Error('INVALID_REPRODUCTION_ATTEMPT_RESULT');
  if (attempt.result === 'failed' && !attempt.failureSignature) {
    throw new Error('FAILURE_SIGNATURE_REQUIRED');
  }
}

function assertOneSeries(attempts) {
  if (attempts.length < 2) return;
  const first = attempts[0];
  for (const attempt of attempts.slice(1)) {
    if (attempt.repositorySha !== first.repositorySha) {
      throw new Error('REPRODUCTION_SERIES_REPOSITORY_MISMATCH');
    }
    if (attempt.invocationFingerprint !== first.invocationFingerprint) {
      throw new Error('REPRODUCTION_SERIES_INVOCATION_MISMATCH');
    }
    if (attempt.environmentFingerprint !== first.environmentFingerprint) {
      throw new Error('REPRODUCTION_SERIES_ENVIRONMENT_MISMATCH');
    }
  }
}

function assertUniqueExecutionIds(attempts, bridge) {
  const ids = new Set();
  for (const { executionId } of attempts) {
    if (ids.has(executionId)) throw new Error('DUPLICATE_REPRODUCTION_EXECUTION_ID');
    ids.add(executionId);
  }
  if (bridge && ids.has(bridge.executionId)) {
    throw new Error('REGRESSION_BRIDGE_EXECUTION_ID_COLLISION');
  }
}

function structuralKey(value) {
  if (Array.isArray(value)) return `[${value.map(structuralKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${structuralKey(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameSignature(left, right) {
  return structuralKey(left) === structuralKey(right);
}

function result(status, stability, confidence, signature, executionIds, limitations = [], violations = []) {
  return { status, stability, confidence, signature, executionIds, limitations, violations };
}

function validateRegressionBridge(bridge) {
  if (!bridge || typeof bridge !== 'object') throw new Error('INVALID_REGRESSION_BRIDGE');
  if (typeof bridge.executionId !== 'string' || bridge.executionId.trim() === '') {
    throw new Error('REGRESSION_BRIDGE_EXECUTION_ID_REQUIRED');
  }
  if (!ATTEMPT_RESULTS.has(bridge.result)) throw new Error('INVALID_REGRESSION_BRIDGE_RESULT');
  if (typeof bridge.reportedMechanismObserved !== 'boolean') {
    throw new Error('INVALID_REGRESSION_BRIDGE_MECHANISM_OBSERVATION');
  }
  if (bridge.result === 'failed' && !bridge.failureSignature) {
    throw new Error('REGRESSION_BRIDGE_SIGNATURE_REQUIRED');
  }
}

function unavailableAttemptEvidence(attempts, bridge) {
  const unavailable = [
    ...attempts.filter(({ result: attemptResult }) => attemptResult === 'blocked' || attemptResult === 'unavailable'),
    ...(bridge && (bridge.result === 'blocked' || bridge.result === 'unavailable') ? [bridge] : []),
  ];
  return {
    limitations: unavailable.map(({ executionId, result: attemptResult }) => (
      `reproduction attempt ${executionId} was ${attemptResult}`
    )),
    violations: unavailable.map(({ executionId, result: attemptResult }) => violation(
      `REPRODUCTION_ATTEMPT_${attemptResult.toUpperCase()}`,
      `reproduction attempt was ${attemptResult}`,
      [executionId],
    )),
  };
}

export function classifyReproduction({ attempts = [], externalEvidence = null, regressionBridge = null } = {}) {
  if (!Array.isArray(attempts)) throw new Error('REPRODUCTION_ATTEMPTS_MUST_BE_ARRAY');
  attempts.forEach(requireAttempt);
  assertOneSeries(attempts);
  if (regressionBridge !== null) validateRegressionBridge(regressionBridge);
  assertUniqueExecutionIds(attempts, regressionBridge);

  const executionIds = attempts.map(({ executionId }) => executionId);
  if (regressionBridge) executionIds.push(regressionBridge.executionId);
  const failures = [
    ...attempts.filter(({ result: attemptResult }) => attemptResult === 'failed'),
    ...(regressionBridge?.result === 'failed' ? [regressionBridge] : []),
  ];
  const passes = [
    ...attempts.filter(({ result: attemptResult }) => attemptResult === 'passed'),
    ...(regressionBridge?.result === 'passed' ? [regressionBridge] : []),
  ];
  const attemptEvidence = unavailableAttemptEvidence(attempts, regressionBridge);
  const confidenceWithAvailability = (confidence) => (
    attemptEvidence.violations.length > 0 && confidence === 'high' ? 'medium' : confidence
  );

  if (failures.length > 1) {
    const signatures = failures.map(({ failureSignature }) => failureSignature);
    const matching = signatures.every((signature) => sameSignature(signature, signatures[0]));
    if (!matching && regressionBridge?.result === 'failed') {
      return result(
        'PARTIALLY_REPRODUCED',
        'REPEATED_INSTABILITY',
        'medium',
        null,
        executionIds,
        attemptEvidence.limitations,
        [
          ...attemptEvidence.violations,
          violation(
            'REGRESSION_BRIDGE_SIGNATURE_CONFLICT',
            'regression bridge failure signature conflicts with ordinary reproduction evidence',
            [regressionBridge.executionId],
          ),
        ],
      );
    }
  }

  if (failures.length > 0 && passes.length > 0) {
    const signatures = failures.map(({ failureSignature }) => failureSignature);
    const matching = signatures.every((signature) => sameSignature(signature, signatures[0]));
    return result(
      'PARTIALLY_REPRODUCED',
      matching ? 'SUSPECTED_FLAKY' : 'REPEATED_INSTABILITY',
      'medium',
      matching ? signatures[0] : null,
      executionIds,
      attemptEvidence.limitations,
      attemptEvidence.violations,
    );
  }

  if (failures.length > 0) {
    const signatures = failures.map(({ failureSignature }) => failureSignature);
    const matching = signatures.every((signature) => sameSignature(signature, signatures[0]));
    if (!matching) {
      return result(
        'PARTIALLY_REPRODUCED',
        'REPEATED_INSTABILITY',
        'medium',
        null,
        executionIds,
        attemptEvidence.limitations,
        attemptEvidence.violations,
      );
    }
    if (failures.length === 1) {
      const bridgeOnly = failures[0] === regressionBridge;
      return result(
        bridgeOnly && !regressionBridge.reportedMechanismObserved ? 'PARTIALLY_REPRODUCED' : 'REPRODUCED',
        'UNKNOWN',
        'medium',
        signatures[0],
        executionIds,
        ['stability is unknown after one observed failure', ...attemptEvidence.limitations],
        attemptEvidence.violations,
      );
    }
    return result(
      'REPRODUCED',
      'DETERMINISTIC_FAILURE',
      confidenceWithAvailability('high'),
      signatures[0],
      executionIds,
      attemptEvidence.limitations,
      attemptEvidence.violations,
    );
  }

  if (passes.length > 0) {
    return result(
      'NOT_REPRODUCED',
      'UNKNOWN',
      confidenceWithAvailability('high'),
      null,
      executionIds,
      attemptEvidence.limitations,
      attemptEvidence.violations,
    );
  }

  if (externalEvidence) {
    validateEvidenceReference(externalEvidence);
    const externalViolation = externalEvidence.classification !== 'observed'
      ? violation(
        'EXTERNAL_EVIDENCE_NOT_OBSERVED',
        'external evidence is inferred or potential, not an observed failure',
        [externalEvidence.reference],
      )
      : !externalEvidence.failureSignature
        ? violation(
          'EXTERNAL_EVIDENCE_SIGNATURE_REQUIRED',
          'observed external evidence lacks a failure signature',
          [externalEvidence.reference],
        )
        : !FAILURE_EVIDENCE_SOURCES.has(externalEvidence.source)
          ? violation(
            'EXTERNAL_EVIDENCE_SOURCE_NOT_FAILURE_BEARING',
            'external evidence source cannot establish an observed failure',
            [externalEvidence.reference],
          )
          : ![externalEvidence.sha256, externalEvidence.artifactHash].some((hash) => IMMUTABLE_HASH.test(hash ?? ''))
            ? violation(
              'EXTERNAL_EVIDENCE_IMMUTABLE_HASH_REQUIRED',
              'external evidence lacks strict immutable sha256 provenance',
              [externalEvidence.reference],
            )
            : null;
    if (externalViolation) {
      return result(
        'REPRODUCTION_NOT_AVAILABLE',
        'UNKNOWN',
        'unknown',
        null,
        executionIds,
        ['external evidence did not establish an observed failure signature', ...attemptEvidence.limitations],
        [...attemptEvidence.violations, externalViolation],
      );
    }
    return result(
      'PARTIALLY_REPRODUCED',
      'UNKNOWN',
      externalEvidence.confidence,
      externalEvidence.failureSignature ?? null,
      executionIds,
      ['failure was preserved as external evidence but not reproduced in this session', ...attemptEvidence.limitations],
      attemptEvidence.violations,
    );
  }

  return result(
    'REPRODUCTION_NOT_AVAILABLE',
    'UNKNOWN',
    'unknown',
    null,
    executionIds,
    ['no executable attempt or immutable external failure evidence was available', ...attemptEvidence.limitations],
    attemptEvidence.violations,
  );
}
