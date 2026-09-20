import { describe, expect, it } from 'vitest';
import { CONFIDENCE, measurement, unknownMeasurement } from '../../benchmarks/refactor-safely/harness/measurements.mjs';
import { newRunRecord } from '../../benchmarks/refactor-safely/harness/run-record.mjs';

describe('measurement invariants', () => {
  it('preserves zero as a known value', () => {
    expect(() => measurement({ value: 0, unit: 'calls', confidence: 'exact', sources: [] })).not.toThrow();
    expect(measurement({ value: 0, unit: 'calls', confidence: 'exact', sources: [] })).toEqual({ value: 0, unit: 'calls', confidence: 'exact', sources: [] });
  });
  it('rejects unknown confidence with a numeric value', () => {
    expect(() => measurement({ value: 0, unit: 'bytes', confidence: 'unknown', sources: [], unknownReason: 'not observable' })).toThrow('UNKNOWN_VALUE_MUST_BE_NULL');
  });
  it('rejects a known confidence with a null value', () => {
    for (const confidence of ['exact', 'reported', 'partial']) expect(() => measurement({ value: null, unit: 'bytes', confidence, sources: [] })).toThrow('KNOWN_VALUE_MUST_BE_NUMBER');
  });
  it('requires a reason for unknown and never converts it to zero', () => {
    expect(unknownMeasurement('bytes', 'subprocess reads are not observable', [])).toMatchObject({ value: null, confidence: 'unknown' });
    expect(unknownMeasurement('bytes', 'subprocess reads are not observable', []).unknownReason).toBe('subprocess reads are not observable');
    expect(() => measurement({ value: null, unit: 'bytes', confidence: 'unknown', sources: [] })).toThrow('UNKNOWN_REQUIRES_REASON');
  });
  it('bounds the confidence vocabulary', () => {
    expect(CONFIDENCE).toEqual(['exact', 'reported', 'partial', 'unknown']);
    expect(() => measurement({ value: 1, unit: 'bytes', confidence: 'high', sources: [] })).toThrow('INVALID_CONFIDENCE');
  });
  it('keeps sources as an independent copy', () => {
    const sources = [{ artifact: 'codex-events.jsonl', lines: [1, 2] }];
    const m = measurement({ value: 2, unit: 'events', confidence: 'exact', sources });
    sources.push({ artifact: 'x', lines: [] });
    expect(m.sources).toHaveLength(1);
  });
});

describe('run record', () => {
  it('carries every required section with unknown defaults', () => {
    const record = newRunRecord({ runId: 'task-a-control-1', taskId: 'task-a', condition: 'control', repetition: 1 });
    expect(record).toMatchObject({ runId: 'task-a-control-1', taskId: 'task-a', condition: 'control', repetition: 1 });
    for (const key of ['agent', 'baseline', 'context', 'tools', 'changes', 'harnessVerification', 'agentBehavior', 'patch', 'timing', 'notes', 'provenance']) expect(record).toHaveProperty(key);
    expect(Object.keys(record.context).sort()).toEqual(['agentVisible', 'deterministicScanning', 'evaluatorReads']);
    expect(record.agent).toEqual({ requestedModel: null, resolvedModel: null, configuration: null });
    expect(record.provenance).toEqual({ parserVersion: null, raw: [] });
  });
  it('rejects an invalid identity', () => {
    expect(() => newRunRecord({ runId: 'x', taskId: 'task-a', condition: 'treatment', repetition: 1 })).toThrow('INVALID_RUN_IDENTITY');
    expect(() => newRunRecord({ runId: 'x', taskId: 'task-a', condition: 'control', repetition: 1.5 })).toThrow('INVALID_RUN_IDENTITY');
  });
});
