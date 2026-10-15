import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARSER_VERSION, deriveRunMetrics } from '../../benchmarks/refactor-safely/harness/derive.mjs';
import { parseJsonl } from '../../benchmarks/refactor-safely/harness/events.mjs';

const fixture = async (name: string) => { const text = await readFile(path.join(__dirname, 'fixtures', name), 'utf8'); return { text, raw: text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) }; };
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const outputOf = (raw: any[], id: string) => raw.find((event) => event.item?.id === id).item.aggregated_output as string;
const resultOf = (raw: any[], id: string) => raw.find((event) => event.item?.id === id).item.result.content[0].text as string;
const context = (condition: string) => ({ condition, repositoryRoot: 'C:/tmp/run/repo', skillRoot: '/home/agent/skills/refactor-safely', prompt: 'Rename validateToken to verifyToken.', skillFiles: condition === 'devbrain' ? [{ path: 'SKILL.md', bytes: 1500 }] : [], raw: [{ name: 'codex-events.jsonl', sha256: 'a'.repeat(64) }] });

describe('derived metrics for the CONTROL fixture', () => {
  it('counts tools, discipline, exposure, and usage with provenance', async () => {
    const { text, raw } = await fixture('control-events.jsonl');
    const metrics = deriveRunMetrics(parseJsonl(text), context('control'), PARSER_VERSION);
    expect(metrics.provenance).toEqual({ parserVersion: PARSER_VERSION, raw: [{ name: 'codex-events.jsonl', sha256: 'a'.repeat(64) }], eventCount: 15, unknownEvents: 1, malformedLines: 0 });
    expect(metrics.tools).toMatchObject({ totalCalls: 10, processCalls: 9, reads: 2, searches: 2, lists: 1, git: 0, edits: 1, tests: 2, lint: 1, build: 0, devbrain: 0, unclassified: 1, repeatedSearches: 1, repeatedReads: 0 });
    expect(metrics.tools.unclassifiedCommands).toEqual(['frobnicate --all']);
    expect(metrics.agentBehavior).toMatchObject({ targetedTestsRun: true, fullRegressionRun: false, lintRun: true, buildRun: false, verificationFailures: 1, contextExpansions: null, agentMessages: 1 });
    const source = metrics.context.agentVisible.repository_source;
    // cat (6 lines, 134 bytes) + sed 1-4 (4 duplicate lines, 128 bytes) + two grep outputs without line attribution.
    const grep = bytes(outputOf(raw, 'item_1'));
    expect(source).toMatchObject({ grossLines: null, uniqueLines: 6, duplicateLines: 4, attributedGrossLines: 10, grossBytes: 134 + 128 + grep * 2, uniqueBytes: 134, unattributedBytes: grep * 2, unattributedEvents: 2, confidence: 'partial' });
    expect(metrics.context.agentVisible.verification_output.grossBytes).toBe(bytes(outputOf(raw, 'item_6')) + bytes(outputOf(raw, 'item_7')) + bytes(outputOf(raw, 'item_8')));
    expect(metrics.context.agentVisible.other_tool_output.grossBytes).toBe(bytes(outputOf(raw, 'item_0')) + bytes(outputOf(raw, 'item_9')));
    expect(metrics.context.agentVisible.task_instruction.grossBytes).toBe(bytes('Rename validateToken to verifyToken.'));
    expect(metrics.context.agentVisible.skill_instruction.grossBytes).toBe(0);
    expect(metrics.context.agentVisible.devbrain_metadata.grossBytes).toBe(0);
    expect(metrics.context.agentVisible.totalMeasurablePayload.confidence).toBe('partial');
    expect(metrics.context.deterministicScanning).toEqual({ note: 'harness scans are recorded by the runner, not derived from agent events' });
    expect(metrics.context.evaluatorReads).toEqual({ note: 'evaluator reads are recorded by the evaluator, not derived from agent events' });
    expect(metrics.usage).toMatchObject({ inputTokens: { value: 1200, confidence: 'reported' }, cachedInputTokens: { value: 0, confidence: 'reported' }, outputTokens: { value: 300, confidence: 'reported' } });
    expect(metrics.treatment).toEqual({ classification: 'unknown', reason: 'no DevBrain retrieval events in this run', postPackShellSourceLines: null, postPackShellDuplicateLines: null });
    expect(metrics.devbrain).toEqual({ calls: 0, contextPacks: [], retrievalCalls: 0, impactCalls: 0, executionCalls: 0 });
    expect(metrics.treatmentLeak).toEqual({ detected: false, events: [] });
  });
});

