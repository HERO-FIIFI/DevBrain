import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PINNED_MODEL } from '../../benchmarks/refactor-safely/harness/conditions.mjs';
import { PILOT_MATRIX, STATES, preflightModel, runCondition, runPilotAfterApproval } from '../../benchmarks/refactor-safely/harness/runner.mjs';

let temp = '';
beforeAll(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-runner-')); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

const RENAME = /\bvalidateToken\b/g;
const A_FILES = ['src/auth/auth-service.js', 'src/http/auth-middleware.js', 'src/session/session-restorer.js', 'src/cli/inspect-token.js', 'tests/visible/auth-service.test.js'];

/** A fake agent: applies the rename inside its cwd, emits JSONL like Codex, and reports the pinned model. */
function fakeAgent(log: any[], { fail = false, model = PINNED_MODEL } = {}) {
  return async (invocation: any, sinks: any) => {
    log.push({ cwd: invocation.cwd, args: invocation.args, env: invocation.env, condition: invocation.condition });
    if (fail) throw new Error('SPAWN_FAILED: simulated agent crash');
    for (const file of A_FILES) { const target = path.join(invocation.cwd, ...file.split('/')); await writeFile(target, (await readFile(target, 'utf8')).replace(RENAME, 'verifyToken')); }
    await sinks.stderr.write('model: gpt-5.6-sol\n');
    const events = [
      { type: 'thread.started', thread_id: 'fake', model },
      { type: 'item.completed', item: { id: 'i0', type: 'command_execution', command: 'bash -lc "cat src/auth/auth-service.js"', aggregated_output: 'export class AuthService {}\n', exit_code: 0, status: 'completed' } },
      { type: 'item.completed', item: { id: 'i1', type: 'file_change', changes: A_FILES.map((p) => ({ path: p, kind: 'update' })), status: 'completed' } },
      { type: 'item.completed', item: { id: 'i2', type: 'command_execution', command: 'bash -lc "node --test"', aggregated_output: '# pass 10\n', exit_code: 0, status: 'completed' } },
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } },
    ];
    for (const event of events) await sinks.stdout.write(`${JSON.stringify(event)}\n`);
    return { pid: 1, exitCode: 0, signal: null, timedOut: false, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), durationMs: 12, stdoutBytes: 1, stderrBytes: 1 };
  };
}
const readyPreflight = { status: 'ready', requested: PINNED_MODEL, resolved: PINNED_MODEL, evidence: { source: 'cli_session_metadata', raw: 'model: gpt-5.6-sol' }, cliSurface: { status: 'ok', missing: [] }, catalog: { status: 'ok', models: [PINNED_MODEL], aliases: {}, sources: ['fake'] } };
let runsCounter = 0;
const spec = (condition: string, overrides = {}) => ({ taskId: 'task-a', condition, repetition: 1, runsRoot: path.join(temp, `runs-${runsCounter += 1}`), environment: { PATH: process.env.PATH ?? '', OPENAI_API_KEY: 'sk-secret-value-123' }, timeoutMs: 60_000, ...overrides });
const deps = (log: any[], overrides = {}) => ({ spawn: fakeAgent(log), preflight: readyPreflight, prepareApprovals: async () => ({ approvals: [], method: { storeEdited: false } }), ...overrides });

