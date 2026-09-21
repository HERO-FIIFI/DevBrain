import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PINNED_MODEL, assertConditionParity, controlInvocation, devbrainInvocation, normalizeConditionInvocation, renderCodexHome, sharedInvocation } from '../../benchmarks/refactor-safely/harness/conditions.mjs';
import { auditControlIsolation } from '../../benchmarks/refactor-safely/harness/derive.mjs';
import { parseJsonl } from '../../benchmarks/refactor-safely/harness/events.mjs';

const run = (condition: string) => ({
  runId: `task-a-${condition}-1`, taskId: 'task-a', condition, repetition: 1,
  visiblePrompt: 'Rename `AuthService.validateToken()` to `AuthService.verifyToken()`.',
  repositoryRoot: 'C:/runs/abc/repository', codexHome: 'C:/runs/abc/codex-home', timeoutMs: 1_200_000,
  devbrain: { serverEntry: 'C:/devbrain/dist/index.js', home: 'C:/runs/abc/devbrain-home', workspaceRoot: 'C:/runs/abc', skillSource: 'C:/devbrain/skills/refactor-safely', skillFiles: [{ path: 'SKILL.md', bytes: 1200 }] },
  environment: { PATH: 'C:/bin', USERPROFILE: 'C:/Users/x', OPENAI_API_KEY: 'sk-secret', RANDOM_LEAK: '1', CODEX_HOME: 'C:/Users/x/.codex' },
});

