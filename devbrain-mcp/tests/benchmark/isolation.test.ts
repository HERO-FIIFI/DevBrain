import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../benchmarks/refactor-safely/harness/artifacts.mjs';
import { sharedInvocation } from '../../benchmarks/refactor-safely/harness/conditions.mjs';
import { listFiles, loadTask, materializeTask } from '../../benchmarks/refactor-safely/harness/fixtures.mjs';
import { EVALUATOR_ROOT, assertPromptIsolation, auditIsolation, createRunLayout, plantCanary, spawnCodex } from '../../benchmarks/refactor-safely/harness/process.mjs';

const FAKE = path.join(__dirname, 'fixtures', 'fake-codex.mjs');
let temp = '';
beforeAll(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-isolation-')); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

describe('working root isolation', () => {
  it('gives the agent a cwd that contains only the task repository', async () => {
    const layout = await createRunLayout(path.join(temp, 'run-1'));
    expect(Object.keys(layout).sort()).toEqual(['artifacts', 'codexHome', 'devbrainHome', 'hidden', 'repository', 'root']);
    for (const dir of ['artifacts', 'codexHome', 'devbrainHome', 'hidden']) { expect(path.relative(layout.repository, layout[dir]).startsWith('..')).toBe(true); expect((await stat(layout[dir])).isDirectory()).toBe(true); }
    const task = await loadTask('task-a');
    const snapshot = await materializeTask(task, layout.repository);
    expect(await listFiles(layout.repository)).toEqual(snapshot.files);
    expect(await listFiles(task.repositoryRoot)).toEqual(snapshot.files);
  }, 60_000);
  it('keeps evaluator paths out of the prompt', async () => {
    const task = await loadTask('task-a');
    const invocation = sharedInvocation({ visiblePrompt: task.visiblePrompt, repositoryRoot: path.join(temp, 'r'), codexHome: path.join(temp, 'h'), environment: {} });
    expect(assertPromptIsolation(invocation.prompt)).toEqual({ status: 'clean' });
    expect(() => assertPromptIsolation(`${task.visiblePrompt} See ${EVALUATOR_ROOT}/task-a.mjs`)).toThrow('PROMPT_REFERENCES_EVALUATOR');
    expect(() => assertPromptIsolation('Look in benchmarks/refactor-safely/evaluators for the answer')).toThrow('PROMPT_REFERENCES_EVALUATOR');
    expect(() => assertPromptIsolation('mention of a hidden/canary-deadbeef.txt file')).toThrow('PROMPT_REFERENCES_CANARY');
  });
  it('plants a randomized canary outside the repository', async () => {
    const layout = await createRunLayout(path.join(temp, 'run-2'));
    const first = await plantCanary(layout), second = await plantCanary(await createRunLayout(path.join(temp, 'run-3')));
    expect(first.token).toMatch(/^[0-9a-f]{32}$/);
    expect(first.token).not.toBe(second.token);
    expect(path.relative(layout.repository, first.path).startsWith('..')).toBe(true);
    expect(await readFile(first.path, 'utf8')).toContain(first.token);
  });
  it('invalidates a run whose events or stderr reference the canary or evaluator', async () => {
    const layout = await createRunLayout(path.join(temp, 'run-4'));
    const canary = await plantCanary(layout);
    const clean = { rawEvents: '{"type":"thread.started"}\n{"type":"item.completed","item":{"id":"i","type":"command_execution","command":"bash -lc \\"cat src/a.js\\"","aggregated_output":"x","exit_code":0}}\n', stderr: 'ok\n', canary, layout };
    expect(auditIsolation(clean)).toEqual({ status: 'clean', findings: [] });
    expect(auditIsolation({ ...clean, rawEvents: `${clean.rawEvents}{"type":"item.completed","item":{"id":"j","type":"command_execution","command":"bash -lc \\"cat ../hidden/canary.txt\\"","aggregated_output":"${canary.token}","exit_code":0}}\n` })).toMatchObject({ status: 'ISOLATION_VIOLATION', findings: [expect.objectContaining({ kind: 'canary_token', where: 'events', lineNumber: 3 })] });
    expect(auditIsolation({ ...clean, stderr: `read ${canary.path}\n` })).toMatchObject({ status: 'ISOLATION_VIOLATION', findings: [expect.objectContaining({ kind: 'canary_path', where: 'stderr' })] });
    expect(auditIsolation({ ...clean, rawEvents: `{"type":"item.completed","item":{"id":"k","type":"command_execution","command":"bash -lc \\"cat ${EVALUATOR_ROOT.replaceAll('\\', '/')}/task-a.mjs\\"","aggregated_output":"","exit_code":0}}\n` })).toMatchObject({ status: 'ISOLATION_VIOLATION', findings: [expect.objectContaining({ kind: 'evaluator_path' })] });
    expect(auditIsolation({ ...clean, rawEvents: '{"type":"item.completed","item":{"id":"k","type":"command_execution","command":"bash -lc \\"ls ../hidden\\"","aggregated_output":"canary-abc.txt","exit_code":0}}\n' })).toMatchObject({ status: 'ISOLATION_VIOLATION', findings: [expect.objectContaining({ kind: 'hidden_directory' })] });
  });
});

describe('process streaming and timeout', () => {
  it('streams stdout and stderr into exclusive raw sinks and hashes them', async () => {
    const store = await ArtifactStore.open(path.join(temp, 'stream-run'));
    const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
    const result = await spawnCodex({ executable: 'node', args: [FAKE, '--lines', '2'], cwd: temp, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 30_000 }, sinks);
    const [events, stderr] = await Promise.all([sinks.stdout.finalize(), sinks.stderr.finalize()]);
    expect(result).toMatchObject({ exitCode: 0, signal: null, timedOut: false, stdoutBytes: events.bytes, stderrBytes: stderr.bytes });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(await store.verify('codex-events.jsonl')).toMatchObject({ valid: true, bytes: events.bytes });
    expect((await readFile(path.join(temp, 'stream-run', 'raw', 'codex-events.jsonl'), 'utf8')).split('\n').filter(Boolean)).toHaveLength(4);
    expect(await readFile(path.join(temp, 'stream-run', 'raw', 'codex-stderr.log'), 'utf8')).toContain('model: gpt-5.6-sol');
    await expect(store.openRawSink('codex-events.jsonl')).rejects.toThrow('ARTIFACT_ALREADY_EXISTS');
  }, 30_000);
  it('reports a non-zero exit without throwing', async () => {
    const store = await ArtifactStore.open(path.join(temp, 'exit-run'));
    const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
    const result = await spawnCodex({ executable: 'node', args: [FAKE, '--exit', '3'], cwd: temp, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 30_000 }, sinks);
    await Promise.all([sinks.stdout.finalize(), sinks.stderr.finalize()]);
    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
  }, 30_000);
  it('terminates a hung process tree on timeout and keeps partial raw evidence', async () => {
    const store = await ArtifactStore.open(path.join(temp, 'hang-run'));
    const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
    const result = await spawnCodex({ executable: 'node', args: [FAKE, '--lines', '1', '--hang'], cwd: temp, env: { PATH: process.env.PATH ?? '' }, timeoutMs: 1_500 }, sinks);
    const events = await sinks.stdout.finalize(); await sinks.stderr.finalize();
    expect(result.timedOut).toBe(true);
    expect(result.exitCode === null || result.exitCode !== 0).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(1_400);
    expect(events.bytes).toBeGreaterThan(0);
    expect((await readFile(path.join(temp, 'hang-run', 'raw', 'codex-events.jsonl'), 'utf8'))).toContain('"thread.started"');
    expect(await store.verify('codex-events.jsonl')).toMatchObject({ valid: true });
  }, 30_000);
  it('rejects when the executable cannot be spawned', async () => {
    const store = await ArtifactStore.open(path.join(temp, 'enoent-run'));
    const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
    await expect(spawnCodex({ executable: 'definitely-not-a-real-codex-binary', args: [], cwd: temp, env: {}, timeoutMs: 5_000 }, sinks)).rejects.toThrow(/ENOENT|SPAWN_FAILED/);
    await Promise.all([sinks.stdout.finalize(), sinks.stderr.finalize()]);
  }, 30_000);
});
