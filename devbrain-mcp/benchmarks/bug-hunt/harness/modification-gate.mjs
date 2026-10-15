import {
  FAILURE_EVIDENCE_SOURCES,
  observedCausalEvidence,
  preModificationObserved,
  validateEvidenceReference,
  violation,
} from './contracts.mjs';

const REPOSITORY_FILE_ROLE = new Set(['production_fix', 'regression_test']);
const STATIC_EVIDENCE_SOURCES = new Set(['source', 'relationship']);
const SAFE_DIRTY_PATH_OWNERS = new Set(['agent', 'system', 'task']);
// The repository's own test convention: a directory segment or a test filename.
const TEST_PATH_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_FILENAME = /\.(test|spec)\.[cm]?[jt]sx?$/;

function text(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validKnownEvidence(evidence) {
  try {
    validateEvidenceReference(evidence);
  } catch {
    return false;
  }
  return evidence.unknown === false;
}

function observedBeforeModification(evidence) {
  return validKnownEvidence(evidence) && preModificationObserved(evidence);
}

function causalEvidence(evidence) {
  return validKnownEvidence(evidence) && observedCausalEvidence(evidence);
}

function failureBearing(evidence) {
  return causalEvidence(evidence) && FAILURE_EVIDENCE_SOURCES.includes(evidence.source);
}

function evidenceSource(evidence) {
  return evidence?.executionId ?? evidence?.reference ?? null;
}

function sourcesOf(records) {
  return records.map(evidenceSource).filter(text);
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
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// Role is a self-declared label; the path is structure. They must agree.
function isTestPath(path) {
  const segments = path.split('/');
  return segments.slice(0, -1).some((segment) => TEST_PATH_SEGMENTS.has(segment))
    || TEST_FILENAME.test(segments[segments.length - 1]);
}

function roleMatchesPath(role, path) {
  if (!repositoryPath(path) || !REPOSITORY_FILE_ROLE.has(role)) return true;
  return (role === 'regression_test') === isTestPath(path);
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

function deniedResult(status, reasons, hypothesisId = null) {
  return {
    status,
    scope: 'none',
    reasons,
    hypothesisId,
    allowedFiles: [],
  };
}

function addReason(reasons, code, detail, sources = []) {
  const existing = reasons.find((reason) => reason.code === code);
  if (!existing) {
    reasons.push(violation(code, detail, sources.filter(text)));
    return;
  }
  // Codes dedupe, evidence does not: a repeated code accumulates every source.
  for (const source of sources.filter(text)) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  }
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

// classifyReproduction returns a structured signature; a hand-built trace uses a string.
function hasSignature(signature) {
  return text(signature) || (!!signature && typeof signature === 'object');
}

// classifyReproduction carries no evidence records, so the caller may supply them
// alongside the classification instead of grafting them onto its result.
function reproductionRecords(reproduction, reproductionEvidence) {
  return [
    ...(Array.isArray(reproduction?.evidence) ? reproduction.evidence : []),
    ...(Array.isArray(reproductionEvidence) ? reproductionEvidence : []),
  ];
}

function validReproductionEvidence(reproduction, records) {
  if (!validExecutionIds(reproduction?.executionIds) || records.length === 0) return false;
  const linkedIds = records.map((evidence) => evidence?.executionId);
  return records.every((evidence) => (
    failureBearing(evidence)
    && text(evidence.executionId)
    && reproduction.executionIds.includes(evidence.executionId)
  ))
    && reproduction.executionIds.every((executionId) => linkedIds.includes(executionId));
}

// reproduction.mjs reports a bridge as {result}; a hand-built trace uses {status}.
function bridgeStatus(bridge) {
  if (bridge?.status === 'failing' || bridge?.status === 'unavailable') return bridge.status;
  if (bridge?.result === 'failed') return 'failing';
  if (bridge?.result === 'blocked' || bridge?.result === 'unavailable') return 'unavailable';
  return null;
}

function validRegressionBridge(bridge, reproduction, records) {
  if (!bridge || typeof bridge !== 'object') return false;
  const status = bridgeStatus(bridge);
  if (status === 'failing') {
    const evidence = bridge.evidence
      ?? records.find((record) => record?.executionId === bridge.executionId);
    return text(bridge.executionId)
      && bridge.reportedMechanismObserved === true
      && reproduction?.executionIds?.includes(bridge.executionId)
      && failureBearing(evidence)
      && evidence.executionId === bridge.executionId
      && evidence.regressionBridge === true
      && evidence.outcome === 'failed';
  }
  if (status === 'unavailable') return text(bridge.reason) && text(bridge.residualRisk);
  return false;
}

/**
 * Decides whether the evidence ledger permits a bounded change. This gate is
 * deliberately fail-closed: no partial file allowlist escapes a failed check.
 */
export function assessModificationGate({
  repositoryState,
  reproduction,
  reproductionEvidence,
  ledger,
  proposedChange,
  regressionBridge,
  expectedPostFix,
} = {}) {
  const blocked = [];
  const refine = [];

  if (!hasRecordedRepositoryState(repositoryState)) {
    addReason(blocked, 'REPOSITORY_STATE_NOT_RECORDED', 'repository state must be recorded before modification', [repositoryState?.repositorySha, repositoryState?.branch]);
  }

  const records = reproductionRecords(reproduction, reproductionEvidence);
  if (reproduction?.status === 'REPRODUCED'
    && records.some((evidence) => !FAILURE_EVIDENCE_SOURCES.includes(evidence?.source))) {
    addReason(
      blocked,
      'REPRODUCTION_EVIDENCE_SOURCE_NOT_FAILURE_BEARING',
      `reproduction evidence must come from ${FAILURE_EVIDENCE_SOURCES.join(', ')}, not a static reference`,
      sourcesOf(records.filter((evidence) => !FAILURE_EVIDENCE_SOURCES.includes(evidence?.source))),
    );
  }
  const reproductionAvailable = reproduction?.status === 'REPRODUCED'
    && hasSignature(reproduction.signature)
    && validReproductionEvidence(reproduction, records);
  const reproductionUnavailable = reproduction?.status === 'REPRODUCTION_NOT_AVAILABLE';
  if (!reproductionAvailable && !reproductionUnavailable) {
    addReason(blocked, 'EXPLICIT_REPRODUCTION_REQUIRED', 'an explicit reproduced or unavailable status is required', reproduction?.executionIds ?? []);
  }

  const hypothesisId = proposedChange?.hypothesisId;
  const hypothesis = Array.isArray(ledger?.hypotheses) && text(hypothesisId)
    ? ledger.hypotheses.find((candidate) => candidate?.id === hypothesisId)
    : null;
  if (!hypothesis || hypothesis.status !== 'SUPPORTED') {
    addReason(blocked, 'SUPPORTED_HYPOTHESIS_REQUIRED', 'the authoritative ledger must contain a supported hypothesis', [hypothesisId]);
  }

  if (!text(hypothesis?.prediction)) {
    addReason(blocked, 'CAUSAL_PREDICTION_REQUIRED', 'the supported hypothesis needs an explicit causal prediction', [hypothesisId]);
  }
  const hypothesisEvidence = allHypothesisEvidence(hypothesis);
  if (!hypothesisEvidenceIsValid(hypothesis)) {
    addReason(blocked, 'VALID_EVIDENCE_REQUIRED', 'all ledger evidence must satisfy the evidence contract and be explicitly known', sourcesOf(hypothesisEvidence));
  }
  if (!hypothesisEvidence.some(causalEvidence)) {
    addReason(blocked, 'CAUSAL_SUPPORT_REQUIRED', 'causal support must be observed before modification at medium or high confidence', sourcesOf(hypothesisEvidence));
  }
  if (!hypothesis?.cheapestValidation || hypothesis.cheapestValidation.completed !== true
    || !observedBeforeModification(hypothesis.cheapestValidation.evidence)) {
    addReason(blocked, 'CHEAPEST_VALIDATION_NOT_COMPLETED', 'the cheapest validation needs completed observed pre-modification evidence', [evidenceSource(hypothesis?.cheapestValidation?.evidence)]);
  }

  const contradictionsAddressed = proposedChange?.contradictoryEvidenceAddressed === true
    && (Array.isArray(hypothesis?.contradictingEvidence)
      ? hypothesis.contradictingEvidence.every((evidence) => evidence?.addressed === true)
      : false);
  if (!contradictionsAddressed) {
    addReason(refine, 'CONTRADICTORY_EVIDENCE_UNADDRESSED', 'material contradictory evidence must be addressed before modification', sourcesOf(hypothesis?.contradictingEvidence ?? []));
  }

  if (!text(proposedChange?.behaviorChange)) {
    addReason(blocked, 'BEHAVIOR_CHANGE_REQUIRED', 'the proposed behavior change must be bounded and explicit', [hypothesisId]);
  }
  if (!validRegressionBridge(regressionBridge, reproduction, records)) {
    addReason(blocked, 'REGRESSION_BRIDGE_EVIDENCE_REQUIRED', 'a failing bridge or recorded limitation with residual risk is required', [regressionBridge?.executionId]);
  }
  if (!text(expectedPostFix?.observation)) {
    addReason(blocked, 'EXPECTED_POST_FIX_OBSERVATION_REQUIRED', 'a post-fix observation must be declared before modification', [hypothesisId]);
  }

  const files = proposedChange?.files;
  if (!Array.isArray(files) || files.length === 0) {
    addReason(blocked, 'PROPOSED_FILES_REQUIRED', 'at least one evidence-bounded proposed file is required', [hypothesisId]);
  } else {
    const seenPaths = new Set();
    for (const file of files) {
      const source = text(file?.path) ? file.path : '<unnamed>';
      if (!repositoryPath(file?.path)) {
        addReason(blocked, 'FILE_PATH_NOT_REPOSITORY_QUALIFIED', 'proposed paths must be repository-relative files', [source]);
      }
      if (!REPOSITORY_FILE_ROLE.has(file?.role)) {
        addReason(blocked, 'INVALID_PROPOSED_FILE_ROLE', 'proposed file roles must be production_fix or regression_test', [source]);
      } else if (!roleMatchesPath(file.role, file.path)) {
        addReason(blocked, 'FILE_ROLE_PATH_MISMATCH', 'the declared role contradicts the path structure; a regression test must live at a test path and a production fix must not', [source]);
      }
      if (!causalEvidence(file?.evidence) || !evidenceBindsPath(file?.evidence, file?.path)) {
        addReason(blocked, 'FILE_EVIDENCE_REQUIRED', 'each proposed file needs strong observed pre-modification causal evidence', [source]);
      }
      if (seenPaths.has(file?.path)) {
        addReason(blocked, 'DUPLICATE_PROPOSED_FILE', 'each proposed file may appear only once', [source]);
      }
      seenPaths.add(file?.path);
      if (Array.isArray(repositoryState?.dirtyPaths)
        && repositoryState.dirtyPaths.some((dirtyPath) => (
          isUserDirtyPath(dirtyPath, file?.path) === 'authorization_required'
        ))
        && !ownershipEvidenceAuthorizesPath(file?.ownershipEvidence, file?.path)) {
        addReason(blocked, 'USER_DIRTY_PATH_OWNERSHIP_REQUIRED', 'a user-dirty path needs explicit ownership evidence', [source]);
      }
    }
  }

  const containsProductionFix = Array.isArray(files) && files.some((file) => file?.role === 'production_fix');
  const containsOnlyRegressionTests = Array.isArray(files) && files.length > 0
    && files.every((file) => file?.role === 'regression_test' && roleMatchesPath(file.role, file.path));
  if (reproductionUnavailable && !containsOnlyRegressionTests) {
    addReason(
      blocked,
      'PRODUCTION_FIX_REQUIRES_REPRODUCTION',
      'unavailable reproduction can authorize regression-test files only',
      (Array.isArray(files) ? files : []).filter((file) => file?.role !== 'regression_test').map(({ path }) => path),
    );
  }
  if (reproductionUnavailable && (!hypothesisEvidence.some(staticCausalEvidence)
    || !Array.isArray(files)
    || !files.every((file) => staticCausalEvidence(file?.evidence)))) {
    addReason(blocked, 'STATIC_EVIDENCE_REQUIRED', 'unavailable reproduction requires strong static evidence for every regression-test file', sourcesOf(hypothesisEvidence));
  }

  if (blocked.length > 0) return deniedResult('blocked', blocked);
  if (refine.length > 0) return deniedResult('refine', refine, hypothesis.id);
  return permittedResult(
    containsProductionFix ? 'production_fix' : 'regression_test_only',
    hypothesis.id,
    files.map(({ path }) => path),
  );
}
