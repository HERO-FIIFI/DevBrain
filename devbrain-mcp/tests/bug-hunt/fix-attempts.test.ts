import { describe, expect, it } from 'vitest';

import { assessNextFixAttempt, checkAttemptBudgets } from '../../benchmarks/bug-hunt/harness/fix-attempts.mjs';

function fixApplied(eventId: string, hypothesisId = 'H1') {
  return { type: 'fix_applied', eventId, hypothesisId };
}

function verificationFailed(eventId: string, executionId = 'exec-1') {
  return { type: 'verification_failed', eventId, executionId };
}

function verificationPassed(eventId: string, executionId = 'exec-2') {
  return { type: 'verification_passed', eventId, executionId };
}

function evidenceRetrieved(eventId: string, executionId = 'exec-1', overrides = {}) {
  return {
    type: 'evidence_retrieved',
    eventId,
    evidence: {
      source: 'diagnostic',
      reference: `diagnostic:${executionId}`,
      classification: 'observed',
      confidence: 'high',
      executionId,
      ...overrides,
    },
  };
}

function hypothesisTransition(eventId: string, hypothesisId: string, from: string, to: string) {
  return { type: 'hypothesis_transition', eventId, hypothesisId, from, to };
}

function contextExpanded(eventId: string, overrides = {}) {
  return { type: 'context_expanded', eventId, reason: 'failed_hypothesis', trigger: 'exec-1', ...overrides };
}

function reassessment(suffix: string, executionId: string, failedHypothesisId: string, nextHypothesisId: string) {
  return [
    evidenceRetrieved(`ev-${suffix}`, executionId),
    hypothesisTransition(`ht-${suffix}-a`, failedHypothesisId, 'SUPPORTED', 'REJECTED'),
    hypothesisTransition(`ht-${suffix}-b`, nextHypothesisId, 'ACTIVE', 'SUPPORTED'),
  ];
}

