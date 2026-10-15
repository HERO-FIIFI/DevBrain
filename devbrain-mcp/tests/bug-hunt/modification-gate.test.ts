import { describe, expect, it } from 'vitest';

import { assessModificationGate } from '../../benchmarks/bug-hunt/harness/modification-gate.mjs';
import { classifyReproduction } from '../../benchmarks/bug-hunt/harness/reproduction.mjs';

const evidence = (reference: string, overrides = {}) => ({
  source: 'test',
  reference,
  classification: 'observed',
  confidence: 'high',
  phase: 'pre_modification',
  causal: true,
  unknown: false,
  affectedPaths: ['src/session/restore.js'],
  ...overrides,
});

function supportedHypothesis(overrides = {}) {
  return {
    id: 'H1',
    statement: 'The faulty branch causes the observed failure.',
    status: 'SUPPORTED',
    supportingEvidence: [evidence('exec-causal')],
    contradictingEvidence: [],
    confidence: 'high',
    prediction: 'The focused check fails only when the faulty branch is reached.',
    cheapestValidation: {
      action: 'run the focused check',
      expectedSupport: 'the failure signature appears',
      expectedRejection: 'the failure signature is absent',
      completed: true,
      evidence: evidence('exec-validation', { causal: false }),
    },
    transitions: [{
      id: 'H1',
      from: 'ACTIVE',
      to: 'SUPPORTED',
      atPhase: 'pre_modification',
      reason: 'The focused failure matched the prediction.',
      evidence: [evidence('exec-causal')],
    }],
    ...overrides,
  };
}

function reproducedCase(overrides: Record<string, unknown> = {}) {
  return {
    repositoryState: {
      recorded: true,
      repositorySha: 'repo-a',
      branch: 'experiment/bug-hunt',
      dirtyPaths: [],
    },
    reproduction: {
      status: 'REPRODUCED',
      signature: 'sig-a',
      executionIds: ['exec-1'],
      evidence: [evidence('exec-1', {
        source: 'execution', executionId: 'exec-1', outcome: 'failed',
      })],
    },
    ledger: { hypotheses: [supportedHypothesis()] },
    proposedChange: {
      hypothesisId: 'H1',
      narrativeStatus: 'supported',
      files: [{
        path: 'src/session/restore.js',
        role: 'production_fix',
        evidence: evidence('src/session/restore.js:20-28', { source: 'source' }),
      }],
      behaviorChange: 'Reject an expired record before restoring the session.',
      contradictoryEvidenceAddressed: true,
    },
    regressionBridge: {
      status: 'failing',
      executionId: 'exec-1',
      reportedMechanismObserved: true,
      evidence: evidence('bridge-exec-1', {
        source: 'execution', executionId: 'exec-1', outcome: 'failed', regressionBridge: true,
      }),
    },
    expectedPostFix: {
      observation: 'The same focused check passes without the prior signature.',
    },
    ...overrides,
  };
}

function reasons(result: ReturnType<typeof assessModificationGate>) {
  return result.reasons.map(({ code }) => code);
}

