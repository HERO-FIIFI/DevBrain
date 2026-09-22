import { describe, expect, it } from 'vitest';

import {
  CONTEXT_EXPANSION_REASONS,
  assessBugContext,
  checkContextBudget,
  gradeContextExpansion,
  summarizeReads,
} from '../../benchmarks/bug-hunt/harness/context-governance.mjs';

const completeContext = {
  diagnosticFrames: [{ file: 'src/session/restore.mjs', line: 42, relevant: true }],
  suspect: { name: 'restoreSession', file: 'src/session/restore.mjs', definitionResolved: true },
  nearestObservable: { type: 'test', file: 'tests/session/restore.test.mjs', line: 18 },
  ambiguity: { corroborated: true, evidenceIds: ['slice-1'] },
  impact: { truncated: false, budgetExcluded: [] },
  prediction: {
    preconditions: ['the session record is expired'],
    outcome: 'the restore path returns an expired-session result',
  },
  contradictions: [{ eventId: 'test-previous-pass', detail: 'the same path passed for a valid record' }],
  unknowns: [{ note: 'production cookie shape is unavailable', requiresRepositoryWideRead: false }],
};

describe('bug-hunt context governance', () => {
  it('recognizes complete evidence and exposes each unmet context criterion', () => {
    expect(assessBugContext(completeContext)).toEqual({ sufficient: true, unmet: [] });

    const cases = [
      [{ ...completeContext, diagnosticFrames: [] }, 'relevant_diagnostic_frames'],
      [{ ...completeContext, suspect: { name: 'restoreSession', definitionResolved: false } }, 'suspect_definition'],
      [{ ...completeContext, nearestObservable: null }, 'nearest_observable_caller_or_test'],
      [{ ...completeContext, ambiguity: { corroborated: false } }, 'ambiguity_or_low_confidence_corroboration'],
      [{ ...completeContext, impact: { truncated: true } }, 'truncated_references'],
      [{ ...completeContext, impact: { truncated: false, budgetExcluded: ['src/session/restore.mjs'] } }, 'silent_budget_exclusion'],
      [{ ...completeContext, prediction: { preconditions: [], outcome: '' } }, 'falsifiable_prediction'],
      [{ ...completeContext, contradictions: [] }, 'contradictory_evidence'],
      [{ ...completeContext, unknowns: [] }, 'remaining_unknowns'],
      [{ ...completeContext, unknowns: [{ note: 'read everything', requiresRepositoryWideRead: true }] }, 'repository_wide_unknown'],
    ] as const;

    for (const [evidence, reason] of cases) {
      expect(assessBugContext(evidence).unmet).toContainEqual(expect.objectContaining({ reason }));
    }
  });

  it('uses the approved expansion vocabulary and accepts an evidenced bounded ambiguity read', () => {
    expect(CONTEXT_EXPANSION_REASONS).toEqual([
      'ambiguous_symbol',
      'truncated_references',
      'low_confidence_resolution',
      'new_stack_frame',
      'failed_hypothesis',
      'unexpected_dependency',
      'new_test_failure',
    ]);

    expect(gradeContextExpansion(
      { ...completeContext, ambiguity: { corroborated: false, eventId: 'symbol-ambiguous' } },
      {
        reason: 'ambiguous_symbol',
        trigger: 'symbol-ambiguous',
        hypothesis: 'H1',
        action: { tool: 'devbrain_read_symbol', file: 'src/session/restore.mjs', symbol: 'restoreSession' },
        read: {
          file: 'src/session/restore.mjs',
          startLine: 35,
          endLine: 60,
          bytes: 811,
          source: 'devbrain_slice',
          trigger: 'symbol-ambiguous',
          eventId: 'read-1',
        },
      },
    )).toMatchObject({ permitted: true, violations: [] });
  });

  it('routes every approved trigger to a bounded existing-tool expansion', () => {
    const cases = [
      ['ambiguous_symbol', { ambiguity: { corroborated: false, eventId: 'ambiguity-1' } }, 'ambiguity-1', 'devbrain_read_symbol'],
      ['truncated_references', { impact: { truncated: true, eventId: 'truncation-1' } }, 'truncation-1', 'devbrain_find_references'],
      ['low_confidence_resolution', { ambiguity: { corroborated: false, eventId: 'confidence-1', confidence: 'low' } }, 'confidence-1', 'devbrain_read_file_slice'],
      ['new_stack_frame', { newStackFrames: [{ eventId: 'frame-1', file: 'src/worker.mjs', line: 11 }] }, 'frame-1', 'devbrain_read_file_slice'],
      ['failed_hypothesis', { failedHypotheses: [{ eventId: 'hypothesis-1', id: 'H1' }] }, 'hypothesis-1', 'devbrain_read_file_slice'],
      ['unexpected_dependency', { unexpectedDependencies: [{ eventId: 'dependency-1', file: 'src/db.mjs' }] }, 'dependency-1', 'devbrain_change_impact'],
      ['new_test_failure', { newTestFailures: [{ eventId: 'test-1', file: 'tests/session/restore.test.mjs', line: 18 }] }, 'test-1', 'devbrain_read_file_slice'],
    ] as const;

    for (const [reason, patch, trigger, tool] of cases) {
      expect(gradeContextExpansion(
        { ...completeContext, ...patch },
        {
          reason,
          trigger,
          hypothesis: 'H1',
          action: { tool, file: 'src/session/restore.mjs', symbol: tool === 'devbrain_read_symbol' ? 'restoreSession' : undefined },
          read: {
            file: 'src/session/restore.mjs',
            startLine: 20,
            endLine: 40,
            bytes: 510,
            source: 'devbrain_slice',
            trigger,
            eventId: `read-${reason}`,
          },
        },
      )).toMatchObject({ permitted: true, violations: [] });
    }
  });

  it('accounts for overlapping reads without estimating missing bytes', () => {
    const packLines20To80 = {
      file: 'src/session/restore.mjs', startLine: 20, endLine: 80, bytes: null,
      source: 'context_pack' as const, trigger: 'pack-1', eventId: 'pack-read-1',
    };
    const manualLines1To150 = {
      file: './src/session/restore.mjs', startLine: 1, endLine: 150, bytes: 1200,
      source: 'devbrain_slice' as const, trigger: 'frame-1', eventId: 'manual-read-1',
    };
    const exactDuplicate = { ...manualLines1To150, eventId: 'manual-read-2' };

    expect(summarizeReads([packLines20To80, manualLines1To150])).toMatchObject({
      grossLines: 211,
      uniqueLines: 150,
      duplicateLines: 61,
      bytes: { total: null, reason: 'MISSING_BYTE_COUNTS' },
    });
    expect(summarizeReads([manualLines1To150, exactDuplicate]).duplicateIntervals)
      .toContainEqual(expect.objectContaining({ file: 'src/session/restore.mjs', startLine: 1, endLine: 150 }));
  });

  it('rejects broad, duplicate, edit-targeted, and sixth expansions', () => {
    const packLines20To80 = {
      file: 'src/session/restore.mjs', startLine: 20, endLine: 80, bytes: 610,
      source: 'context_pack' as const, trigger: 'pack-1', eventId: 'pack-read-1',
    };
    const sufficientWithRead = { ...completeContext, reads: [packLines20To80] };
    const rereadLines20To80 = {
      reason: 'ambiguous_symbol', trigger: 'pack-1', hypothesis: 'H1',
      action: { tool: 'devbrain_read_symbol', file: 'src/session/restore.mjs', symbol: 'restoreSession' },
      read: { ...packLines20To80, source: 'devbrain_slice' as const, eventId: 'manual-read-1' },
    };
    const repositoryWideRead = {
      reason: 'new_stack_frame', trigger: 'frame-1', hypothesis: 'H1',
      action: { tool: 'devbrain_read_file_slice', file: 'src', scope: 'directory' },
      read: { ...packLines20To80, eventId: 'broad-read-1' },
    };
    const lowConfidenceEdit = {
      reason: 'low_confidence_resolution', trigger: 'confidence-1', hypothesis: 'H1', target: { type: 'edit', file: 'src/session/restore.mjs' },
      action: { tool: 'devbrain_read_file_slice', file: 'src/session/restore.mjs' },
      read: { ...packLines20To80, eventId: 'edit-read-1', trigger: 'confidence-1' },
    };

    expect(gradeContextExpansion({ ...completeContext, newStackFrames: [{ eventId: 'frame-1' }] }, repositoryWideRead).violations)
      .toContainEqual(expect.objectContaining({ code: 'UNJUSTIFIED_BROAD_READ' }));
    expect(gradeContextExpansion(sufficientWithRead, rereadLines20To80).violations)
      .toContainEqual(expect.objectContaining({ code: 'SUFFICIENT_EVIDENCE_REREAD' }));
    expect(gradeContextExpansion(
      { ...completeContext, ambiguity: { corroborated: false, confidence: 'low', eventId: 'confidence-1' } },
      lowConfidenceEdit,
    ).violations).toContainEqual(expect.objectContaining({ code: 'LOW_CONFIDENCE_NOT_EDIT_TARGET' }));

    expect(checkContextBudget({
      reads: [packLines20To80],
      expansions: Array.from({ length: 6 }, (_, index) => ({ eventId: `expansion-${index + 1}` })),
    })).toMatchObject({
      status: 'exhausted',
      expansionsUsed: 6,
      expansionsMaximum: 5,
      duplicateIntervals: [],
      violations: [expect.objectContaining({ code: 'CONTEXT_EXPANSION_BUDGET_EXHAUSTED' })],
    });
  });
});