describe('derived metrics for the DEVBrain fixture', () => {
  it('attributes Context Pack slices exactly and detects additive rereads', async () => {
    const { text, raw } = await fixture('devbrain-events.jsonl');
    const metrics = deriveRunMetrics(parseJsonl(text), context('devbrain'), PARSER_VERSION);
    expect(metrics.tools).toMatchObject({ totalCalls: 9, processCalls: 3, reads: 2, searches: 0, edits: 1, tests: 1, devbrain: 5, unclassified: 0 });
    expect(metrics.devbrain).toMatchObject({ calls: 5, retrievalCalls: 3, impactCalls: 1, executionCalls: 1 });
    expect(metrics.devbrain.contextPacks).toEqual([{ eventId: 'L3', status: 'complete', candidateItems: 3, includedItems: 2, budgetExcludedItems: 0, truncated: false, confidence: 'medium', usage: { files: 2, lines: 9, bytes: 0 } }]);
    expect(metrics.agentBehavior).toMatchObject({ targetedTestsRun: true, fullRegressionRun: true, lintRun: false, buildRun: false, verificationFailures: 0, contextExpansions: 3 });
    const source = metrics.context.agentVisible.repository_source;
    // pack: service 1-6 + middleware 7-9; search preview: 1 line; cat service: 6 duplicate lines; slice: restorer 1-5.
    expect(source).toMatchObject({ grossLines: 21, uniqueLines: 15, duplicateLines: 6, unattributedBytes: 0, confidence: 'exact' });
    const pack = JSON.parse(resultOf(raw, 'item_0'));
    const packContentBytes = pack.items.reduce((sum: number, item: any) => sum + bytes(item.content) + 1, 0);
    expect(metrics.context.agentVisible.devbrain_metadata.grossBytes).toBe(bytes(resultOf(raw, 'item_0')) - packContentBytes + bytes(resultOf(raw, 'item_1')) + bytes(resultOf(raw, 'item_2')) - (bytes(JSON.parse(resultOf(raw, 'item_2')).matches[0].preview) + 1) + bytes(resultOf(raw, 'item_4')) - (bytes(JSON.parse(resultOf(raw, 'item_4')).content) + 1));
    expect(metrics.context.agentVisible.skill_instruction.grossBytes).toBe(1500 + bytes(outputOf(raw, 'item_5')));
    expect(metrics.context.agentVisible.verification_output.grossBytes).toBe(bytes(resultOf(raw, 'item_7')) + bytes(outputOf(raw, 'item_8')));
    expect(metrics.treatment).toEqual({ classification: 'additive', reason: 'every repository line read through shell commands after the first Context Pack had already been provided by DevBrain', postPackShellSourceLines: 6, postPackShellDuplicateLines: 6 });
    expect(metrics.usage.cachedInputTokens).toMatchObject({ value: 800, confidence: 'reported' });
  });
  it('flags DevBrain events inside a CONTROL run as a treatment leak', async () => {
    const { text } = await fixture('devbrain-events.jsonl');
    const metrics = deriveRunMetrics(parseJsonl(text), context('control'), PARSER_VERSION);
    // Five DevBrain MCP calls plus one shell read of a skill-path file.
    expect(metrics.treatmentLeak).toMatchObject({ detected: true, events: ['L3', 'L4', 'L5', 'L7', 'L8', 'L10'] });
  });
  it('keeps token usage unknown when no turn.completed usage exists', () => {
    const metrics = deriveRunMetrics(parseJsonl('{"type":"thread.started","thread_id":"t"}\n{"type":"turn.started"}\n'), context('control'), PARSER_VERSION);
    expect(metrics.usage.inputTokens).toMatchObject({ value: null, confidence: 'unknown', unknownReason: 'no turn.completed usage event' });
    expect(metrics.agentBehavior.verificationFailures).toBe(0);
  });
});