describe('bug-hunt modification gate', () => {
  it('permits a bounded production fix only when every modification condition passes', () => {
    expect(assessModificationGate(reproducedCase())).toEqual({
      status: 'permitted',
      scope: 'production_fix',
      reasons: [],
      hypothesisId: 'H1',
      allowedFiles: ['src/session/restore.js'],
    });
  });

  it('blocks a plausible guess whose ledger hypothesis remains ACTIVE', () => {
    const input = reproducedCase();
    input.ledger.hypotheses[0] = supportedHypothesis({ status: 'ACTIVE', transitions: [] });

    expect(assessModificationGate(input)).toMatchObject({
      status: 'blocked', scope: 'none', hypothesisId: null, allowedFiles: [],
    });
    expect(reasons(assessModificationGate(input))).toContain('SUPPORTED_HYPOTHESIS_REQUIRED');
  });

  it('requires refinement when material contradictions remain unaddressed', () => {
    const input = reproducedCase();
    input.proposedChange.contradictoryEvidenceAddressed = false;

    expect(assessModificationGate(input)).toMatchObject({ status: 'refine', scope: 'none' });
    expect(reasons(assessModificationGate(input))).toContain('CONTRADICTORY_EVIDENCE_UNADDRESSED');
  });

  it('permits only a regression-test bridge when reproduction is unavailable but static evidence is strong', () => {
    const input = reproducedCase({
      reproduction: {
        status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [],
      },
      ledger: { hypotheses: [supportedHypothesis({
        supportingEvidence: [evidence('static-cause', { source: 'source' })],
      })] },
      proposedChange: {
        hypothesisId: 'H1',
        files: [{
          path: 'tests/session/restore.test.js',
          role: 'regression_test',
          evidence: evidence('src/session/restore.js:20-28', {
            source: 'source', affectedPaths: ['tests/session/restore.test.js'],
          }),
        }],
        behaviorChange: 'Add a focused check for the reported mechanism.',
        contradictoryEvidenceAddressed: true,
      },
      regressionBridge: {
        status: 'unavailable',
        reason: 'No safe executable reproducer exists yet.',
        residualRisk: 'The static cause is not yet execution-confirmed.',
      },
      expectedPostFix: {
        observation: 'The new focused bridge fails through the reported mechanism.',
      },
    });

    expect(assessModificationGate(input)).toEqual({
      status: 'permitted',
      scope: 'regression_test_only',
      reasons: [],
      hypothesisId: 'H1',
      allowedFiles: ['tests/session/restore.test.js'],
    });
  });

  it('never permits production changes when reproduction is unavailable', () => {
    const input = reproducedCase({
      reproduction: { status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [] },
      regressionBridge: {
        status: 'unavailable', reason: 'Cannot execute safely.', residualRisk: 'Cause is static only.',
      },
    });

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(assessModificationGate(input))).toContain('PRODUCTION_FIX_REQUIRES_REPRODUCTION');
  });

  it('blocks low-confidence or noncausal evidence even if a record claims SUPPORTED', () => {
    for (const hypothesis of [
      supportedHypothesis({
        confidence: 'low',
        supportingEvidence: [evidence('text-match', { confidence: 'low' })],
        transitions: [{
          id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
          reason: 'plausible text match', evidence: [evidence('text-match', { confidence: 'low' })],
        }],
      }),
      supportedHypothesis({
        supportingEvidence: [evidence('source-match', { causal: false })],
        transitions: [{
          id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
          reason: 'source resembles report', evidence: [evidence('source-match', { causal: false })],
        }],
      }),
    ]) {
      const input = reproducedCase({ ledger: { hypotheses: [hypothesis] } });
      expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
      expect(reasons(assessModificationGate(input))).toContain('CAUSAL_SUPPORT_REQUIRED');
    }
  });

  it.each([
    ['repository state', { repositoryState: { recorded: false, repositorySha: '', branch: '', dirtyPaths: [] } }, 'REPOSITORY_STATE_NOT_RECORDED'],
    ['explicit reproduction', { reproduction: null }, 'EXPLICIT_REPRODUCTION_REQUIRED'],
    ['causal prediction', (() => {
      const hypothesis = supportedHypothesis({ prediction: '' });
      return { ledger: { hypotheses: [hypothesis] } };
    })(), 'CAUSAL_PREDICTION_REQUIRED'],
    ['completed cheapest validation', (() => {
      const hypothesis = supportedHypothesis();
      hypothesis.cheapestValidation.completed = false;
      return { ledger: { hypotheses: [hypothesis] } };
    })(), 'CHEAPEST_VALIDATION_NOT_COMPLETED'],
    ['bounded behavior change', { proposedChange: {
      hypothesisId: 'H1', files: [{
        path: 'src/session/restore.js', role: 'production_fix',
        evidence: evidence('src/session/restore.js:20-28', { source: 'source' }),
      }], behaviorChange: '', contradictoryEvidenceAddressed: true,
    } }, 'BEHAVIOR_CHANGE_REQUIRED'],
    ['pre-fix regression evidence', { regressionBridge: null }, 'REGRESSION_BRIDGE_EVIDENCE_REQUIRED'],
    ['predeclared post-fix observation', { expectedPostFix: null }, 'EXPECTED_POST_FIX_OBSERVATION_REQUIRED'],
  ])('blocks when %s is missing', (_label, override, code) => {
    const result = assessModificationGate(reproducedCase(override));
    expect(result).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(result)).toContain(code);
  });

  it('accepts a recorded regression limitation only when both reason and residual risk are explicit', () => {
    const permitted = reproducedCase({
      regressionBridge: {
        status: 'unavailable',
        reason: 'The integration dependency is unavailable in this environment.',
        residualRisk: 'The post-fix check cannot prove integration behavior.',
      },
    });
    expect(assessModificationGate(permitted).status).toBe('permitted');

    for (const regressionBridge of [
      { status: 'unavailable', reason: '', residualRisk: 'risk' },
      { status: 'unavailable', reason: 'reason', residualRisk: '' },
      { status: 'failing', executionId: '', reportedMechanismObserved: true },
      { status: 'failing', executionId: 'exec-1', reportedMechanismObserved: false },
    ]) {
      const result = assessModificationGate(reproducedCase({ regressionBridge }));
      expect(result.status).toBe('blocked');
      expect(reasons(result)).toContain('REGRESSION_BRIDGE_EVIDENCE_REQUIRED');
    }
  });

  it.each([
    ['empty allowlist', [], 'PROPOSED_FILES_REQUIRED'],
    ['backslash file', [{ path: 'src\\session\\restore.js', role: 'production_fix', evidence: evidence('source') }], 'FILE_PATH_NOT_REPOSITORY_QUALIFIED'],
    ['current-directory segment', [{ path: 'src/./restore.js', role: 'production_fix', evidence: evidence('source') }], 'FILE_PATH_NOT_REPOSITORY_QUALIFIED'],
    ['absolute file', [{ path: 'C:/repo/src/restore.js', role: 'production_fix', evidence: evidence('source') }], 'FILE_PATH_NOT_REPOSITORY_QUALIFIED'],
    ['parent traversal', [{ path: '../src/restore.js', role: 'production_fix', evidence: evidence('source') }], 'FILE_PATH_NOT_REPOSITORY_QUALIFIED'],
    ['missing evidence', [{ path: 'src/session/restore.js', role: 'production_fix', evidence: null }], 'FILE_EVIDENCE_REQUIRED'],
  ])('rejects %s', (_label, files, code) => {
    const input = reproducedCase();
    input.proposedChange.files = files;
    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
    expect(reasons(result)).toContain(code);
  });

  it('rejects a user-dirty target without explicit ownership evidence', () => {
    const input = reproducedCase();
    input.repositoryState.dirtyPaths = [{ path: 'src/session/restore.js', owner: 'user' }];

    let result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(result)).toContain('USER_DIRTY_PATH_OWNERSHIP_REQUIRED');

    input.proposedChange.files[0].ownershipEvidence = evidence('user-authorization', {
      source: 'artifact', authorization: 'user_authorized',
      authorizedPaths: ['src/session/restore.js'],
    });
    result = assessModificationGate(input);
    expect(result.status).toBe('permitted');
  });

  it('ignores narrative support when the authoritative ledger says ACTIVE', () => {
    const input = reproducedCase();
    input.proposedChange.narrativeStatus = 'SUPPORTED';
    input.ledger.hypotheses[0] = supportedHypothesis({ status: 'ACTIVE', transitions: [] });

    expect(assessModificationGate(input)).toMatchObject({
      status: 'blocked', scope: 'none', hypothesisId: null, allowedFiles: [],
    });
  });

  it('requires all unavailable-reproduction files to be regression tests', () => {
    const input = reproducedCase({
      reproduction: { status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [] },
      proposedChange: {
        hypothesisId: 'H1',
        files: [
          {
            path: 'tests/session/restore.test.js', role: 'regression_test',
            evidence: evidence('static-cause', { source: 'source' }),
          },
          {
            path: 'src/session/restore.js', role: 'production_fix',
            evidence: evidence('static-cause', { source: 'source' }),
          },
        ],
        behaviorChange: 'Add a bridge and fix the suspected implementation.',
        contradictoryEvidenceAddressed: true,
      },
      regressionBridge: {
        status: 'unavailable', reason: 'No executable reproducer.', residualRisk: 'Static evidence only.',
      },
    });

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
    expect(reasons(result)).toContain('PRODUCTION_FIX_REQUIRES_REPRODUCTION');
  });

  it('does not authorize files when any proposed path fails the gate', () => {
    const input = reproducedCase();
    input.proposedChange.files.push({
      path: 'README.md', role: 'cleanup', evidence: evidence('none', { source: 'source' }),
    });

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
    expect(reasons(result)).toContain('INVALID_PROPOSED_FILE_ROLE');
  });

  it.each([
    ['missing source', { source: undefined }],
    ['unsupported source', { source: 'forged' }],
    ['invalid classification', { classification: 'forged' }],
    ['invalid confidence', { confidence: 'certain' }],
    ['missing unknown marker', { unknown: undefined }],
    ['malformed unknown marker', { unknown: 'false' }],
  ])('blocks invalid %s in selected hypothesis evidence', (_label, override) => {
    const input = reproducedCase();
    input.ledger.hypotheses[0] = supportedHypothesis({
      supportingEvidence: [evidence('bad-hypothesis-evidence', override)],
    });

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
  });

  it.each([
    ['missing source', { source: undefined }],
    ['unsupported source', { source: 'forged' }],
    ['invalid classification', { classification: 'forged' }],
    ['invalid confidence', { confidence: 'certain' }],
    ['missing unknown marker', { unknown: undefined }],
    ['malformed unknown marker', { unknown: 'false' }],
  ])('blocks invalid %s in proposed-file evidence', (_label, override) => {
    const input = reproducedCase();
    input.proposedChange.files[0].evidence = evidence('bad-file-evidence', override);

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
  });

  it('requires every proposed file evidence record to bind to that production path', () => {
    const input = reproducedCase();
    input.proposedChange.files[0].evidence = evidence('src/session/restore.js:20-28', {
      source: 'source', affectedPaths: ['src/session/unrelated.js'],
    });

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
  });

  it('requires every proposed file evidence record to bind to that regression-test path', () => {
    const input = reproducedCase({
      reproduction: { status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [] },
      ledger: { hypotheses: [supportedHypothesis({
        supportingEvidence: [evidence('static-cause', { source: 'source' })],
      })] },
      proposedChange: {
        hypothesisId: 'H1',
        files: [{
          path: 'tests/session/restore.test.js', role: 'regression_test',
          evidence: evidence('static-cause', {
            source: 'source', affectedPaths: ['tests/session/unrelated.test.js'],
          }),
        }],
        behaviorChange: 'Add a focused static bridge.', contradictoryEvidenceAddressed: true,
      },
      regressionBridge: { status: 'unavailable', reason: 'No safe executable reproducer.', residualRisk: 'Static cause only.' },
    });

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
  });

  it('permits unavailable reproduction only on strong static evidence', () => {
    const input = reproducedCase({
      reproduction: { status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [] },
      proposedChange: {
        hypothesisId: 'H1',
        files: [{
          path: 'tests/session/restore.test.js', role: 'regression_test',
          evidence: evidence('dynamic-cause', { affectedPaths: ['tests/session/restore.test.js'] }),
        }],
        behaviorChange: 'Add a focused bridge.', contradictoryEvidenceAddressed: true,
      },
      regressionBridge: { status: 'unavailable', reason: 'No safe executable reproducer.', residualRisk: 'Static cause only.' },
    });

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
  });

  it.each([
    ['generic causal evidence', [{ path: 'src/session/restore.js', owner: 'user' }], evidence('unrelated-causal')],
    ['missing owner', [{ path: 'src/session/restore.js' }], undefined],
    ['unrecognized owner', [{ path: 'src/session/restore.js', owner: 'unknown-owner' }], undefined],
    ['string dirty path with generic causal evidence', ['src/session/restore.js'], evidence('unrelated-causal')],
  ])('fails closed for %s dirty-path record', (_label, dirtyPaths, ownershipEvidence) => {
    const input = reproducedCase();
    input.repositoryState.dirtyPaths = dirtyPaths;
    input.proposedChange.files[0].ownershipEvidence = ownershipEvidence;

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
  });

  it.each([
    ['blank reproduction execution id', (input: ReturnType<typeof reproducedCase>) => {
      input.reproduction.executionIds = [''];
    }],
    ['unlinked bridge execution id', (input: ReturnType<typeof reproducedCase>) => {
      input.regressionBridge.executionId = 'unrelated-exec';
      input.regressionBridge.evidence.executionId = 'unrelated-exec';
    }],
    ['bridge evidence from post modification', (input: ReturnType<typeof reproducedCase>) => {
      input.regressionBridge.evidence.phase = 'post_modification';
    }],
    ['bridge evidence without explicit known status', (input: ReturnType<typeof reproducedCase>) => {
      input.regressionBridge.evidence.unknown = undefined;
    }],
  ])('blocks %s', (_label, mutate) => {
    const input = reproducedCase();
    mutate(input);

    expect(assessModificationGate(input)).toMatchObject({ status: 'blocked', scope: 'none' });
  });
});