describe('bug-hunt fix attempt discipline', () => {
  it('permits a first bounded fix', () => {
    expect(assessNextFixAttempt([])).toEqual({
      permitted: true,
      nextAction: 'apply_bounded_fix',
      reasons: [],
    });
    expect(assessNextFixAttempt([fixApplied('fix-1')])).toMatchObject({
      permitted: true,
      nextAction: 'apply_bounded_fix',
    });
  });

  it('refuses a blind retry after a failed verification', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1'),
      verificationFailed('ver-1'),
      fixApplied('fix-2'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'retrieve_evidence',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FAILURE_EVIDENCE_REQUIRED' }),
      ]),
    });
  });

  it('permits a second fix after failure evidence and hypothesis reassessment', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1'),
      verificationFailed('ver-1'),
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      fixApplied('fix-2', 'H2'),
    ])).toEqual({
      permitted: true,
      nextAction: 'apply_bounded_fix',
      reasons: [],
    });
  });

  it('requires hypothesis reassessment, not diagnosis alone', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1'),
      verificationFailed('ver-1'),
      evidenceRetrieved('ev-1'),
      fixApplied('fix-2'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'reassess_hypothesis',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'HYPOTHESIS_REASSESSMENT_REQUIRED' }),
      ]),
    });
  });

  it('does not accept re-supporting the failed hypothesis as a reassessment', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1'),
      verificationFailed('ver-1'),
      evidenceRetrieved('ev-1'),
      hypothesisTransition('ht-1', 'H1', 'ACTIVE', 'SUPPORTED'),
      fixApplied('fix-2'),
    ])).toMatchObject({ permitted: false, nextAction: 'reassess_hypothesis' });
  });

  it('does not accept reassessing an unrelated hypothesis', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1'),
      evidenceRetrieved('ev-1'),
      hypothesisTransition('ht-1', 'H7', 'SUPPORTED', 'REJECTED'),
      fixApplied('fix-2'),
    ])).toMatchObject({ permitted: false, nextAction: 'reassess_hypothesis' });
  });

  it('accepts demotion to inconclusive as a reassessment', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1'),
      evidenceRetrieved('ev-1'),
      hypothesisTransition('ht-1', 'H1', 'SUPPORTED', 'INCONCLUSIVE'),
      fixApplied('fix-2'),
    ])).toMatchObject({ permitted: true, nextAction: 'apply_bounded_fix' });
  });

  it('stops after the two-fix limit', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1', 'exec-1'),
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      fixApplied('fix-2', 'H2'),
      verificationFailed('ver-2', 'exec-2'),
      ...reassessment('2', 'exec-2', 'H2', 'H3'),
      fixApplied('fix-3', 'H3'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'stop_and_report',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FIX_ATTEMPT_BUDGET_EXHAUSTED' }),
      ]),
    });
  });

  it('counts a reverted fix against the attempt budget', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1', 'exec-1'),
      { type: 'fix_reverted', eventId: 'rev-1' },
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      fixApplied('fix-2', 'H2'),
      verificationFailed('ver-2', 'exec-2'),
      { type: 'fix_reverted', eventId: 'rev-2' },
      ...reassessment('2', 'exec-2', 'H2', 'H3'),
      fixApplied('fix-3', 'H3'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'stop_and_report',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FIX_ATTEMPT_BUDGET_EXHAUSTED' }),
      ]),
    });
  });

  it('refuses a context expansion without a trigger', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1'),
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      contextExpanded('cx-1', { trigger: undefined }),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'retrieve_evidence',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'CONTEXT_EXPANSION_TRIGGER_REQUIRED' }),
      ]),
    });
  });

  it('refuses a context expansion whose reason is not a governed reason', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1'),
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      contextExpanded('cx-1', { reason: 'wanted_more_context' }),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({
      permitted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'CONTEXT_EXPANSION_REASON_INVALID' }),
      ]),
    });
  });

  it('permits an evidence-justified context expansion', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1'),
      ...reassessment('1', 'exec-1', 'H1', 'H2'),
      contextExpanded('cx-1'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({ permitted: true, nextAction: 'apply_bounded_fix' });
  });

  it('requires the failure evidence to reference the failed execution', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1', 'exec-1'),
      evidenceRetrieved('ev-1', 'exec-9'),
      hypothesisTransition('ht-1', 'H1', 'SUPPORTED', 'REJECTED'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({ permitted: false, nextAction: 'retrieve_evidence' });
  });

  it('rejects unobserved failure evidence', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationFailed('ver-1', 'exec-1'),
      evidenceRetrieved('ev-1', 'exec-1', { classification: 'inferred' }),
      hypothesisTransition('ht-1', 'H1', 'SUPPORTED', 'REJECTED'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({ permitted: false, nextAction: 'retrieve_evidence' });
  });

  it('ignores evidence retrieved before the failure it claims to explain', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      evidenceRetrieved('ev-1', 'exec-1'),
      verificationFailed('ver-1', 'exec-1'),
      hypothesisTransition('ht-1', 'H1', 'SUPPORTED', 'REJECTED'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({ permitted: false, nextAction: 'retrieve_evidence' });
  });

  it('requires the previous fix to be verified before another is attempted', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'verify_fix',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FIX_VERIFICATION_REQUIRED' }),
      ]),
    });
  });

  it('stops the loop once a fix verified', () => {
    expect(assessNextFixAttempt([
      fixApplied('fix-1', 'H1'),
      verificationPassed('ver-1'),
      fixApplied('fix-2', 'H2'),
    ])).toMatchObject({
      permitted: false,
      nextAction: 'stop_and_report',
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: 'FIX_ALREADY_VERIFIED' }),
      ]),
    });
  });

  it('rejects malformed traces rather than guessing', () => {
    expect(() => assessNextFixAttempt('nope' as never)).toThrow('FIX_TRACE_MUST_BE_ARRAY');
    expect(() => assessNextFixAttempt([{ type: 'nap', eventId: 'x' }])).toThrow('UNKNOWN_FIX_TRACE_EVENT');
    expect(() => assessNextFixAttempt([{ type: 'fix_applied' }])).toThrow('FIX_TRACE_EVENT_ID_REQUIRED');
  });
});

describe('bug-hunt attempt budgets', () => {
  it('reports an unused budget', () => {
    expect(checkAttemptBudgets([])).toEqual({
      status: 'within_budget',
      fixAttemptsUsed: 0,
      fixAttemptsMaximum: 2,
      expansionsUsed: 0,
      violations: [],
    });
  });

  it('treats the second fix as the last permitted one', () => {
    expect(checkAttemptBudgets([fixApplied('fix-1'), fixApplied('fix-2')])).toMatchObject({
      status: 'within_budget',
      fixAttemptsUsed: 2,
      violations: [],
    });
  });

  it('reports an exhausted fix budget', () => {
    expect(checkAttemptBudgets([
      fixApplied('fix-1'),
      fixApplied('fix-2'),
      fixApplied('fix-3'),
    ])).toMatchObject({
      status: 'exhausted',
      fixAttemptsUsed: 3,
      violations: expect.arrayContaining([
        expect.objectContaining({ code: 'FIX_ATTEMPT_BUDGET_EXHAUSTED' }),
      ]),
    });
  });

  it('reports an exhausted context expansion budget from the same trace', () => {
    expect(checkAttemptBudgets(
      Array.from({ length: 6 }, (_, index) => contextExpanded(`cx-${index}`)),
    )).toMatchObject({
      status: 'exhausted',
      expansionsUsed: 6,
      violations: expect.arrayContaining([
        expect.objectContaining({ code: 'CONTEXT_EXPANSION_BUDGET_EXHAUSTED' }),
      ]),
    });
  });
});
