export const REPRODUCTION_STATUSES = Object.freeze([
  'REPRODUCED',
  'PARTIALLY_REPRODUCED',
  'NOT_REPRODUCED',
  'REPRODUCTION_NOT_AVAILABLE',
]);

export const HYPOTHESIS_STATUSES = Object.freeze([
  'ACTIVE',
  'SUPPORTED',
  'REJECTED',
  'INCONCLUSIVE',
]);

export const COMPLETION_STATES = Object.freeze([
  'FIXED_VERIFIED',
  'FIXED_WITH_RESIDUAL_RISK',
  'CAUSE_IDENTIFIED_NOT_FIXED',
  'NOT_REPRODUCED',
  'INSUFFICIENT_EVIDENCE',
  'BLOCKED',
]);

export const EVIDENCE_CLASSIFICATIONS = Object.freeze(['observed', 'inferred', 'potential']);
export const CONFIDENCES = Object.freeze(['high', 'medium', 'low', 'unknown']);
const EVIDENCE_SOURCES = new Set(['execution', 'diagnostic', 'source', 'relationship', 'test', 'artifact']);

export function violation(code, detail, sources = []) {
  return { code, detail, sources };
}

export function validateEvidenceReference(value) {
  if (!value || typeof value !== 'object') throw new Error('INVALID_EVIDENCE_REFERENCE');
  if (typeof value.reference !== 'string' || value.reference.trim() === '') {
    throw new Error('EVIDENCE_REFERENCE_REQUIRED');
  }
  if (!EVIDENCE_SOURCES.has(value.source)) throw new Error('INVALID_EVIDENCE_SOURCE');
  if (!EVIDENCE_CLASSIFICATIONS.includes(value.classification)) {
    throw new Error('INVALID_EVIDENCE_CLASSIFICATION');
  }
  if (!CONFIDENCES.includes(value.confidence)) {
    throw new Error('INVALID_EVIDENCE_CONFIDENCE');
  }
  if (value.unknown === true && value.confidence === 'high') {
    throw new Error('UNKNOWN_EVIDENCE_CANNOT_BE_HIGH_CONFIDENCE');
  }
  return value;
}