describe('run state machine', () => {
  it('walks prepared -> model_verified -> agent_complete -> harness_verified -> evaluated -> derived', async () => {
    const log: any[] = [];
    const result = await runCondition(spec('control'), deps(log));
    expect(result.state).toBe('derived');
    expect(result.transitions.map((entry: any) => entry.state)).toEqual(['prepared', 'model_verified', 'agent_complete', 'harness_verified', 'evaluated', 'derived']);
    expect(STATES).toEqual(['prepared', 'model_verified', 'agent_complete', 'harness_verified', 'evaluated', 'derived', 'blocked', 'harness_error']);
    const raw = await readdir(path.join(result.path, 'artifacts', 'raw'));
    for (const name of ['codex-events.jsonl', 'codex-stderr.log', 'invocation.json', 'environment.json', 'repository-before.json', 'repository-after.json', 'repository-diff.patch', 'visible-verification.json', 'hidden-evaluation.json', 'artifact-hashes.json']) expect(raw).toContain(name);
    const record = JSON.parse(await readFile(path.join(result.path, 'artifacts', 'derived', 'run-record.json'), 'utf8'));
    expect(record.provenance.raw.map((entry: any) => entry.name)).toContain('codex-events.jsonl');
    expect(record.value.patch.status).toBe('SUCCESS');
    expect(record.value.agent).toMatchObject({ requestedModel: PINNED_MODEL, resolvedModel: PINNED_MODEL });
    expect(record.value.context.agentVisible.repository_source.grossLines).toBe(1);
    expect(record.value.context.deterministicScanning.repositorySource).toMatchObject({ confidence: 'exact' });
    expect(record.value.context.evaluatorReads.explicitReads).toMatchObject({ confidence: 'exact' });
    expect(record.value.isolation).toEqual({ canary: { status: 'clean', findings: [] }, control: { status: 'clean', events: [] } });
    expect(log[0].cwd).toBe(path.join(result.path, 'repository'));
    expect(log[0].env.CODEX_HOME).toBe(path.join(result.path, 'codex-home'));
    // The invocation artifact never carries secrets or the treatment for CONTROL.
    const invocation = JSON.parse(await readFile(path.join(result.path, 'artifacts', 'raw', 'invocation.json'), 'utf8'));
    expect(invocation.treatment).toEqual({ mcpConfiguration: null, skillInstruction: null });
    expect(JSON.stringify(invocation)).not.toContain('sk-secret-value-123');
    expect(invocation.env.OPENAI_API_KEY).toBe('[REDACTED]');
    expect(log[0].env.OPENAI_API_KEY).toBe('sk-secret-value-123');
  }, 120_000);
  it('renders the DEVBrain codex home with the MCP entry and skill, and prepares approvals before launch', async () => {
    const log: any[] = [], approvals: any[] = [];
    const result = await runCondition(spec('devbrain'), deps(log, { prepareApprovals: async (args: any) => { approvals.push(args); return { approvals: [{ capability: 'test', status: 'approved' }], method: { storeEdited: false } }; } }));
    expect(result.state).toBe('derived');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].repositoryRoot).toBe(path.join(result.path, 'repository'));
    const config = await readFile(path.join(result.path, 'codex-home', 'config.toml'), 'utf8');
    expect(config).toContain('[mcp_servers.devbrain]');
    expect(config).toContain(`DEVBRAIN_HOME = ${JSON.stringify(path.join(result.path, 'devbrain-home').replaceAll('\\', '/'))}`);
    expect(await readdir(path.join(result.path, 'codex-home', 'skills', 'refactor-safely'))).toContain('SKILL.md');
    expect(await readdir(path.join(result.path, 'artifacts', 'raw'))).toContain('approvals.json');
    const record = JSON.parse(await readFile(path.join(result.path, 'artifacts', 'derived', 'run-record.json'), 'utf8'));
    expect(record.value.context.agentVisible.skill_instruction.grossBytes).toBeGreaterThan(0);
  }, 120_000);
  it('blocks before launch when fixture identity does not match the expected baseline', async () => {
    const log: any[] = [];
    const result = await runCondition(spec('control', { expectedBaseline: { repositorySha: 'f'.repeat(40), contentSha256: 'f'.repeat(64) } }), deps(log));
    expect(result.state).toBe('blocked');
    expect(result.error).toContain('FIXTURE_IDENTITY_MISMATCH');
    expect(log).toHaveLength(0);
  }, 60_000);
  it('blocks before launch when the model preflight is not ready', async () => {
    const log: any[] = [];
    const result = await runCondition(spec('control'), deps(log, { preflight: { status: 'BLOCKED', reason: 'no resolved model evidence' } }));
    expect(result).toMatchObject({ state: 'blocked', error: expect.stringContaining('MODEL_GATE_BLOCKED') });
    expect(log).toHaveLength(0);
  }, 60_000);
  it('ends in harness_error without retrying when the agent process fails', async () => {
    const log: any[] = [];
    const result = await runCondition(spec('control'), deps(log, { spawn: fakeAgent(log, { fail: true }) }));
    expect(result.state).toBe('harness_error');
    expect(log).toHaveLength(1);
    expect(result.transitions.map((entry: any) => entry.state)).toEqual(['prepared', 'model_verified', 'harness_error']);
  }, 60_000);
  it('blocks a run whose events resolve a different model than the preflight', async () => {
    const log: any[] = [];
    const result = await runCondition(spec('control'), deps(log, { spawn: fakeAgent(log, { model: 'gpt-5.6' }) }));
    expect(result.state).toBe('blocked');
    expect(result.error).toContain('conflict');
  }, 60_000);
});

