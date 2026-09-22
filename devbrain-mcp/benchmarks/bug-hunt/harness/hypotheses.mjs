import {
  CONFIDENCES,
  HYPOTHESIS_STATUSES,
  validateEvidenceReference,
} from './contracts.mjs';

const ACTIVE_LIMIT = 3;
const PHASES = new Set(['pre_modification', 'post_modification']);
const CONFIDENCE_RANK = new Map(CONFIDENCES.map((confidence, index) => [confidence, CONFIDENCES.length - index]));

/* global structuredClone */
function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function requireText(value, error) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(error);
}

function validateEvidenceList(value, error) {
  if (!Array.isArray(value)) throw new Error(error);
  value.forEach(validateEvidenceReference);
}

function validateHypothesis(hypothesis) {
  if (!hypothesis || typeof hypothesis !== 'object') throw new Error('INVALID_HYPOTHESIS');
  requireText(hypothesis.id, 'HYPOTHESIS_ID_REQUIRED');
  requireText(hypothesis.statement, 'HYPOTHESIS_STATEMENT_REQUIRED');
  if (!HYPOTHESIS_STATUSES.includes(hypothesis.status)) throw new Error('INVALID_HYPOTHESIS_STATUS');
  if (!CONFIDENCES.includes(hypothesis.confidence)) throw new Error('INVALID_HYPOTHESIS_CONFIDENCE');
  validateEvidenceList(hypothesis.supportingEvidence, 'HYPOTHESIS_SUPPORTING_EVIDENCE_MUST_BE_ARRAY');
  validateEvidenceList(hypothesis.contradictingEvidence, 'HYPOTHESIS_CONTRADICTING_EVIDENCE_MUST_BE_ARRAY');
  requireText(hypothesis.prediction, 'HYPOTHESIS_PREDICTION_REQUIRED');
  // An unvalidated hypothesis states that explicitly with null; absence is not an answer.
  if (hypothesis.cheapestValidation === undefined
    || (hypothesis.cheapestValidation !== null && typeof hypothesis.cheapestValidation !== 'object')) {
    throw new Error('HYPOTHESIS_CHEAPEST_VALIDATION_REQUIRED');
  }
  if (!Array.isArray(hypothesis.transitions)) throw new Error('HYPOTHESIS_TRANSITIONS_MUST_BE_ARRAY');
}

function findHypothesis(ledger, id) {
  const index = ledger.hypotheses.findIndex((hypothesis) => hypothesis.id === id);
  if (index === -1) throw new Error('HYPOTHESIS_NOT_FOUND');
  return { hypothesis: ledger.hypotheses[index], index };
}

function observedCausal(evidence) {
  if (!preModificationObserved(evidence)) return false;
  // A passing result is never causal support for a bug hypothesis.
  if (evidence.outcome === 'passed') return false;
  // A failing pre-fix regression bridge is itself the causal demonstration.
  if (evidence.regressionBridge === true) return evidence.outcome === 'failed';
  return evidence.causal === true;
}

function preModificationObserved(evidence) {
  return evidence.classification === 'observed'
    && evidence.unknown !== true
    && (evidence.confidence === 'high' || evidence.confidence === 'medium')
    && evidence.phase === 'pre_modification';
}

function assertSupportThreshold(hypothesis, transition) {
  if (transition.atPhase === 'post_modification') {
    throw new Error('POST_EDIT_PASS_CANNOT_SUPPORT_HYPOTHESIS');
  }
  requireText(hypothesis.prediction, 'HYPOTHESIS_PREDICTION_REQUIRED');
  if (!hypothesis.cheapestValidation || hypothesis.cheapestValidation.completed !== true) {
    throw new Error('CHEAPEST_VALIDATION_NOT_COMPLETED');
  }
  requireText(hypothesis.cheapestValidation.action, 'CHEAPEST_VALIDATION_ACTION_REQUIRED');
  requireText(hypothesis.cheapestValidation.expectedSupport, 'CHEAPEST_VALIDATION_EXPECTED_SUPPORT_REQUIRED');
  requireText(hypothesis.cheapestValidation.expectedRejection, 'CHEAPEST_VALIDATION_EXPECTED_REJECTION_REQUIRED');
  if (!hypothesis.cheapestValidation.evidence) {
    throw new Error('CHEAPEST_VALIDATION_EVIDENCE_REQUIRED');
  }
  validateEvidenceReference(hypothesis.cheapestValidation.evidence);
  if (!preModificationObserved(hypothesis.cheapestValidation.evidence)) {
    throw new Error('CHEAPEST_VALIDATION_EVIDENCE_NOT_PREMOD_OBSERVED');
  }
  const contradictions = [
    ...hypothesis.contradictingEvidence,
    ...transition.evidence.filter((evidence) => evidence.effect === 'rejects'),
  ];
  if (!contradictions.every((evidence) => evidence.addressed === true)) {
    throw new Error('HYPOTHESIS_CONTRADICTIONS_UNADDRESSED');
  }
  const evidence = [
    ...hypothesis.supportingEvidence,
    hypothesis.cheapestValidation.evidence,
    ...transition.evidence,
  ];
  if (!evidence.some(observedCausal)) {
    throw new Error('PRE_MODIFICATION_CAUSAL_EVIDENCE_REQUIRED');
  }
}

