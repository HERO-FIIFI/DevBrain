import { describe, expect, it } from 'vitest';

import {
  COMPLETION_STATES,
  CONFIDENCES,
  EVIDENCE_CLASSIFICATIONS,
  HYPOTHESIS_STATUSES,
  REPRODUCTION_STATUSES,
  validateEvidenceReference,
  violation,
} from '../../benchmarks/bug-hunt/harness/contracts.mjs';

describe('bug-hunt shared contracts', () => {
  it('freezes the approved vocabularies', () => {
    expect(REPRODUCTION_STATUSES).toEqual([
      'REPRODUCED',
      'PARTIALLY_REPRODUCED',
      'NOT_REPRODUCED',
      'REPRODUCTION_NOT_AVAILABLE',
    ]);
    expect(HYPOTHESIS_STATUSES).toEqual(['ACTIVE', 'SUPPORTED', 'REJECTED', 'INCONCLUSIVE']);
    expect(COMPLETION_STATES).toEqual([
      'FIXED_VERIFIED',
      'FIXED_WITH_RESIDUAL_RISK',
      'CAUSE_IDENTIFIED_NOT_FIXED',
      'NOT_REPRODUCED',
      'INSUFFICIENT_EVIDENCE',
      'BLOCKED',
    ]);
    expect(EVIDENCE_CLASSIFICATIONS).toEqual(['observed', 'inferred', 'potential']);
    expect(CONFIDENCES).toEqual(['high', 'medium', 'low', 'unknown']);

    expect(Object.isFrozen(REPRODUCTION_STATUSES)).toBe(true);
    expect(Object.isFrozen(HYPOTHESIS_STATUSES)).toBe(true);
  });

  it('creates a violation without hiding its evidence sources', () => {
    expect(violation('SERIES_MISMATCH', 'repository SHA differs', ['exec-2'])).toEqual({
      code: 'SERIES_MISMATCH',
      detail: 'repository SHA differs',
      sources: ['exec-2'],
    });
  });

  it('validates evidence references and returns the original record', () => {
    const evidence = {
      source: 'execution',
      reference: 'exec-1',
      classification: 'observed',
      confidence: 'high',
    };

    expect(validateEvidenceReference(evidence)).toBe(evidence);
  });

  it('rejects malformed or unsupported evidence claims', () => {
    expect(() => validateEvidenceReference({ classification: 'observed', confidence: 'high' }))
      .toThrow('EVIDENCE_REFERENCE_REQUIRED');
    expect(() => validateEvidenceReference({ source: 'execution', reference: 'exec-1', classification: 'guessed', confidence: 'high' }))
      .toThrow('INVALID_EVIDENCE_CLASSIFICATION');
    expect(() => validateEvidenceReference({ source: 'execution', reference: 'exec-1', classification: 'observed', confidence: 'certain' }))
      .toThrow('INVALID_EVIDENCE_CONFIDENCE');
    expect(() => validateEvidenceReference({ source: 'execution', reference: 'exec-1', classification: 'observed', confidence: 'high', unknown: true }))
      .toThrow('UNKNOWN_EVIDENCE_CANNOT_BE_HIGH_CONFIDENCE');
    expect(() => validateEvidenceReference({ reference: 'exec-1', classification: 'observed', confidence: 'high' }))
      .toThrow('INVALID_EVIDENCE_SOURCE');
    expect(() => validateEvidenceReference({ source: 'guess', reference: 'exec-1', classification: 'observed', confidence: 'high' }))
      .toThrow('INVALID_EVIDENCE_SOURCE');
  });
});