describe('pilot stop control', () => {
  it('contains exactly two Task A runs and rejects anything else', async () => {
    expect(PILOT_MATRIX).toEqual([{ taskId: 'task-a', condition: 'control', repetition: 1 }, { taskId: 'task-a', condition: 'devbrain', repetition: 1 }]);
    await expect(runPilotAfterApproval({ approval: null, runsRoot: temp })).rejects.toThrow('PILOT_NOT_AUTHORIZED');
    await expect(runPilotAfterApproval({ approval: { approvedBy: 'x', statement: 'PILOT_EXECUTION_APPROVED' }, runsRoot: temp, matrix: [...PILOT_MATRIX, { taskId: 'task-a', condition: 'control', repetition: 2 }] })).rejects.toThrow('MATRIX_OUT_OF_SCOPE');
    await expect(runPilotAfterApproval({ approval: { approvedBy: 'x', statement: 'PILOT_EXECUTION_APPROVED' }, runsRoot: temp, matrix: [{ taskId: 'task-b', condition: 'control', repetition: 1 }] })).rejects.toThrow('MATRIX_OUT_OF_SCOPE');
  });
  it('runs CONTROL first, then DEVBrain in a different fresh root, with identical baselines and no retries', async () => {
    const log: any[] = [];
    const pilot = await runPilotAfterApproval({ approval: { approvedBy: 'test', statement: 'PILOT_EXECUTION_APPROVED' }, runsRoot: path.join(temp, 'pilot'), environment: { PATH: process.env.PATH ?? '' }, deps: deps(log) });
    expect(pilot.runs.map((run: any) => [run.condition, run.state])).toEqual([['control', 'derived'], ['devbrain', 'derived']]);
    expect(log.map((entry: any) => entry.condition)).toEqual(['control', 'devbrain']);
    expect(log[0].cwd).not.toBe(log[1].cwd);
    expect(pilot.runs[0].path).not.toBe(pilot.runs[1].path);
    expect(pilot.baselineParity).toEqual({ status: 'identical', repositorySha: expect.stringMatching(/^[0-9a-f]{40}$/), contentSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(pilot.conditionParity).toEqual({ status: 'parity', delta: ['treatment.mcpConfiguration', 'treatment.skillInstruction'] });
  }, 180_000);
});

describe('model preflight', () => {
  const compatible = async () => ({ status: 'ready', cliVersion: '0.149.0-alpha.4.3', common: { model: PINNED_MODEL, approvalPolicy: 'Never', sandbox: 'WorkspaceWrite', network: 'restricted' }, delta: { mcpServers: ['devbrain'], skills: ['refactor-safely'] } });
  it('blocks when the CLI surface lacks a planned flag and never launches a probe', async () => {
    const launched: any[] = [];
    const result = await preflightModel({ cliHelp: async () => 'Usage: codex exec\n  --model <MODEL>\n', inspectConditions: compatible, discover: async () => ({ adapters: [], catalog: { status: 'ok', models: [PINNED_MODEL], aliases: {}, sources: ['fake'] } }), probe: async () => { launched.push(1); return { events: '', stderr: '' }; } });
    expect(result).toMatchObject({ status: 'BLOCKED', cliSurface: { status: 'BLOCKED', missing: expect.arrayContaining(['--json', '--ephemeral']) } });
    expect(launched).toHaveLength(0);
  });
  it('is ready only with catalog, CLI surface, and trustworthy resolved-model evidence from a probe', async () => {
    const help = 'Usage\n  --model <MODEL>\n  --json\n  --ephemeral\n  --strict-config\n  --sandbox <MODE>\n  --ignore-rules\n';
    const discover = async () => ({ adapters: [], catalog: { status: 'ok', models: [PINNED_MODEL], aliases: {}, sources: ['fake'] } });
    expect(await preflightModel({ cliHelp: async () => help, inspectConditions: compatible, discover, probe: async () => ({ events: `${JSON.stringify({ type: 'thread.started', thread_id: 't', model: PINNED_MODEL })}\n`, stderr: '' }) })).toMatchObject({ status: 'ready', resolved: PINNED_MODEL, evidence: { source: 'event' }, compatibility: { status: 'ready' } });
    expect(await preflightModel({ cliHelp: async () => help, inspectConditions: compatible, discover, probe: async () => ({ events: '{"type":"turn.started"}\n', stderr: '' }) })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('no resolved model evidence') });
    expect(await preflightModel({ cliHelp: async () => help, inspectConditions: compatible, discover: async () => ({ adapters: [], catalog: { status: 'failed', error: 'codex missing', sources: [] } }), probe: async () => ({ events: '', stderr: '' }) })).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('discovery failed') });
  });
  it('blocks on condition isolation drift before catalog discovery or a live probe', async () => {
    const launched: string[] = [], help = ' --model --json --ephemeral --strict-config --sandbox --ignore-rules ';
    const result = await preflightModel({ cliHelp: async () => help, inspectConditions: async () => ({ status: 'BLOCKED', reason: 'UNAPPROVED_MCP_SERVER' }), discover: async () => { launched.push('catalog'); return { adapters: [], catalog: { status: 'ok', models: [PINNED_MODEL], aliases: {} } }; }, probe: async () => { launched.push('probe'); return { events: '', stderr: '' }; } });
    expect(result).toMatchObject({ status: 'BLOCKED', reason: expect.stringContaining('UNAPPROVED_MCP_SERVER') });
    expect(launched).toEqual([]);
  });
});
