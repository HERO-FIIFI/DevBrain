import { validateEvidenceReference, violation } from './contracts.mjs';

const REPOSITORY_FILE_ROLE = new Set(['production_fix', 'regression_test']);
const STRONG_CONFIDENCE = new Set(['high', 'medium']);
const STATIC_EVIDENCE_SOURCES = new Set(['source', 'relationship']);
const SAFE_DIRTY_PATH_OWNERS = new Set(['agent', 'system', 'task']);

function text(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function observedBeforeModification(evidence) {
  return validKnownEvidence(evidence)
    && evidence.classification === 'observed'
    && evidence.phase === 'pre_modification'
    && evidence.unknown !== true
    && STRONG_CONFIDENCE.has(evidence.confidence)
    && text(evidence.reference);
}

function validKnownEvidence(evidence) {
  try {
    validateEvidenceReference(evidence);
  } catch {
    return false;
  }
  return evidence.unknown === false;
}

function causalEvidence(evidence) {
  if (!observedBeforeModification(evidence) || evidence.outcome === 'passed') return false;
  return evidence.causal === true
    || (evidence.regressionBridge === true && evidence.outcome === 'failed');
}

function allHypothesisEvidence(hypothesis) {
  return [
    ...(Array.isArray(hypothesis?.supportingEvidence) ? hypothesis.supportingEvidence : []),
    hypothesis?.cheapestValidation?.evidence,
    ...(Array.isArray(hypothesis?.transitions)
      ? hypothesis.transitions.flatMap((transition) => (
        Array.isArray(transition?.evidence) ? transition.evidence : []
      ))
      : []),
  ].filter(Boolean);
}

function hypothesisEvidenceIsValid(hypothesis) {
  if (!Array.isArray(hypothesis?.supportingEvidence)
    || !Array.isArray(hypothesis?.contradictingEvidence)
    || !Array.isArray(hypothesis?.transitions)
    || !validKnownEvidence(hypothesis?.cheapestValidation?.evidence)) {
    return false;
  }
  return hypothesis.supportingEvidence.every(validKnownEvidence)
    && hypothesis.contradictingEvidence.every(validKnownEvidence)
    && hypothesis.transitions.every((transition) => (
      Array.isArray(transition?.evidence) && transition.evidence.every(validKnownEvidence)
    ));
}

function repositoryPath(path) {
  if (!text(path) || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    return false;
  }
  const segments = path.split('/');
  return segments.length > 1 && segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function isUserDirtyPath(dirtyPath, path) {
  if (typeof dirtyPath === 'string') return dirtyPath === path ? 'authorization_required' : 'not_dirty';
  if (dirtyPath?.path !== path) return 'not_dirty';
  return SAFE_DIRTY_PATH_OWNERS.has(dirtyPath.owner) ? 'safe_owner' : 'authorization_required';
}

function evidenceBindsPath(evidence, path) {
  return Array.isArray(evidence?.affectedPaths)
    && evidence.affectedPaths.every(repositoryPath)
    && evidence.affectedPaths.includes(path);
}

function ownershipEvidenceAuthorizesPath(evidence, path) {
  const authorizationDeclared = evidence?.authorization === 'user_authorized'
    || evidence?.kind === 'ownership_authorization';
  return causalEvidence(evidence)
    && authorizationDeclared
    && Array.isArray(evidence.authorizedPaths)
    && evidence.authorizedPaths.every(repositoryPath)
    && evidence.authorizedPaths.includes(path);
}

function staticCausalEvidence(evidence) {
  return causalEvidence(evidence) && STATIC_EVIDENCE_SOURCES.has(evidence.source);
}

function permittedResult(scope, hypothesisId, allowedFiles) {
  return {
    status: 'permitted',
    scope,
    reasons: [],
    hypothesisId,
    allowedFiles,
  };
}

function deniedResult(status, reasons) {
  return {
    status,
    scope: 'none',
    reasons,
    hypothesisId: null,
    allowedFiles: [],
  };
}

function addReason(reasons, code, detail) {
  if (!reasons.some((reason) => reason.code === code)) reasons.push(violation(code, detail));
}

function hasRecordedRepositoryState(repositoryState) {
  return repositoryState?.recorded === true
    && text(repositoryState.repositorySha)
    && text(repositoryState.branch)
    && Array.isArray(repositoryState.dirtyPaths);
}

function validExecutionIds(executionIds) {
  return Array.isArray(executionIds)
    && executionIds.length > 0
    && executionIds.every(text)
    && new Set(executionIds).size === executionIds.length;
}

function validReproductionEvidence(reproduction) {
  if (!validExecutionIds(reproduction?.executionIds) || !Array.isArray(reproduction.evidence)) return false;
  const linkedIds = reproduction.evidence.map((evidence) => evidence?.executionId);
  return reproduction.evidence.length > 0
    && reproduction.evidence.every((evidence) => (
      causalEvidence(evidence)
      && text(evidence.executionId)
      && reproduction.executionIds.includes(evidence.executionId)
    ))
    && reproduction.executionIds.every((executionId) => linkedIds.includes(executionId));
}

function validRegressionBridge(bridge, reproduction) {
  if (!bridge || typeof bridge !== 'object') return false;
  if (bridge.status === 'failing') {
    return text(bridge.executionId)
      && bridge.reportedMechanismObserved === true
      && reproduction?.executionIds?.includes(bridge.executionId)
      && causalEvidence(bridge.evidence)
      && bridge.evidence.executionId === bridge.executionId
      && bridge.evidence.regressionBridge === true
      && bridge.evidence.outcome === 'failed';
  }
  if (bridge.status === 'unavailable') return text(bridge.reason) && text(bridge.residualRisk);
  return false;
}

/**
 * Decides whether the evidence ledger permits a bounded change. This gate is
 * deliberately fail-closed: no partial file allowlist escapes a failed check.
 */
export function assessModificationGate({
  repositoryState,
  reproduction,
  ledger,
  proposedChange,
  regressionBridge,
  expectedPostFix,
} = {}) {
  const blocked = [];
  const refine = [];

  if (!hasRecordedRepositoryState(repositoryState)) {
    addReason(blocked, 'REPOSITORY_STATE_NOT_RECORDED', 'repository state must be recorded before modification');
  }

  const reproductionAvailable = reproduction?.status === 'REPRODUCED'
    && text(reproduction.signature)
    && validReproductionEvidence(reproduction);
  const reproductionUnavailable = reproduction?.status === 'REPRODUCTION_NOT_AVAILABLE';
  if (!reproductionAvailable && !reproductionUnavailable) {
    addReason(blocked, 'EXPLICIT_REPRODUCTION_REQUIRED', 'an explicit reproduced or unavailable status is required');
  }

  const hypothesisId = proposedChange?.hypothesisId;
  const hypothesis = Array.isArray(ledger?.hypotheses) && text(hypothesisId)
    ? ledger.hypotheses.find((candidate) => candidate?.id === hypothesisId)
    : null;
  if (!hypothesis || hypothesis.status !== 'SUPPORTED') {
    addReason(blocked, 'SUPPORTED_HYPOTHESIS_REQUIRED', 'the authoritative ledger must contain a supported hypothesis');
  }

  if (!text(hypothesis?.prediction)) {
    addReason(blocked, 'CAUSAL_PREDICTION_REQUIRED', 'the supported hypothesis needs an explicit causal prediction');
  }
  const hypothesisEvidence = allHypothesisEvidence(hypothesis);
  if (!hypothesisEvidenceIsValid(hypothesis)) {
    addReason(blocked, 'INVALID_EVIDENCE_REQUIRED', 'all ledger evidence must satisfy the evidence contract and be explicitly known');
  }
  if (!hypothesisEvidence.some(causalEvidence)) {
    addReason(blocked, 'CAUSAL_SUPPORT_REQUIRED', 'causal support must be observed before modification at medium or high confidence');
  }
  if (!hypothesis?.cheapestValidation || hypothesis.cheapestValidation.completed !== true
    || !observedBeforeModification(hypothesis.cheapestValidation.evidence)) {
    addReason(blocked, 'CHEAPEST_VALIDATION_NOT_COMPLETED', 'the cheapest validation needs completed observed pre-modification evidence');
  }

  const contradictionsAddressed = proposedChange?.contradictoryEvidenceAddressed === true
    && (Array.isArray(hypothesis?.contradictingEvidence)
      ? hypothesis.contradictingEvidence.every((evidence) => evidence?.addressed === true)
      : false);
  if (!contradictionsAddressed) {
    addReason(refine, 'CONTRADICTORY_EVIDENCE_UNADDRESSED', 'material contradictory evidence must be addressed before modification');
  }

  if (!text(proposedChange?.behaviorChange)) {
    addReason(blocked, 'BEHAVIOR_CHANGE_REQUIRED', 'the proposed behavior change must be bounded and explicit');
  }
  if (!validRegressionBridge(regressionBridge, reproduction)) {
    addReason(blocked, 'REGRESSION_BRIDGE_EVIDENCE_REQUIRED', 'a failing bridge or recorded limitation with residual risk is required');
  }
  if (!text(expectedPostFix?.observation)) {
    addReason(blocked, 'EXPECTED_POST_FIX_OBSERVATION_REQUIRED', 'a post-fix observation must be declared before modification');
  }

  const files = proposedChange?.files;
  if (!Array.isArray(files) || files.length === 0) {
    addReason(blocked, 'PROPOSED_FILES_REQUIRED', 'at least one evidence-bounded proposed file is required');
  } else {
    const seenPaths = new Set();
    for (const file of files) {
      if (!repositoryPath(file?.path)) {
        addReason(blocked, 'FILE_PATH_NOT_REPOSITORY_QUALIFIED', 'proposed paths must be repository-qualified files');
      }
      if (!REPOSITORY_FILE_ROLE.has(file?.role)) {
        addReason(blocked, 'INVALID_PROPOSED_FILE_ROLE', 'proposed file roles must be production_fix or regression_test');
      }
      if (!causalEvidence(file?.evidence) || !evidenceBindsPath(file?.evidence, file?.path)) {
        addReason(blocked, 'FILE_EVIDENCE_REQUIRED', 'each proposed file needs strong observed pre-modification causal evidence');
      }
      if (seenPaths.has(file?.path)) {
        addReason(blocked, 'DUPLICATE_PROPOSED_FILE', 'each proposed file may appear only once');
      }
      seenPaths.add(file?.path);
      if (Array.isArray(repositoryState?.dirtyPaths)
        && repositoryState.dirtyPaths.some((dirtyPath) => (
          isUserDirtyPath(dirtyPath, file?.path) === 'authorization_required'
        ))
        && !ownershipEvidenceAuthorizesPath(file?.ownershipEvidence, file?.path)) {
        addReason(blocked, 'USER_DIRTY_PATH_OWNERSHIP_REQUIRED', 'a user-dirty path needs explicit ownership evidence');
      }
    }
  }

  const containsProductionFix = Array.isArray(files) && files.some((file) => file?.role === 'production_fix');
  const containsOnlyRegressionTests = Array.isArray(files) && files.length > 0
    && files.every((file) => file?.role === 'regression_test');
  if (reproductionUnavailable && containsProductionFix) {
    addReason(blocked, 'PRODUCTION_FIX_REQUIRES_REPRODUCTION', 'production fixes require an explicit reproduction');
  }
  if (reproductionUnavailable && !containsOnlyRegressionTests) {
    addReason(blocked, 'PRODUCTION_FIX_REQUIRES_REPRODUCTION', 'unavailable reproduction can authorize regression tests only');
  }
  if (reproductionUnavailable && (!hypothesisEvidence.some(staticCausalEvidence)
    || !Array.isArray(files)
    || !files.every((file) => staticCausalEvidence(file?.evidence)))) {
    addReason(blocked, 'STATIC_EVIDENCE_REQUIRED', 'unavailable reproduction requires strong static evidence for every regression-test file');
  }

  if (blocked.length > 0) return deniedResult('blocked', blocked);
  if (refine.length > 0) return deniedResult('refine', refine);
  return permittedResult(
    containsProductionFix ? 'production_fix' : 'regression_test_only',
    hypothesis.id,
    files.map(({ path }) => path),
  );
}
