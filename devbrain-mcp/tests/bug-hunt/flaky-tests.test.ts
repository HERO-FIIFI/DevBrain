import { describe, expect, it } from 'vitest';

import { classifyStability } from '../../benchmarks/bug-hunt/harness/fix-attempts.mjs';

const baseAttempt = {
  invocationFingerprint: 'invoke-a',
  repositorySha: 'repo-a',
  environmentFingerprint: 'env-a',
};

function failed(executionId: string, failureSignature: unknown = 'sig-a', overrides = {}) {
  return { ...baseAttempt, executionId, result: 'failed', failureSignature, ...overrides };
}

function passed(executionId: string, overrides = {}) {
  return { ...baseAttempt, executionId, result: 'passed', ...overrides };
}

function environmentDifference(overrides = {}) {
  return {
    dimension: 'node_version',
    value: '18.20.0',
    source: 'execution',
    reference: 'env:node_version',
    classification: 'observed',
    confidence: 'high',
    ...overrides,
  };
}

describe('bug-hunt stability classifier', () => {
  it('classifies two identical matching failures as deterministic', () => {
    expect(classifyStability([failed('exec-1'), failed('exec-2')])).toMatchObject({
      kind: 'DETERMINISTIC_FAILURE',
      status: 'classified',
      confidence: 'high',
      executionIds: ['exec-1', 'exec-2'],
      signatureGroups: [{ signature: 'sig-a', executionIds: ['exec-1', 'exec-2'] }],
      environmentCorrelation: { correlated: false, dimension: null },
    });
  });

  it('classifies one failure among three identical runs as suspected flaky', () => {
    expect(classifyStability([failed('exec-1'), passed('exec-2'), passed('exec-3')])).toMatchObject({
      kind: 'SUSPECTED_FLAKY',
      status: 'classified',
      confidence: 'medium',
      executionIds: ['exec-1', 'exec-2', 'exec-3'],
    });
  });

  it('keeps mixed outcomes within three identical runs suspected flaky', () => {
    expect(classifyStability([failed('exec-1'), passed('exec-2'), failed('exec-3')])).toMatchObject({
      kind: 'SUSPECTED_FLAKY',
      status: 'classified',
      executionIds: ['exec-1', 'exec-2', 'exec-3'],
    });
  });

  it('classifies mixed outcomes across five identical runs as repeated instability', () => {
    expect(classifyStability([
      failed('exec-1'),
      passed('exec-2'),
      failed('exec-3'),
      passed('exec-4'),
      failed('exec-5'),
    ])).toMatchObject({
      kind: 'REPEATED_INSTABILITY',
      status: 'classified',
      confidence: 'medium',
      executionIds: ['exec-1', 'exec-2', 'exec-3', 'exec-4', 'exec-5'],
    });
  });

  it('keeps the five-attempt discrimination boundary within budget', () => {
    const classification = classifyStability([
      failed('exec-1'),
      passed('exec-2'),
      failed('exec-3'),
      passed('exec-4'),
      failed('exec-5'),
    ]);
    expect(classification.violations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FLAKINESS_DISCRIMINATION_BUDGET_EXHAUSTED' }),
    ]));
  });

  it('reports the five-attempt flakiness discrimination budget when a sixth run is supplied', () => {
    expect(classifyStability([
      failed('exec-1'),
      passed('exec-2'),
      failed('exec-3'),
      passed('exec-4'),
      failed('exec-5'),
      passed('exec-6'),
    ])).toMatchObject({
      violations: expect.arrayContaining([
        expect.objectContaining({ code: 'FLAKINESS_DISCRIMINATION_BUDGET_EXHAUSTED' }),
      ]),
    });
  });

  it('classifies failure consistently associated with an observed environment difference', () => {
    expect(classifyStability([
      failed('exec-1', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference() }),
      failed('exec-2', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference() }),
      passed('exec-3'),
    ])).toMatchObject({
      kind: 'ENVIRONMENTAL_FAILURE',
      status: 'classified',
      confidence: 'medium',
      environmentCorrelation: {
        correlated: true,
        dimension: 'node_version',
        failingExecutionIds: ['exec-1', 'exec-2'],
        contrastingExecutionIds: ['exec-3'],
      },
    });
  });

  it('rejects a series that disagrees on repository sha or invocation fingerprint', () => {
    for (const overrides of [{ repositorySha: 'repo-b' }, { invocationFingerprint: 'invoke-b' }]) {
      expect(classifyStability([failed('exec-1'), failed('exec-2', 'sig-a', overrides)])).toMatchObject({
        status: 'invalid_series',
        kind: 'UNKNOWN',
        confidence: 'unknown',
        executionIds: ['exec-1', 'exec-2'],
        signatureGroups: [],
        violations: [expect.objectContaining({ code: 'STABILITY_SERIES_MISMATCH' })],
      });
    }
  });

  it('keeps an environment fingerprint difference inside one valid series', () => {
    expect(classifyStability([
      failed('exec-1'),
      failed('exec-2', 'sig-a', { environmentFingerprint: 'env-b' }),
    ])).toMatchObject({ status: 'classified', kind: 'DETERMINISTIC_FAILURE' });
  });

  it('calls one unexplained failure unknown, never flaky', () => {
    const classification = classifyStability([failed('exec-1')]);

    expect(classification).toMatchObject({
      kind: 'UNKNOWN',
      status: 'classified',
      confidence: 'unknown',
      executionIds: ['exec-1'],
      limitations: expect.arrayContaining([expect.stringMatching(/one observed failure/i)]),
    });
    expect(classification.kind).not.toBe('SUSPECTED_FLAKY');
  });

  it('refuses to infer a probability or statistical significance', () => {
    for (const claim of [
      { failureRate: 0.3 },
      { failureProbability: 0.3 },
      { probability: 0.3 },
      { pValue: 0.04 },
      { significance: 'p<0.05' },
      { confidenceInterval: [0.1, 0.5] },
    ]) {
      expect(classifyStability([failed('exec-1', 'sig-a', claim), failed('exec-2')])).toMatchObject({
        kind: 'DETERMINISTIC_FAILURE',
        violations: [expect.objectContaining({
          code: 'STATISTICAL_INFERENCE_NOT_PERMITTED',
          sources: ['exec-1'],
        })],
      });
    }
  });

  it('preserves divergent failure signatures as separate groups', () => {
    expect(classifyStability([
      failed('exec-1', { primary: 'boom', detail: { actual: 1, expected: 2 } }),
      failed('exec-2', { detail: { expected: 3, actual: 1 }, primary: 'boom' }),
      failed('exec-3', { primary: 'boom', detail: { expected: 2, actual: 1 } }),
    ])).toMatchObject({
      kind: 'REPEATED_INSTABILITY',
      signatureGroups: [
        { signature: { primary: 'boom', detail: { actual: 1, expected: 2 } }, executionIds: ['exec-1', 'exec-3'] },
        { signature: { detail: { expected: 3, actual: 1 }, primary: 'boom' }, executionIds: ['exec-2'] },
      ],
    });
  });

  it('lists every execution id including blocked and unavailable attempts', () => {
    expect(classifyStability([
      failed('exec-1'),
      failed('exec-2'),
      { ...baseAttempt, executionId: 'exec-3', result: 'blocked' },
      { ...baseAttempt, executionId: 'exec-4', result: 'unavailable' },
    ])).toMatchObject({
      kind: 'DETERMINISTIC_FAILURE',
      executionIds: ['exec-1', 'exec-2', 'exec-3', 'exec-4'],
      limitations: expect.arrayContaining([
        expect.stringContaining('exec-3'),
        expect.stringContaining('exec-4'),
      ]),
    });
  });

  it('never infers an environmental failure from an uncorroborated flag', () => {
    expect(classifyStability([
      failed('exec-1', 'sig-a', { environmentDifference: 'suspected timing' }),
      failed('exec-2', 'sig-a', { environmentDifference: 'suspected timing' }),
      passed('exec-3'),
    ])).toMatchObject({
      kind: 'REPEATED_INSTABILITY',
      environmentCorrelation: { correlated: false, dimension: null },
    });
  });

  it('never infers an environmental failure from inferred or unknown evidence', () => {
    for (const overrides of [{ classification: 'inferred' }, { unknown: true, confidence: 'low' }]) {
      expect(classifyStability([
        failed('exec-1', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference(overrides) }),
        failed('exec-2', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference(overrides) }),
        passed('exec-3'),
      ])).toMatchObject({
        kind: 'REPEATED_INSTABILITY',
        environmentCorrelation: { correlated: false },
      });
    }
  });

  it('rejects an environment difference that no environment fingerprint records', () => {
    expect(classifyStability([
      failed('exec-1', 'sig-a', { environmentDifference: environmentDifference() }),
      failed('exec-2', 'sig-a', { environmentDifference: environmentDifference() }),
      passed('exec-3'),
    ])).toMatchObject({
      kind: 'REPEATED_INSTABILITY',
      environmentCorrelation: { correlated: false },
      limitations: expect.arrayContaining([expect.stringMatching(/environment fingerprint/i)]),
    });
  });

  it('does not call a single correlated failure environmental', () => {
    expect(classifyStability([
      failed('exec-1', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference() }),
      passed('exec-2'),
    ])).toMatchObject({
      kind: 'SUSPECTED_FLAKY',
      environmentCorrelation: { correlated: false },
      limitations: expect.arrayContaining([expect.stringMatching(/single failure/i)]),
    });
  });

  it('requires a contrasting run before calling a failure environmental', () => {
    expect(classifyStability([
      failed('exec-1', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference() }),
      failed('exec-2', 'sig-a', { environmentFingerprint: 'env-b', environmentDifference: environmentDifference() }),
    ])).toMatchObject({
      kind: 'DETERMINISTIC_FAILURE',
      environmentCorrelation: { correlated: false },
    });
  });

  it('reports unknown stability when nothing ran', () => {
    expect(classifyStability([])).toMatchObject({
      kind: 'UNKNOWN',
      status: 'classified',
      confidence: 'unknown',
      executionIds: [],
      signatureGroups: [],
    });
  });

  it('rejects malformed attempt series rather than guessing', () => {
    expect(() => classifyStability('nope' as never)).toThrow('STABILITY_ATTEMPTS_MUST_BE_ARRAY');
    expect(() => classifyStability([failed('exec-1'), failed('exec-1')])).toThrow('DUPLICATE_STABILITY_EXECUTION_ID');
    expect(() => classifyStability([{ ...baseAttempt, executionId: 'exec-1', result: 'exploded' }]))
      .toThrow('INVALID_STABILITY_ATTEMPT_RESULT');
    expect(() => classifyStability([{ ...baseAttempt, executionId: 'exec-1', result: 'failed' }]))
      .toThrow('STABILITY_FAILURE_SIGNATURE_REQUIRED');
  });
});
