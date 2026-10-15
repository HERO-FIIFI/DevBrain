import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPilotSummary, renderPilotMarkdown, writePilotReports } from '../../benchmarks/refactor-safely/harness/report.mjs';

let temp = '';
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = ''; });

const metric = (value: number | null, unit = 'bytes', confidence = value === null ? 'unknown' : 'exact') => ({ value, unit, confidence, sources: [], unknownReason: value === null ? 'not observable' : null });
const source = (gross: number, unique: number, duplicate: number) => ({ grossBytes: gross, uniqueBytes: unique, duplicateBytes: duplicate, grossLines: gross / 10, uniqueLines: unique / 10, duplicateLines: duplicate / 10, duplicationRatio: duplicate / gross, confidence: 'exact', unattributedEvents: 0 });
const record = (condition: 'control' | 'devbrain', values: { gross: number; unique: number; duplicate: number; metadata?: number; duration: number; calls: number; discipline: string; treatment?: string }) => ({
  value: {
    runId: `task-a-${condition}-1`, taskId: 'task-a', condition, repetition: 1,
    agent: { requestedModel: 'gpt-5.6-sol', resolvedModel: 'gpt-5.6-sol', modelGate: { status: 'ready' } },
    baseline: { repositorySha: 'a'.repeat(40), contentSha256: 'b'.repeat(64) },
    context: {
      agentVisible: {
        repository_source: source(values.gross, values.unique, values.duplicate),
        devbrain_metadata: { grossBytes: values.metadata ?? 0 }, verification_output: { grossBytes: 200 }, task_instruction: { grossBytes: 180 }, skill_instruction: { grossBytes: condition === 'devbrain' ? 800 : 0 }, other_tool_output: { grossBytes: 20 },
        totalMeasurableBytes: values.gross + (values.metadata ?? 0) + 1200,
      },
      deterministicScanning: { repositorySource: metric(5000), subprocessReads: metric(null) },
      evaluatorReads: { explicitReads: metric(900), subprocessReads: metric(null), files: ['src/auth/auth-service.js'] },
    },
    tools: { totalCalls: values.calls, reads: 2, searches: 1, devbrain: condition === 'devbrain' ? 5 : 0 },
    agentBehavior: { targetedTestsRun: true, fullRegressionRun: values.discipline === 'complete', lintRun: true, buildRun: true },
    patch: { status: 'SUCCESS', score: { passed: 10, total: 10 } }, discipline: { status: values.discipline },
    devbrain: { contextPacks: condition === 'devbrain' ? [{ candidateItems: 8, includedItems: 4, truncated: false }] : [] },
    treatment: { classification: values.treatment ?? 'unknown' }, timing: { durationMs: values.duration }, usage: { inputTokens: metric(null, 'tokens') }, notes: [],
  },
});

describe('pilot report', () => {
  it('keeps context, correctness, discipline, scanning, evaluator reads, and latency separate', () => {
    const summary = buildPilotSummary(record('control', { gross: 8000, unique: 6000, duplicate: 2000, duration: 1000, calls: 8, discipline: 'incomplete' }), record('devbrain', { gross: 4000, unique: 3200, duplicate: 800, metadata: 1400, duration: 1600, calls: 13, discipline: 'complete', treatment: 'mixed' }));
    expect(summary).toMatchObject({
      runs: { control: { patch: { status: 'SUCCESS' }, discipline: { status: 'incomplete' } }, devbrain: { patch: { status: 'SUCCESS' }, discipline: { status: 'complete' } } },
      comparison: { repositorySource: { grossBytesDifference: -4000, uniqueBytesDifference: -2800 }, totalMeasurablePayload: { bytesDifference: expect.any(Number) }, duration: { millisecondsDifference: 600 }, substitution: 'mixed' },
      statistics: { repetitionsPerCondition: 1, inference: 'not_applicable' },
    });
    expect(summary.comparison).not.toHaveProperty('devbrainScore');
    expect(summary.runs.devbrain.context.deterministicScanning.subprocessReads.value).toBeNull();
    expect(summary.recommendation).toBe('PROCEED');
  });

  it('reports one-run mean, median, and range without significance claims', () => {
    const summary = buildPilotSummary(record('control', { gross: 8000, unique: 6000, duplicate: 2000, duration: 1000, calls: 8, discipline: 'complete' }), record('devbrain', { gross: 4000, unique: 3200, duplicate: 800, duration: 1600, calls: 13, discipline: 'complete' }));
    expect(summary.statistics.durationMs.control).toEqual({ individual: [1000], mean: 1000, median: 1000, range: [1000, 1000] });
    expect(renderPilotMarkdown(summary)).toContain('No statistical inference is possible from one repetition per condition.');
  });

  it('writes machine-readable and Markdown reports without overwriting evidence', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-report-'));
    const summary = buildPilotSummary(record('control', { gross: 8000, unique: 6000, duplicate: 2000, duration: 1000, calls: 8, discipline: 'complete' }), record('devbrain', { gross: 4000, unique: 3200, duplicate: 800, duration: 1600, calls: 13, discipline: 'complete' }));
    await writePilotReports(temp, summary);
    expect(JSON.parse(await readFile(path.join(temp, 'benchmark-summary.json'), 'utf8'))).toMatchObject({ recommendation: 'PROCEED' });
    expect(await readFile(path.join(temp, 'benchmark-summary.md'), 'utf8')).toContain('DEVBrain /refactor-safely — Pilot Benchmark');
    await expect(writePilotReports(temp, summary)).rejects.toThrow('REPORT_ALREADY_EXISTS');
  });
});
