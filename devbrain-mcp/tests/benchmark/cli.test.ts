import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, parseArguments } from '../../benchmarks/refactor-safely/cli.mjs';

let temp = '';
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = ''; });

describe('benchmark CLI', () => {
  it('parses only the bounded task, condition, repetition, and approval options', () => {
    expect(parseArguments(['run', '--task', 'task-a', '--condition', 'control', '--repetition', '1', '--approval', 'approval.json'])).toEqual({ command: 'run', options: { task: 'task-a', condition: 'control', repetition: 1, approval: 'approval.json' } });
    expect(() => parseArguments(['run', '--task', 'task-b'])).toThrow('TASK_OUT_OF_SCOPE');
    expect(() => parseArguments(['run', '--repetition', '2'])).toThrow('REPETITION_OUT_OF_SCOPE');
    expect(() => parseArguments(['unknown'])).toThrow('UNKNOWN_COMMAND');
  });

  it('validates all three fixtures without launching Codex', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-cli-'));
    const launches: unknown[] = [], output: string[] = [];
    const exit = await main(['validate', '--output', temp], { write: (line: string) => output.push(line), preflight: async () => { launches.push('model'); }, pilot: async () => { launches.push('pilot'); } });
    expect(exit).toBe(0);
    expect(launches).toEqual([]);
    expect(JSON.parse(output.join(''))).toMatchObject({ status: 'ready', tasks: { 'task-a': { identical: true }, 'task-b': { identical: true }, 'task-c': { identical: true } } });
  }, 120_000);

  it('blocks preflight, a condition run, and the pilot without an explicit approval record', async () => {
    const launched: string[] = [], output: string[] = [], deps = { write: (line: string) => output.push(line), preflight: async () => { launched.push('preflight'); }, run: async () => { launched.push('run'); }, pilot: async () => { launched.push('pilot'); } };
    expect(await main(['preflight-model'], deps)).toBe(2);
    expect(await main(['run', '--task', 'task-a', '--condition', 'control', '--repetition', '1'], deps)).toBe(2);
    expect(await main(['pilot'], deps)).toBe(2);
    expect(launched).toEqual([]);
    expect(output.join('\n')).toContain('PILOT_NOT_AUTHORIZED');
  });
});