// Called only after findHypothesis matched by transition.id, so the ids are equal by construction.
function validateTransition(hypothesis, transition) {
  if (transition.from !== hypothesis.status) throw new Error('HYPOTHESIS_TRANSITION_STATE_MISMATCH');
  if (!HYPOTHESIS_STATUSES.includes(transition.to) || transition.to === transition.from) {
    throw new Error('INVALID_HYPOTHESIS_TRANSITION_TARGET');
  }
  if (!PHASES.has(transition.atPhase)) throw new Error('INVALID_HYPOTHESIS_TRANSITION_PHASE');
  requireText(transition.reason, 'HYPOTHESIS_TRANSITION_REASON_REQUIRED');
  validateEvidenceList(transition.evidence, 'HYPOTHESIS_TRANSITION_EVIDENCE_REQUIRED');
  if (transition.evidence.length === 0) throw new Error('HYPOTHESIS_TRANSITION_EVIDENCE_REQUIRED');

  if (transition.to === 'SUPPORTED') assertSupportThreshold(hypothesis, transition);
  if (transition.to === 'REJECTED' && !transition.evidence.some((evidence) => (
    evidence.effect === 'rejects'
    && evidence.classification === 'observed'
    && (evidence.confidence === 'high' || evidence.confidence === 'medium')
  ))) {
    throw new Error('REJECTING_EVIDENCE_REQUIRED');
  }
  if (transition.to === 'INCONCLUSIVE') {
    requireText(transition.unresolvedDiscriminator, 'UNRESOLVED_DISCRIMINATOR_REQUIRED');
  }
}

export function createLedger() {
  return deepFreeze({ hypotheses: [] });
}

export function addHypothesis(ledger, hypothesis) {
  validateHypothesis(hypothesis);
  if (hypothesis.status !== 'ACTIVE') throw new Error('HYPOTHESIS_MUST_BEGIN_ACTIVE');
  if (hypothesis.transitions.length !== 0) throw new Error('HYPOTHESIS_HISTORY_MUST_BEGIN_EMPTY');
  if (ledger.hypotheses.some(({ id }) => id === hypothesis.id)) {
    throw new Error('DUPLICATE_HYPOTHESIS_ID');
  }
  if (activeHypotheses(ledger).length >= ACTIVE_LIMIT) {
    throw new Error('ACTIVE_HYPOTHESIS_BUDGET_EXCEEDED');
  }
  const record = deepFreeze(clone(hypothesis));
  return deepFreeze({ hypotheses: [...ledger.hypotheses, record] });
}

export function transitionHypothesis(ledger, transition) {
  if (!transition || typeof transition !== 'object') throw new Error('INVALID_HYPOTHESIS_TRANSITION');
  const { hypothesis, index } = findHypothesis(ledger, transition.id);
  validateTransition(hypothesis, transition);
  if (transition.to === 'ACTIVE' && activeHypotheses(ledger).length >= ACTIVE_LIMIT) {
    throw new Error('ACTIVE_HYPOTHESIS_BUDGET_EXCEEDED');
  }
  const transitionRecord = deepFreeze(clone(transition));
  const base = clone(hypothesis);
  const updated = deepFreeze({
    ...base,
    status: transition.to,
    // Rejecting evidence stays on the record, so a later support attempt must address it.
    contradictingEvidence: [
      ...base.contradictingEvidence,
      ...transitionRecord.evidence.filter((evidence) => evidence.effect === 'rejects'),
    ],
    transitions: [...hypothesis.transitions, transitionRecord],
  });
  const hypotheses = [...ledger.hypotheses];
  hypotheses[index] = updated;
  return deepFreeze({ hypotheses });
}

export function activeHypotheses(ledger) {
  return ledger.hypotheses.filter(({ status }) => status === 'ACTIVE');
}

export function leadingSupportedHypothesis(ledger) {
  return ledger.hypotheses
    .filter(({ status }) => status === 'SUPPORTED')
    .reduce((leading, candidate) => (
      !leading || CONFIDENCE_RANK.get(candidate.confidence) > CONFIDENCE_RANK.get(leading.confidence)
        ? candidate
        : leading
    ), null);
}
