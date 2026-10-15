import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyToolEvent, normalizeEvent, parseJsonl, parseReadCommand, unwrapShell } from '../../benchmarks/refactor-safely/harness/events.mjs';

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name), 'utf8');

describe('event normalization', () => {
  it('retains unknown future events instead of dropping them', () => {
    expect(normalizeEvent({ type: 'future.event', payload: 1 }, 9)).toMatchObject({ kind: 'unknown', lineNumber: 9, rawType: 'future.event', eventId: 'L9' });
    expect(normalizeEvent({ noType: true }, 3)).toMatchObject({ kind: 'unknown', rawType: null, lineNumber: 3 });
    expect(normalizeEvent('not an object', 4)).toMatchObject({ kind: 'unknown', rawType: null });
  });
  it('normalizes thread, turn, item, usage, and error events', () => {
    expect(normalizeEvent({ type: 'thread.started', thread_id: 't1' }, 1)).toMatchObject({ kind: 'thread', phase: 'started', threadId: 't1' });
    expect(normalizeEvent({ type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 1, output_tokens: 2 } }, 2)).toMatchObject({ kind: 'turn', phase: 'completed', usage: { inputTokens: 5, cachedInputTokens: 1, outputTokens: 2 } });
    expect(normalizeEvent({ type: 'turn.failed', error: { message: 'boom' } }, 3)).toMatchObject({ kind: 'turn', phase: 'failed', error: 'boom' });
    expect(normalizeEvent({ type: 'error', message: 'fatal' }, 4)).toMatchObject({ kind: 'error', error: 'fatal' });
    const shell = normalizeEvent({ type: 'item.completed', item: { id: 'i', type: 'command_execution', command: 'bash -lc "cat a.js"', aggregated_output: 'x\n', exit_code: 0, status: 'completed' } }, 5);
    expect(shell).toMatchObject({ kind: 'item', phase: 'completed', item: { id: 'i', type: 'command_execution', command: 'bash -lc "cat a.js"', output: 'x\n', exitCode: 0, status: 'completed' } });
    const mcp = normalizeEvent({ type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call', server: 'devbrain', tool: 'devbrain_read_symbol', arguments: { symbol: 'x' }, result: { content: [{ type: 'text', text: '{"status":"complete"}' }] }, status: 'completed' } }, 6);
    expect(mcp.item).toMatchObject({ type: 'mcp_tool_call', server: 'devbrain', tool: 'devbrain_read_symbol', arguments: { symbol: 'x' }, resultText: '{"status":"complete"}', structured: { status: 'complete' } });
    expect(normalizeEvent({ type: 'item.completed', item: { id: 'w', type: 'wormhole', weird: true } }, 7)).toMatchObject({ kind: 'item', item: { type: 'wormhole' }, tool: { category: 'unclassified' } });
  });
  it('parses JSONL tolerantly and records malformed lines', () => {
    const parsed = parseJsonl('{"type":"turn.started"}\nnot json\n\n{"type":"future.event"}\n');
    expect(parsed.events.map((event: any) => [event.lineNumber, event.kind])).toEqual([[1, 'turn'], [4, 'unknown']]);
    expect(parsed.malformed).toEqual([{ lineNumber: 2, error: expect.stringContaining('JSON') }]);
    expect(parsed.totalLines).toBe(4);
  });
  it('parses both synthetic fixtures without losing events', async () => {
    const control = parseJsonl(await fixture('control-events.jsonl'));
    expect(control.events).toHaveLength(15);
    expect(control.malformed).toEqual([]);
    expect(control.events.filter((event: any) => event.kind === 'unknown')).toHaveLength(1);
    const devbrain = parseJsonl(await fixture('devbrain-events.jsonl'));
    expect(devbrain.events).toHaveLength(13);
    expect(devbrain.events.filter((event: any) => event.tool?.category === 'devbrain')).toHaveLength(5);
  });
});

describe('tool classification', () => {
  const shell = (command: string, output = '', exitCode = 0) => normalizeEvent({ type: 'item.completed', item: { id: 'x', type: 'command_execution', command, aggregated_output: output, exit_code: exitCode, status: 'completed' } }, 1);
  it('unwraps shell wrappers and array commands', () => {
    expect(unwrapShell('bash -lc "cat a.js"')).toBe('cat a.js');
    expect(unwrapShell(['bash', '-lc', 'grep -rn x src'])).toBe('grep -rn x src');
    expect(unwrapShell('powershell -Command "Get-Content a.js"')).toBe('Get-Content a.js');
    expect(unwrapShell("sh -c 'ls'")).toBe('ls');
    expect(unwrapShell('cat a.js')).toBe('cat a.js');
  });
  it('classifies reads, searches, listings, git, tests, lint, build, and edits', () => {
    expect(classifyToolEvent(shell('bash -lc "cat src/a.js"'))).toMatchObject({ category: 'read', command: 'cat src/a.js' });
    expect(classifyToolEvent(shell('bash -lc "sed -n \'10,20p\' src/a.js"'))).toMatchObject({ category: 'read' });
    expect(classifyToolEvent(shell('bash -lc "grep -rn validateToken src"'))).toMatchObject({ category: 'search' });
    expect(classifyToolEvent(shell('bash -lc "rg validateToken"'))).toMatchObject({ category: 'search' });
    expect(classifyToolEvent(shell('bash -lc "ls -R src"'))).toMatchObject({ category: 'list' });
    expect(classifyToolEvent(shell('bash -lc "git status --short"'))).toMatchObject({ category: 'git' });
    expect(classifyToolEvent(shell('bash -lc "node --test tests/visible/auth-service.test.js"'))).toMatchObject({ category: 'test', scope: 'targeted' });
    expect(classifyToolEvent(shell('bash -lc "node --test"'))).toMatchObject({ category: 'test', scope: 'full' });
    expect(classifyToolEvent(shell('bash -lc "npm test"'))).toMatchObject({ category: 'test', scope: 'full' });
    expect(classifyToolEvent(shell('bash -lc "npm run test:targeted"'))).toMatchObject({ category: 'test', scope: 'targeted' });
    expect(classifyToolEvent(shell('bash -lc "npm run lint"'))).toMatchObject({ category: 'lint' });
    expect(classifyToolEvent(shell('bash -lc "node scripts/build.mjs"'))).toMatchObject({ category: 'build' });
    expect(classifyToolEvent(shell('bash -lc "sed -i s/a/b/ src/a.js"'))).toMatchObject({ category: 'edit' });
    expect(classifyToolEvent(normalizeEvent({ type: 'item.completed', item: { id: 'f', type: 'file_change', changes: [{ path: 'a.js', kind: 'update' }], status: 'completed' } }, 2))).toMatchObject({ category: 'edit', files: ['a.js'] });
  });
  it('does not invent a classification for an unrecognized command', () => {
    expect(classifyToolEvent(shell('bash -lc "frobnicate --all"'))).toMatchObject({ category: 'unclassified', command: 'frobnicate --all' });
  });
  it('classifies DevBrain and foreign MCP calls', () => {
    const call = (server: string, tool: string) => normalizeEvent({ type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call', server, tool, arguments: {}, result: null, status: 'completed' } }, 3);
    expect(classifyToolEvent(call('devbrain', 'devbrain_context_pack'))).toMatchObject({ category: 'devbrain', subcategory: 'retrieval', tool: 'devbrain_context_pack' });
    expect(classifyToolEvent(call('devbrain', 'devbrain_change_impact'))).toMatchObject({ category: 'devbrain', subcategory: 'impact' });
    expect(classifyToolEvent(call('devbrain', 'devbrain_run_targeted_tests'))).toMatchObject({ category: 'devbrain', subcategory: 'execution', scope: 'targeted' });
    expect(classifyToolEvent(call('devbrain', 'devbrain_run_tests'))).toMatchObject({ category: 'devbrain', subcategory: 'execution', scope: 'full' });
    expect(classifyToolEvent(call('devbrain', 'devbrain_future_tool'))).toMatchObject({ category: 'devbrain', subcategory: 'unclassified' });
    expect(classifyToolEvent(call('github', 'search_issues'))).toMatchObject({ category: 'mcp_other', server: 'github' });
  });
  it('derives file and line ranges only from recognized read shapes', () => {
    expect(parseReadCommand('cat src/a.js')).toEqual({ file: 'src/a.js', startLine: 1, endLine: null, whole: true, numbered: false });
    expect(parseReadCommand('cat -n src/a.js')).toEqual({ file: 'src/a.js', startLine: 1, endLine: null, whole: true, numbered: true });
    expect(parseReadCommand("sed -n '20,80p' src/a.js")).toEqual({ file: 'src/a.js', startLine: 20, endLine: 80, whole: false, numbered: false });
    expect(parseReadCommand('sed -n 20,80p src/a.js')).toEqual({ file: 'src/a.js', startLine: 20, endLine: 80, whole: false, numbered: false });
    expect(parseReadCommand('head -n 50 src/a.js')).toEqual({ file: 'src/a.js', startLine: 1, endLine: 50, whole: false, numbered: false });
    expect(parseReadCommand('head -50 src/a.js')).toEqual({ file: 'src/a.js', startLine: 1, endLine: 50, whole: false, numbered: false });
    expect(parseReadCommand('Get-Content src/a.js')).toEqual({ file: 'src/a.js', startLine: 1, endLine: null, whole: true, numbered: false });
    expect(parseReadCommand('tail -n 20 src/a.js')).toEqual({ file: 'src/a.js', startLine: null, endLine: null, whole: false, numbered: false });
    expect(parseReadCommand('cat src/a.js src/b.js')).toBeNull();
    expect(parseReadCommand('cat src/a.js | head -20')).toBeNull();
    expect(parseReadCommand('frobnicate src/a.js')).toBeNull();
  });
});