function unavailableCase(overrides: Record<string, unknown> = {}) {
  return reproducedCase({
    reproduction: { status: 'REPRODUCTION_NOT_AVAILABLE', signature: null, executionIds: [] },
    ledger: { hypotheses: [supportedHypothesis({
      supportingEvidence: [evidence('static-cause', { source: 'source' })],
    })] },
    regressionBridge: {
      status: 'unavailable',
      reason: 'No safe executable reproducer exists yet.',
      residualRisk: 'The static cause is not execution-confirmed.',
    },
    ...overrides,
  });
}

describe('bug-hunt modification gate structural discipline', () => {
  it('rejects production source that merely labels itself a regression test', () => {
    const input = unavailableCase({
      proposedChange: {
        hypothesisId: 'H1',
        files: [{
          path: 'src/session/restore.js',
          role: 'regression_test',
          evidence: evidence('src/session/restore.js:20-28', { source: 'source' }),
        }],
        behaviorChange: 'Add a focused check for the reported mechanism.',
        contradictoryEvidenceAddressed: true,
      },
    });

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none', allowedFiles: [] });
    expect(reasons(result)).toContain('FILE_ROLE_PATH_MISMATCH');
  });

  it('rejects a production fix parked at a regression-test path', () => {
    const input = reproducedCase();
    input.proposedChange.files = [{
      path: 'tests/session/restore.test.js',
      role: 'production_fix',
      evidence: evidence('tests/session/restore.test.js:1-10', {
        source: 'source', affectedPaths: ['tests/session/restore.test.js'],
      }),
    }];

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(result)).toContain('FILE_ROLE_PATH_MISMATCH');
  });

  it('rejects a REPRODUCED reproduction backed only by a static source reference', () => {
    const input = reproducedCase();
    input.reproduction.evidence = [evidence('src/session/restore.js:20-28', {
      source: 'source', executionId: 'exec-1', outcome: 'failed',
    })];

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(result)).toContain('REPRODUCTION_EVIDENCE_SOURCE_NOT_FAILURE_BEARING');
  });

  it('rejects a non-failing regression-bridge record as sole causal support', () => {
    const blockedBridge = evidence('exec-bridge', {
      causal: true, regressionBridge: true, outcome: 'blocked',
    });
    const input = reproducedCase({
      ledger: { hypotheses: [supportedHypothesis({
        supportingEvidence: [blockedBridge],
        transitions: [{
          id: 'H1', from: 'ACTIVE', to: 'SUPPORTED', atPhase: 'pre_modification',
          reason: 'a blocked bridge run was treated as causal', evidence: [blockedBridge],
        }],
      })] },
    });

    const result = assessModificationGate(input);
    expect(result).toMatchObject({ status: 'blocked', scope: 'none' });
    expect(reasons(result)).toContain('CAUSAL_SUPPORT_REQUIRED');
  });

  it('consumes a real classifyReproduction result end to end', () => {
    const attempt = (executionId: string) => ({
      executionId,
      invocationFingerprint: 'invoke-a',
      repositorySha: 'repo-a',
      environmentFingerprint: 'env-a',
      result: 'failed',
      failureSignature: 'sig-a',
    });
    const bridge = {
      executionId: 'bridge-1',
      result: 'failed',
      failureSignature: 'sig-a',
      reportedMechanismObserved: true,
    };
    const classified = classifyReproduction({
      attempts: [attempt('exec-1'), attempt('exec-2')],
      regressionBridge: bridge,
    });
    expect(classified.status).toBe('REPRODUCED');

    const input = reproducedCase({
      reproduction: classified,
      regressionBridge: bridge,
      reproductionEvidence: [
        evidence('exec-1', { source: 'execution', executionId: 'exec-1', outcome: 'failed' }),
        evidence('exec-2', { source: 'execution', executionId: 'exec-2', outcome: 'failed' }),
        evidence('bridge-1', {
          source: 'execution', executionId: 'bridge-1', outcome: 'failed', regressionBridge: true,
        }),
      ],
    });

    expect(assessModificationGate(input)).toMatchObject({
      status: 'permitted', scope: 'production_fix', hypothesisId: 'H1', reasons: [],
    });
  });

  it('authorizes a root-level repository file', () => {
    const input = reproducedCase();
    input.proposedChange.files = [{
      path: 'vitest.config.ts',
      role: 'production_fix',
      evidence: evidence('vitest.config.ts:1-10', {
        source: 'source', affectedPaths: ['vitest.config.ts'],
      }),
    }];

    expect(assessModificationGate(input)).toMatchObject({
      status: 'permitted', scope: 'production_fix', allowedFiles: ['vitest.config.ts'],
    });
  });

  it('attaches evidence sources to every gate reason', () => {
    const input = reproducedCase();
    input.proposedChange.files[0].evidence = null;

    const result = assessModificationGate(input);
    for (const reason of result.reasons) expect(Array.isArray(reason.sources)).toBe(true);
    expect(result.reasons.find(({ code }) => code === 'FILE_EVIDENCE_REQUIRED'))
      .toMatchObject({ sources: ['src/session/restore.js'] });
  });

  it('names the hypothesis the caller must refine', () => {
    const input = reproducedCase();
    input.proposedChange.contradictoryEvidenceAddressed = false;

    expect(assessModificationGate(input)).toMatchObject({ status: 'refine', hypothesisId: 'H1' });
  });
});