describe('condition parity', () => {
  it('derives both conditions from one frozen shared configuration', () => {
    const shared = sharedInvocation(run('control'));
    expect(Object.isFrozen(shared)).toBe(true);
    expect(shared.executable).toBe('codex');
    expect(shared.args).toEqual(['exec', '--model', PINNED_MODEL, '--json', '--ephemeral', '--strict-config', '--sandbox', 'workspace-write', '--ignore-rules', 'Rename `AuthService.validateToken()` to `AuthService.verifyToken()`.']);
    expect(shared.args).not.toContain('--ignore-user-config');
    expect(shared.args).not.toContain('--ask-for-approval');
    expect(shared.args).not.toContain('--search');
    expect(PINNED_MODEL).toBe('gpt-5.6-sol');
    expect(shared.cwd).toBe('C:/runs/abc/repository');
    expect(shared.timeoutMs).toBe(1_200_000);
  });
  it('allowlists the environment and points CODEX_HOME at the isolated run home', () => {
    const control = controlInvocation(run('control'));
    expect(control.env).toEqual({ PATH: 'C:/bin', USERPROFILE: 'C:/Users/x', OPENAI_API_KEY: 'sk-secret', CODEX_HOME: 'C:/runs/abc/codex-home' });
    expect(control.env).not.toHaveProperty('RANDOM_LEAK');
    expect(control.redactedEnvironment).toEqual({ PATH: 'C:/bin', USERPROFILE: 'C:/Users/x', OPENAI_API_KEY: '[REDACTED]', CODEX_HOME: 'C:/runs/abc/codex-home' });
  });
  it('gives CONTROL no treatment and DEVBrain only the explicit MCP and skill delta', () => {
    const control = controlInvocation(run('control')), treatment = devbrainInvocation(run('devbrain'));
    expect(control.treatment).toEqual({ mcpConfiguration: null, skillInstruction: null });
    expect(treatment.treatment.mcpConfiguration).toEqual({ name: 'devbrain', command: 'node', args: ['C:/devbrain/dist/index.js'], env: { DEVBRAIN_HOME: 'C:/runs/abc/devbrain-home', DEVBRAIN_WORKSPACE_ROOT: 'C:/runs/abc' } });
    expect(treatment.treatment.skillInstruction).toEqual({ name: 'refactor-safely', source: 'C:/devbrain/skills/refactor-safely', path: 'C:/runs/abc/codex-home/skills/refactor-safely', files: [{ path: 'SKILL.md', bytes: 1200 }] });
    expect(assertConditionParity(control, treatment)).toEqual({ status: 'parity', delta: ['treatment.mcpConfiguration', 'treatment.skillInstruction'] });
    // Everything outside the rendered config treatment is byte-identical, including prompt, model, flags, cwd, and env.
    expect(control.args).toEqual(treatment.args);
    expect(control.env).toEqual(treatment.env);
    expect(control.prompt).toBe(treatment.prompt);
  });
  it('rejects any drift outside the allowlisted delta', () => {
    const control = controlInvocation(run('control')), drifted = devbrainInvocation({ ...run('devbrain'), visiblePrompt: 'different prompt' });
    expect(() => assertConditionParity(control, drifted)).toThrow('CONDITION_PARITY_VIOLATION: args');
    const wrongModel = { ...devbrainInvocation(run('devbrain')), args: controlInvocation(run('control')).args.map((arg) => (arg === PINNED_MODEL ? 'gpt-5.6' : arg)) };
    expect(() => assertConditionParity(control, wrongModel)).toThrow('CONDITION_PARITY_VIOLATION: args');
    expect(() => assertConditionParity(control, { ...devbrainInvocation(run('devbrain')), env: { ...control.env, EXTRA: '1' } })).toThrow('CONDITION_PARITY_VIOLATION: env');
    expect(() => assertConditionParity({ ...control, treatment: { mcpConfiguration: { name: 'devbrain' }, skillInstruction: null } }, devbrainInvocation(run('devbrain')))).toThrow('CONTROL_HAS_TREATMENT');
  });
  it('renders an isolated codex home whose only DEVBrain additions are the MCP entry, the skill, and the pointer', () => {
    const control = renderCodexHome(controlInvocation(run('control'))), treatment = renderCodexHome(devbrainInvocation(run('devbrain')));
    expect(control['config.toml']).toContain('model = "gpt-5.6-sol"');
    expect(control['config.toml']).toContain('approval_policy = "never"');
    expect(control['config.toml']).toContain('sandbox_mode = "workspace-write"');
    expect(control['config.toml']).toContain('web_search = "disabled"');
    expect(control['config.toml']).toContain('network_access = false');
    expect(control['config.toml']).toContain('inherit = "none"');
    expect(control['config.toml']).toContain('apps = false');
    expect(control['config.toml']).toContain('multi_agent = false');
    expect(control['config.toml']).not.toContain('mcp_servers');
    expect(control['config.toml']).not.toContain('skills.config');
    expect(Object.keys(control)).toEqual(['config.toml']);
    expect(treatment['config.toml'].replace(/\[mcp_servers\.devbrain\][\s\S]*$/, '')).toBe(control['config.toml']);
    expect(treatment['config.toml']).toContain('[mcp_servers.devbrain]\ncommand = "node"\nargs = ["C:/devbrain/dist/index.js"]\nrequired = true\n[mcp_servers.devbrain.env]\nDEVBRAIN_HOME = "C:/runs/abc/devbrain-home"\nDEVBRAIN_WORKSPACE_ROOT = "C:/runs/abc"');
    expect(treatment['config.toml']).toContain('[[skills.config]]\npath = "C:/runs/abc/codex-home/skills/refactor-safely"\nenabled = true');
    expect(treatment['config.toml']).not.toContain('skills/refactor-safely/evals');
    expect(Object.keys(treatment).sort()).toEqual(['AGENTS.md', 'config.toml', 'skills/refactor-safely']);
    expect(treatment['AGENTS.md']).toContain('refactor-safely');
    expect(treatment['skills/refactor-safely']).toEqual({ copyFrom: 'C:/devbrain/skills/refactor-safely' });
    expect(path.isAbsolute(treatment['skills/refactor-safely'].copyFrom)).toBe(true);
  });
  it('normalizes only the approved treatment differences', () => {
    const control = controlInvocation(run('control')), treatment = devbrainInvocation(run('devbrain'));
    expect(normalizeConditionInvocation(control)).toEqual(normalizeConditionInvocation(treatment));
    const leaked = { ...control, renderedConfig: `${control.renderedConfig}\n[mcp_servers.unrelated]\ncommand = "node"\n` };
    expect(() => assertConditionParity(leaked, treatment)).toThrow('CONTROL_HAS_UNAPPROVED_CONFIGURATION');
  });
});

describe('CONTROL isolation', () => {
  it('flags a DevBrain MCP event injected into a CONTROL trace', () => {
    const parsed = parseJsonl('{"type":"thread.started","thread_id":"t"}\n{"type":"item.completed","item":{"id":"i","type":"mcp_tool_call","server":"devbrain","tool":"devbrain_repo_map","arguments":{},"result":{"content":[{"type":"text","text":"{}"}]},"status":"completed"}}\n');
    expect(auditControlIsolation(parsed, { condition: 'control', repositoryRoot: 'C:/runs/abc/repository', skillRoot: 'C:/runs/abc/codex-home/skills/refactor-safely' })).toEqual({ status: 'CONTROL_TREATMENT_LEAK', events: ['L2'] });
    expect(auditControlIsolation(parseJsonl('{"type":"thread.started","thread_id":"t"}\n'), { condition: 'control', repositoryRoot: 'C:/runs/abc/repository', skillRoot: null })).toEqual({ status: 'clean', events: [] });
  });
});
