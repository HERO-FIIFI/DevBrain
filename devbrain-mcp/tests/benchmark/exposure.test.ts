import { describe, expect, it } from 'vitest';
import { CATEGORIES, DOMAINS, ExposureLedger, lineBytes } from '../../benchmarks/refactor-safely/harness/exposure.mjs';

// 150 synthetic lines: "line N" is 6/7/8 characters for N<10, N<100, N<=150; each line counts its bytes plus one newline.
const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`);
const range = (start: number, end: number) => lines.slice(start - 1, end).join('\n');
const bytesFor = (start: number, end: number) => lines.slice(start - 1, end).reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0);

describe('exposure ledger overlap accounting', () => {
  it('counts overlapping Context Pack and manual slices once in unique exposure', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'src/auth/auth-service.js', startLine: 20, endLine: 80, text: range(20, 80), metadataBytes: 0, eventId: 'L3', confidence: 'exact', origin: 'devbrain' });
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'src/auth/auth-service.js', startLine: 1, endLine: 150, text: range(1, 150), metadataBytes: 0, eventId: 'L5', confidence: 'exact', origin: 'shell' });
    const summary = ledger.summary();
    expect(bytesFor(20, 80)).toBe(488);
    expect(bytesFor(1, 150)).toBe(1242);
    expect(summary.agent_visible.repository_source).toMatchObject({ events: 2, grossLines: 211, uniqueLines: 150, duplicateLines: 61, grossBytes: 1730, uniqueBytes: 1242, duplicateBytes: 488, confidence: 'exact' });
    expect(summary.agent_visible.repository_source.duplicationRatio).toBeCloseTo(488 / 1730, 6);
  });
  it('routes selection-reason bytes to devbrain_metadata, not repository source', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 2, text: 'x\ny', metadataBytes: 0, eventId: 'L1', confidence: 'exact', origin: 'devbrain' });
    ledger.add({ domain: 'agent_visible', category: 'devbrain_metadata', metadataBytes: 340, eventId: 'L1', confidence: 'exact', origin: 'devbrain' });
    const summary = ledger.summary();
    expect(summary.agent_visible.repository_source).toMatchObject({ grossBytes: 4, uniqueBytes: 4, grossLines: 2 });
    expect(summary.agent_visible.devbrain_metadata).toMatchObject({ grossBytes: 340, events: 1 });
  });
  it('treats a reread of changed line content as new exposure', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 1, text: 'old', eventId: 'L1', confidence: 'exact', origin: 'shell' });
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 1, text: 'new!', eventId: 'L2', confidence: 'exact', origin: 'shell' });
    expect(ledger.summary().agent_visible.repository_source).toMatchObject({ grossLines: 2, uniqueLines: 2, duplicateLines: 0, grossBytes: 9, uniqueBytes: 9 });
  });
  it('keeps unattributable source bytes exact in gross while unique becomes partial', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 3, text: 'a\nb\nc', eventId: 'L1', confidence: 'exact', origin: 'shell' });
    ledger.add({ domain: 'agent_visible', category: 'repository_source', sourceBytes: 100, eventId: 'L2', confidence: 'partial', origin: 'shell', reason: 'pipeline output has no file range' });
    const summary = ledger.summary().agent_visible.repository_source;
    expect(summary).toMatchObject({ grossBytes: 106, grossLines: null, uniqueBytes: 6, uniqueLines: 3, unattributedBytes: 100, unattributedEvents: 1, confidence: 'partial' });
    expect(summary.duplicateBytes).toBeNull();
  });
  it('rejects a text slice whose line count does not match its range', () => {
    const ledger = new ExposureLedger();
    expect(() => ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 5, text: 'a\nb', eventId: 'L1', confidence: 'exact', origin: 'shell' })).toThrow('RANGE_TEXT_MISMATCH');
  });
});

describe('exposure domain separation and unknowns', () => {
  it('bounds the vocabulary', () => {
    expect(DOMAINS).toEqual(['agent_visible', 'deterministic_scanning', 'evaluator_reads']);
    expect(CATEGORIES).toEqual(['repository_source', 'devbrain_metadata', 'verification_output', 'task_instruction', 'skill_instruction', 'other_tool_output']);
    const ledger = new ExposureLedger();
    expect(() => ledger.add({ domain: 'agent_visible', category: 'telemetry', metadataBytes: 1, eventId: 'L1', confidence: 'exact' })).toThrow('INVALID_CATEGORY');
    expect(() => ledger.add({ domain: 'wherever', category: 'other_tool_output', metadataBytes: 1, eventId: 'L1', confidence: 'exact' })).toThrow('INVALID_DOMAIN');
  });
  it('sums total measurable payload from agent-visible categories only', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'agent_visible', category: 'repository_source', file: 'a.js', startLine: 1, endLine: 1, text: 'abc', eventId: 'L1', confidence: 'exact', origin: 'shell' });
    ledger.add({ domain: 'agent_visible', category: 'verification_output', metadataBytes: 50, eventId: 'L2', confidence: 'exact' });
    ledger.add({ domain: 'agent_visible', category: 'task_instruction', metadataBytes: 200, eventId: 'prompt', confidence: 'exact' });
    ledger.add({ domain: 'deterministic_scanning', category: 'repository_source', sourceBytes: 9000, eventId: 'scan', confidence: 'exact', origin: 'harness' });
    ledger.add({ domain: 'evaluator_reads', category: 'repository_source', sourceBytes: 7000, eventId: 'eval', confidence: 'exact', origin: 'evaluator' });
    const summary = ledger.summary();
    expect(summary.agent_visible.totalMeasurablePayload).toMatchObject({ value: 254, confidence: 'exact' });
    expect(summary.deterministic_scanning.repository_source.grossBytes).toBe(9000);
    expect(summary.evaluator_reads.repository_source.grossBytes).toBe(7000);
    expect(summary.deterministic_scanning.totalMeasurablePayload).toBeUndefined();
  });
  it('keeps an unknown subprocess scan as null with a reason', () => {
    const ledger = new ExposureLedger();
    ledger.add({ domain: 'deterministic_scanning', category: 'repository_source', confidence: 'unknown', unknownReason: 'git subprocess reads are not observable', eventId: 'scan-git' });
    ledger.add({ domain: 'agent_visible', category: 'other_tool_output', confidence: 'unknown', unknownReason: 'event lacks output payload', eventId: 'L9' });
    ledger.add({ domain: 'agent_visible', category: 'other_tool_output', metadataBytes: 10, eventId: 'L10', confidence: 'exact' });
    const summary = ledger.summary();
    expect(summary.deterministic_scanning.repository_source).toMatchObject({ grossBytes: null, confidence: 'unknown', unknownReasons: ['git subprocess reads are not observable'] });
    expect(summary.agent_visible.other_tool_output).toMatchObject({ grossBytes: 10, confidence: 'partial', unknownReasons: ['event lacks output payload'] });
    expect(summary.agent_visible.totalMeasurablePayload).toMatchObject({ value: 10, confidence: 'partial' });
  });
  it('counts line bytes as UTF-8 bytes plus one newline', () => {
    expect(lineBytes('abc')).toBe(4);
    expect(lineBytes('é')).toBe(3);
  });
});
