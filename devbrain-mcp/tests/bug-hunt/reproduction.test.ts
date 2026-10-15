import { describe, expect, it } from 'vitest';

import { classifyReproduction } from '../../benchmarks/bug-hunt/harness/reproduction.mjs';

const baseAttempt = {
  invocationFingerprint: 'invoke-a',
  repositorySha: 'repo-a',
  environmentFingerprint: 'env-a',
};

function failed(executionId: string, failureSignature = 'sig-a', overrides = {}) {
  return { ...baseAttempt, executionId, result: 'failed', failureSignature, ...overrides };
}

function passed(executionId: string, overrides = {}) {
  return { ...baseAttempt, executionId, result: 'passed', ...overrides };
}

describe('bug-hunt reproduction classifier', () => {
  it('classifies matching observed failures as reproduced', () => {
    expect(classifyReproduction({ attempts: [failed('exec-1'), failed('exec-2')] })).toEqual({
      status: 'REPRODUCED',
      stability: 'DETERMINISTIC_FAILURE',
      confidence: 'high',
      signature: 'sig-a',
      executionIds: ['exec-1', 'exec-2'],
      limitations: [],
      violations: [],
    });
  });

  it('classifies completed passes as not reproduced', () => {
    expect(classifyReproduction({ attempts: [passed('exec-1'), passed('exec-2')] })).toMatchObject({
      status: 'NOT_REPRODUCED',
      stability: 'UNKNOWN',
      confidence: 'high',
      signature: null,
      executionIds: ['exec-1', 'exec-2'],
    });
  });

  it('preserves mixed pass/fail evidence as suspected flakiness', () => {
    expect(classifyReproduction({ attempts: [failed('exec-1'), passed('exec-2')] })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      stability: 'SUSPECTED_FLAKY',
      confidence: 'medium',
      signature: 'sig-a',
    });
  });

  it('preserves divergent failures as repeated instability', () => {
    expect(classifyReproduction({ attempts: [
      failed('exec-1', { primary: 'boom', detail: { actual: 1, expected: 2 } }),
      failed('exec-2', { detail: { expected: 3, actual: 1 }, primary: 'boom' }),
    ] })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      stability: 'REPEATED_INSTABILITY',
      confidence: 'medium',
      signature: null,
    });
  });

  it('compares structurally equal signatures independent of object key order', () => {
    expect(classifyReproduction({ attempts: [
      failed('exec-1', { primary: 'boom', detail: { actual: 1, expected: 2 } }),
      failed('exec-2', { detail: { expected: 2, actual: 1 }, primary: 'boom' }),
    ] })).toMatchObject({
      status: 'REPRODUCED',
      stability: 'DETERMINISTIC_FAILURE',
      signature: { primary: 'boom', detail: { actual: 1, expected: 2 } },
    });
  });

  it('reports unavailable reproduction rather than inferring it', () => {
    expect(classifyReproduction({ attempts: [], externalEvidence: null, regressionBridge: null })).toMatchObject({
      status: 'REPRODUCTION_NOT_AVAILABLE',
      stability: 'UNKNOWN',
      confidence: 'unknown',
      signature: null,
      executionIds: [],
    });
  });

  it('uses immutable external evidence without claiming direct reproduction', () => {
    const externalEvidence = {
      source: 'diagnostic',
      reference: 'artifact:failure.log',
      classification: 'observed',
      confidence: 'high',
      failureSignature: 'sig-a',
      sha256: `sha256:${'a'.repeat(64)}`,
    };

    expect(classifyReproduction({ attempts: [], externalEvidence, regressionBridge: null })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      stability: 'UNKNOWN',
      confidence: 'high',
      signature: 'sig-a',
      executionIds: [],
    });
  });

  it('does not promote inferred, potential, or unsigned external evidence', () => {
    for (const externalEvidence of [
      { source: 'artifact', reference: 'log-1', classification: 'inferred', confidence: 'medium', failureSignature: 'sig-a' },
      { source: 'artifact', reference: 'log-2', classification: 'potential', confidence: 'low', failureSignature: 'sig-a' },
      { source: 'artifact', reference: 'log-3', classification: 'observed', confidence: 'high' },
    ]) {
      expect(classifyReproduction({ attempts: [], externalEvidence, regressionBridge: null })).toMatchObject({
        status: 'REPRODUCTION_NOT_AVAILABLE',
        stability: 'UNKNOWN',
        confidence: 'unknown',
        signature: null,
        limitations: expect.arrayContaining([expect.stringMatching(/external evidence/i)]),
        violations: [expect.objectContaining({ code: expect.stringMatching(/^EXTERNAL_EVIDENCE_/) })],
      });
    }
  });

  it('requires failure-bearing immutable provenance for external reproduction evidence', () => {
    const common = {
      reference: 'artifact:failure.log',
      classification: 'observed',
      confidence: 'high',
      failureSignature: 'sig-a',
      sha256: `sha256:${'a'.repeat(64)}`,
    };

    for (const source of ['source', 'relationship', 'test']) {
      expect(classifyReproduction({ attempts: [], externalEvidence: { ...common, source } })).toMatchObject({
        status: 'REPRODUCTION_NOT_AVAILABLE',
        confidence: 'unknown',
        violations: [expect.objectContaining({ code: 'EXTERNAL_EVIDENCE_SOURCE_NOT_FAILURE_BEARING' })],
      });
    }

    for (const sha256 of [undefined, 'a'.repeat(64), `sha256:${'A'.repeat(64)}`, 'sha256:abc']) {
      expect(classifyReproduction({
        attempts: [],
        externalEvidence: { ...common, source: 'artifact', sha256 },
      })).toMatchObject({
        status: 'REPRODUCTION_NOT_AVAILABLE',
        confidence: 'unknown',
        violations: [expect.objectContaining({ code: 'EXTERNAL_EVIDENCE_IMMUTABLE_HASH_REQUIRED' })],
      });
    }

    expect(classifyReproduction({
      attempts: [],
      externalEvidence: {
        ...common,
        source: 'execution',
        sha256: undefined,
        artifactHash: `sha256:${'b'.repeat(64)}`,
      },
    })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      signature: 'sig-a',
    });
  });

  it('recognizes a directly failing regression bridge', () => {
    const regressionBridge = {
      executionId: 'bridge-1',
      result: 'failed',
      failureSignature: 'sig-a',
      reportedMechanismObserved: true,
    };

    expect(classifyReproduction({ attempts: [], regressionBridge })).toMatchObject({
      status: 'REPRODUCED',
      confidence: 'medium',
      signature: 'sig-a',
      executionIds: ['bridge-1'],
    });
  });

  it('rejects reproduction attempts from different series', () => {
    expect(() => classifyReproduction({
      attempts: [failed('exec-1'), failed('exec-2', 'sig-a', { repositorySha: 'repo-b' })],
    })).toThrow('REPRODUCTION_SERIES_REPOSITORY_MISMATCH');

    expect(() => classifyReproduction({
      attempts: [failed('exec-1'), failed('exec-2', 'sig-a', { invocationFingerprint: 'invoke-b' })],
    })).toThrow('REPRODUCTION_SERIES_INVOCATION_MISMATCH');

    expect(() => classifyReproduction({
      attempts: [failed('exec-1'), failed('exec-2', 'sig-a', { environmentFingerprint: 'env-b' })],
    })).toThrow('REPRODUCTION_SERIES_ENVIRONMENT_MISMATCH');
  });

  it('rejects duplicate execution identifiers across attempts and the bridge', () => {
    expect(() => classifyReproduction({
      attempts: [failed('exec-1'), failed('exec-1')],
    })).toThrow('DUPLICATE_REPRODUCTION_EXECUTION_ID');

    expect(() => classifyReproduction({
      attempts: [failed('exec-1')],
      regressionBridge: {
        executionId: 'exec-1',
        result: 'failed',
        failureSignature: 'sig-a',
        reportedMechanismObserved: true,
      },
    })).toThrow('REGRESSION_BRIDGE_EXECUTION_ID_COLLISION');
  });

  it('never infers an environmental failure from an uncorroborated flag', () => {
    expect(classifyReproduction({
      attempts: [failed('exec-1', 'sig-a', { environmentDifference: 'suspected timing' }), passed('exec-2')],
    })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      stability: 'SUSPECTED_FLAKY',
    });
  });

  it('preserves blocked and unavailable attempts without overstating a passing result', () => {
    expect(classifyReproduction({ attempts: [
      passed('exec-1'),
      { ...baseAttempt, executionId: 'exec-2', result: 'blocked' },
      { ...baseAttempt, executionId: 'exec-3', result: 'unavailable' },
    ] })).toMatchObject({
      status: 'NOT_REPRODUCED',
      confidence: 'medium',
      executionIds: ['exec-1', 'exec-2', 'exec-3'],
      limitations: expect.arrayContaining([
        expect.stringContaining('blocked'),
        expect.stringContaining('unavailable'),
      ]),
      violations: [
        expect.objectContaining({ code: 'REPRODUCTION_ATTEMPT_BLOCKED', sources: ['exec-2'] }),
        expect.objectContaining({ code: 'REPRODUCTION_ATTEMPT_UNAVAILABLE', sources: ['exec-3'] }),
      ],
    });

    expect(classifyReproduction({ attempts: [
      { ...baseAttempt, executionId: 'exec-4', result: 'blocked' },
    ] })).toMatchObject({
      status: 'REPRODUCTION_NOT_AVAILABLE',
      confidence: 'unknown',
      violations: [expect.objectContaining({ code: 'REPRODUCTION_ATTEMPT_BLOCKED' })],
    });
  });

  it('validates regression bridges and exposes signature conflicts', () => {
    expect(() => classifyReproduction({
      attempts: [],
      regressionBridge: { executionId: '', result: 'failed', failureSignature: 'sig-a', reportedMechanismObserved: true },
    })).toThrow('REGRESSION_BRIDGE_EXECUTION_ID_REQUIRED');
    expect(() => classifyReproduction({
      attempts: [],
      regressionBridge: { executionId: 'bridge-1', result: 'failed', failureSignature: 'sig-a', reportedMechanismObserved: 'yes' },
    })).toThrow('INVALID_REGRESSION_BRIDGE_MECHANISM_OBSERVATION');

    expect(classifyReproduction({
      attempts: [failed('exec-1', 'sig-a')],
      regressionBridge: {
        executionId: 'bridge-1',
        result: 'failed',
        failureSignature: 'sig-b',
        reportedMechanismObserved: true,
      },
    })).toMatchObject({
      status: 'PARTIALLY_REPRODUCED',
      stability: 'REPEATED_INSTABILITY',
      signature: null,
      executionIds: ['exec-1', 'bridge-1'],
      violations: [expect.objectContaining({ code: 'REGRESSION_BRIDGE_SIGNATURE_CONFLICT' })],
    });
  });

  it('does not call one unexplained failure deterministic', () => {
    expect(classifyReproduction({ attempts: [failed('exec-1')] })).toMatchObject({
      status: 'REPRODUCED',
      stability: 'UNKNOWN',
      confidence: 'medium',
      limitations: ['stability is unknown after one observed failure'],
    });
  });
});
