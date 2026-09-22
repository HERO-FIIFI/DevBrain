import { describe, expect, it } from 'vitest';

import {
  activeHypotheses,
  addHypothesis,
  createLedger,
  leadingSupportedHypothesis,
  transitionHypothesis,
} from '../../benchmarks/bug-hunt/harness/hypotheses.mjs';

const observed = (reference: string, overrides = {}) => ({
  source: 'test',
  reference,
  classification: 'observed',
  confidence: 'high',
  phase: 'pre_modification',
  causal: true,
  ...overrides,
});

const active = (id: string, overrides = {}) => ({
  id,
  statement: `${id} explains the complete failure signature`,
  status: 'ACTIVE',
  supportingEvidence: [observed(`${id}-failure`)],
  contradictingEvidence: [],
  confidence: 'high',
  prediction: 'The focused regression fails while the faulty branch is reached.',
  cheapestValidation: {
    action: 'run the focused regression',
    expectedSupport: 'the reported failure signature is observed',
    expectedRejection: 'the reported failure signature is absent',
    completed: true,
    evidence: observed(`${id}-validation`, { causal: false }),
  },
  transitions: [],
  ...overrides,
});

describe('bug-hunt hypothesis ledger', () => {
  it('enforces stable unique IDs and the three-active budget', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));
    ledger = addHypothesis(ledger, active('H2'));
    ledger = addHypothesis(ledger, active('H3'));

    expect(() => addHypothesis(ledger, active('H4')))
      .toThrow('ACTIVE_HYPOTHESIS_BUDGET_EXCEEDED');
    expect(() => addHypothesis(ledger, active('H1')))
      .toThrow('DUPLICATE_HYPOTHESIS_ID');
    expect(activeHypotheses(ledger).map(({ id }) => id)).toEqual(['H1', 'H2', 'H3']);
  });

  it('retains rejected hypotheses and immutable transition history', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));
    const transition = {
      id: 'H1',
      from: 'ACTIVE',
      to: 'REJECTED',
      atPhase: 'pre_modification',
      evidence: [observed('exec-reject', { effect: 'rejects' })],
      reason: 'The focused regression does not enter the suspected branch.',
    };

    ledger = transitionHypothesis(ledger, transition);
    transition.reason = 'tampered';

    expect(ledger.hypotheses).toHaveLength(1);
    expect(ledger.hypotheses[0]).toMatchObject({ id: 'H1', status: 'REJECTED' });
    expect(ledger.hypotheses[0].transitions[0].reason)
      .toBe('The focused regression does not enter the suspected branch.');
    expect(Object.isFrozen(ledger.hypotheses[0].transitions[0])).toBe(true);
    expect(activeHypotheses(ledger)).toEqual([]);
  });

  it('rejects missing evidence and stale transition state', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));

    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'REJECTED', atPhase: 'pre_modification', evidence: [], reason: 'guess',
    })).toThrow('HYPOTHESIS_TRANSITION_EVIDENCE_REQUIRED');
    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'SUPPORTED', to: 'REJECTED', atPhase: 'pre_modification',
      evidence: [observed('exec-reject', { effect: 'rejects' })], reason: 'stale',
    })).toThrow('HYPOTHESIS_TRANSITION_STATE_MISMATCH');
  });

  it('supports a hypothesis from completed, pre-modification causal evidence', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));

    ledger = transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('exec-causal')], reason: 'The focused failure matches the prediction.',
    });

    expect(leadingSupportedHypothesis(ledger)).toMatchObject({ id: 'H1', status: 'SUPPORTED' });
  });

  it.each([
    ['post-edit pass', active('H1'), {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'post_modification',
      evidence: [observed('exec-pass', { phase: 'post_modification', outcome: 'passed' })], reason: 'test now passes',
    }, 'POST_EDIT_PASS_CANNOT_SUPPORT_HYPOTHESIS'],
    ['missing prediction', active('H1', { prediction: '' }), {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('exec-causal')], reason: 'observed',
    }, 'HYPOTHESIS_PREDICTION_REQUIRED'],
    ['unfinished cheapest validation', active('H1', { cheapestValidation: {
      action: 'inspect', expectedSupport: 'branch is reached', expectedRejection: 'branch is not reached',
      completed: false, evidence: observed('inspection'),
    } }), {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('source-causal')], reason: 'inspection proposed only',
    }, 'CHEAPEST_VALIDATION_NOT_COMPLETED'],
    ['unaddressed contradiction', active('H1', { contradictingEvidence: [observed('contradiction', { causal: false })] }), {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('exec-causal')], reason: 'ignored contradiction',
    }, 'HYPOTHESIS_CONTRADICTIONS_UNADDRESSED'],
    ['low-confidence evidence only', active('H1', {
      supportingEvidence: [observed('text-match', { confidence: 'low' })],
    }), {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('text-match', { confidence: 'low' })], reason: 'plausible text match',
    }, 'PRE_MODIFICATION_CAUSAL_EVIDENCE_REQUIRED'],
  ])('rejects support from %s', (_label, hypothesis, transition, error) => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, hypothesis);
    expect(() => transitionHypothesis(ledger, transition)).toThrow(error);
  });

  it('accepts an observed failing regression bridge as pre-modification causal evidence', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1', { supportingEvidence: [] }));

    ledger = transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('bridge-exec', {
        regressionBridge: true,
        outcome: 'failed',
      })],
      reason: 'The deterministic bridge fails through the reported mechanism.',
    });

    expect(leadingSupportedHypothesis(ledger)?.id).toBe('H1');
  });

  it('requires explicit rejecting evidence for REJECTED', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));

    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'REJECTED', atPhase: 'pre_modification',
      evidence: [observed('ambiguous')], reason: 'not enough',
    })).toThrow('REJECTING_EVIDENCE_REQUIRED');
  });

  it('requires the unresolved discriminator for INCONCLUSIVE', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1'));

    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'INCONCLUSIVE', atPhase: 'pre_modification',
      evidence: [observed('conflict')], reason: 'results conflict',
    })).toThrow('UNRESOLVED_DISCRIMINATOR_REQUIRED');

    ledger = transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'INCONCLUSIVE', atPhase: 'pre_modification',
      evidence: [observed('conflict')], reason: 'results conflict',
      unresolvedDiscriminator: 'Whether environment A consistently predicts the failure.',
    });
    expect(ledger.hypotheses[0].status).toBe('INCONCLUSIVE');
  });

  it('selects the highest-confidence supported hypothesis without deleting peers', () => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1', { confidence: 'medium' }));
    ledger = addHypothesis(ledger, active('H2', { confidence: 'high' }));
    for (const id of ['H1', 'H2']) {
      ledger = transitionHypothesis(ledger, {
        id, from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
        evidence: [observed(`${id}-causal`)], reason: 'causal check matched',
      });
    }

    expect(leadingSupportedHypothesis(ledger)?.id).toBe('H2');
    expect(ledger.hypotheses).toHaveLength(2);
  });

  it('accepts only new ACTIVE records with no supplied history', () => {
    const ledger = createLedger();
    expect(() => addHypothesis(ledger, active('H1', { status: 'SUPPORTED' })))
      .toThrow('HYPOTHESIS_MUST_BEGIN_ACTIVE');
    expect(() => addHypothesis(ledger, active('H1', {
      transitions: [{ id: 'H1', from: 'ACTIVE', to: 'SUPPORTED' }],
    }))).toThrow('HYPOTHESIS_HISTORY_MUST_BEGIN_EMPTY');
  });

  it('does not expose a ledger mutation bypass', () => {
    const empty = createLedger();
    const ledger = addHypothesis(empty, active('H1'));

    expect(Object.isFrozen(empty)).toBe(true);
    expect(Object.isFrozen(empty.hypotheses)).toBe(true);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.hypotheses)).toBe(true);
    expect(() => ledger.hypotheses.push(active('H2'))).toThrow();
    expect(() => { ledger.hypotheses[0].status = 'SUPPORTED'; }).toThrow();
    expect(empty.hypotheses).toEqual([]);
    expect(ledger.hypotheses[0].status).toBe('ACTIVE');
  });

  it.each([
    ['passed bridge', { outcome: 'passed' }],
    ['bridge missing outcome', { outcome: undefined }],
  ])('does not treat a %s as causal support', (_label, bridge) => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1', { supportingEvidence: [] }));
    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('bridge', { regressionBridge: true, ...bridge })],
      reason: 'bridge result',
    })).toThrow('PRE_MODIFICATION_CAUSAL_EVIDENCE_REQUIRED');
  });

  it.each([
    ['action', { action: '' }],
    ['expected support', { expectedSupport: '' }],
    ['expected rejection', { expectedRejection: '' }],
    ['validation evidence', { evidence: null }],
  ])('requires cheapest validation %s', (_label, override) => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1', {
      cheapestValidation: {
        action: 'inspect branch',
        expectedSupport: 'branch reached',
        expectedRejection: 'branch not reached',
        completed: true,
        evidence: observed('validation'),
        ...override,
      },
    }));
    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('causal')], reason: 'causal check matched',
    })).toThrow(/CHEAPEST_VALIDATION_/);
  });

  it.each([
    ['potential', { classification: 'potential' }],
    ['inferred', { classification: 'inferred' }],
    ['low confidence', { confidence: 'low' }],
    ['unknown confidence', { confidence: 'unknown' }],
    ['missing phase', { phase: undefined }],
    ['post-modification', { phase: 'post_modification' }],
  ])('rejects %s cheapest-validation evidence for support', (_label, evidenceOverride) => {
    let ledger = createLedger();
    ledger = addHypothesis(ledger, active('H1', {
      cheapestValidation: {
        action: 'inspect branch',
        expectedSupport: 'branch reached',
        expectedRejection: 'branch not reached',
        completed: true,
        evidence: observed('validation', { causal: false, ...evidenceOverride }),
      },
    }));

    expect(() => transitionHypothesis(ledger, {
      id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
      evidence: [observed('causal')], reason: 'causal check matched',
    })).toThrow('CHEAPEST_VALIDATION_EVIDENCE_NOT_PREMOD_OBSERVED');
  });
});
