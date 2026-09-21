import { describe, expect, it } from 'vitest';
import { auditCliCapabilities, inspectCliCondition, parseCliCapabilities } from '../../benchmarks/refactor-safely/harness/cli-compatibility.mjs';

const controlDoctor = {
  codexVersion: '0.149.0-alpha.4.3',
  checks: {
    'config.load': { status: 'ok', details: { CODEX_HOME: 'C:/runs/control/codex-home', 'config.toml': 'C:/runs/control/codex-home/config.toml', 'config.toml parse': 'ok', 'mcp servers': '0', model: 'gpt-5.6-sol' } },
    'mcp.config': { status: 'ok', summary: 'no MCP servers configured', details: {} },
    'sandbox.helpers': { status: 'ok', details: { 'approval policy': 'Never', 'filesystem sandbox': 'restricted', 'network sandbox': 'restricted' } },
  },
};
const treatmentDoctor = {
  codexVersion: '0.149.0-alpha.4.3',
  checks: {
    'config.load': { status: 'ok', details: { CODEX_HOME: 'C:/runs/devbrain/codex-home', 'config.toml': 'C:/runs/devbrain/codex-home/config.toml', 'config.toml parse': 'ok', 'mcp servers': '1', model: 'gpt-5.6-sol' } },
    'mcp.config': { status: 'ok', summary: '1 MCP server configured', details: { devbrain: 'stdio' } },
    'sandbox.helpers': { status: 'ok', details: { 'approval policy': 'Never', 'filesystem sandbox': 'restricted', 'network sandbox': 'restricted' } },
  },
};

describe('version-agnostic Codex CLI compatibility audit', () => {
  it('accepts a minimal CONTROL and a DevBrain-only treatment configuration', () => {
    const control = parseCliCapabilities({ doctor: controlDoctor, mcpList: [], promptInput: [{ role: 'user', content: 'task' }], expectedHome: 'C:/runs/control/codex-home' });
    const devbrain = parseCliCapabilities({ doctor: treatmentDoctor, mcpList: [{ name: 'devbrain', enabled: true }], promptInput: [{ role: 'developer', content: 'refactor-safely' }, { role: 'user', content: 'task' }], expectedHome: 'C:/runs/devbrain/codex-home' });
    expect(auditCliCapabilities(control, devbrain)).toEqual({
      status: 'ready',
      cliVersion: '0.149.0-alpha.4.3',
      common: { model: 'gpt-5.6-sol', approvalPolicy: 'Never', sandbox: 'workspace-write', doctorFilesystem: 'restricted', network: 'restricted' },
      delta: { mcpServers: ['devbrain'], skills: ['refactor-safely'] },
    });
  });

  it('rejects unrelated MCP servers, skills, config paths, or weaker approval policy', () => {
    const control = parseCliCapabilities({ doctor: controlDoctor, mcpList: [], promptInput: [{ role: 'user', content: 'task' }], expectedHome: 'C:/runs/control/codex-home' });
    const baseTreatment = { doctor: treatmentDoctor, expectedHome: 'C:/runs/devbrain/codex-home' };
    expect(() => auditCliCapabilities(control, parseCliCapabilities({ ...baseTreatment, mcpList: [{ name: 'devbrain', enabled: true }, { name: 'github', enabled: true }], promptInput: [{ role: 'developer', content: 'refactor-safely' }] }))).toThrow('UNAPPROVED_MCP_SERVER');
    expect(() => auditCliCapabilities(control, parseCliCapabilities({ ...baseTreatment, mcpList: [{ name: 'devbrain', enabled: true }], promptInput: [{ role: 'developer', content: 'refactor-safely and unrelated-skill' }] }))).toThrow('UNAPPROVED_SKILL');
    const wrongHome = structuredClone(controlDoctor); wrongHome.checks['config.load'].details.CODEX_HOME = 'C:/Users/x/.codex';
    expect(() => parseCliCapabilities({ doctor: wrongHome, mcpList: [], promptInput: [], expectedHome: 'C:/runs/control/codex-home' })).toThrow('CONFIG_HOME_MISMATCH');
    const weaker = structuredClone(controlDoctor); weaker.checks['sandbox.helpers'].details['approval policy'] = 'OnRequest';
    expect(() => auditCliCapabilities(parseCliCapabilities({ doctor: weaker, mcpList: [], promptInput: [], expectedHome: 'C:/runs/control/codex-home' }), parseCliCapabilities({ ...baseTreatment, mcpList: [{ name: 'devbrain', enabled: true }], promptInput: [{ role: 'developer', content: 'refactor-safely' }] }))).toThrow('APPROVAL_POLICY_MISMATCH');
  });

  it('keeps configured model evidence distinct from actual-session resolution', () => {
    const control = parseCliCapabilities({ doctor: controlDoctor, mcpList: [], promptInput: [], expectedHome: 'C:/runs/control/codex-home' });
    expect(control).toMatchObject({ configuredModel: 'gpt-5.6-sol', resolvedModel: null });
  });

  it('accepts legacy and current config diagnostic schemas without a version allowlist', () => {
    const legacy = structuredClone(controlDoctor);
    legacy.codexVersion = '0.90.0';
    legacy.checks['config.load'].details['config.toml'] = ['C:/runs/control/codex-home/config.toml', 'loaded'];
    delete legacy.checks['config.load'].details['config.toml parse'];
    legacy.checks['sandbox.helpers'].details['approval policy'] = 'never';
    legacy.checks['sandbox.helpers'].details['filesystem sandbox'] = 'WorkspaceWrite';
    const parsedLegacy = parseCliCapabilities({ doctor: legacy, mcpList: { servers: [] }, promptInput: [], expectedHome: 'C:/runs/control/codex-home' });
    expect(parsedLegacy).toMatchObject({ cliVersion: '0.90.0', approvalPolicy: 'Never', sandbox: 'workspace-write', doctorFilesystem: 'workspace-write', mcpServers: [] });

    const future = structuredClone(controlDoctor);
    future.codexVersion = '1.7.2';
    future.checks['config.load'].details['config.toml'] = { path: 'C:/runs/control/codex-home/config.toml', status: 'loaded' };
    delete future.checks['config.load'].details['config.toml parse'];
    future.checks['sandbox.helpers'].details['network sandbox'] = 'disabled';
    const parsedFuture = parseCliCapabilities({ doctor: future, mcpList: { servers: [] }, promptInput: [], expectedHome: 'C:/runs/control/codex-home' });
    expect(parsedFuture).toMatchObject({ cliVersion: '1.7.2', doctorFilesystem: 'restricted', network: 'restricted', mcpServers: [] });
  });

  it('collects doctor, MCP, and prompt-input evidence under the condition home', async () => {
    const calls: any[] = [];
    const run = async ({ args }: any, cwd: string, options: any) => {
      calls.push({ args, cwd, env: options.env });
      if (args[0] === 'doctor') return { exitCode: 1, stdout: JSON.stringify(controlDoctor), stderr: '' };
      if (args[0] === 'mcp') return { exitCode: 0, stdout: '[]', stderr: '' };
      if (args[0] === 'debug') return { exitCode: 0, stdout: JSON.stringify([{ role: 'user', content: 'task' }]), stderr: '' };
      throw new Error('unexpected command');
    };
    const evidence = await inspectCliCondition({ executable: 'codex', cwd: 'C:/runs/control/repository', codexHome: 'C:/runs/control/codex-home', environment: { PATH: 'C:/bin', CODEX_HOME: 'C:/runs/control/codex-home' }, run });
    expect(evidence.capabilities).toMatchObject({ configuredModel: 'gpt-5.6-sol', mcpServers: [], skills: [] });
    expect(calls.map((call) => call.args)).toEqual([['doctor', '--json'], ['mcp', 'list', '--json'], ['debug', 'prompt-input', 'task']]);
    expect(calls.every((call) => call.env.CODEX_HOME === 'C:/runs/control/codex-home')).toBe(true);
  });
});
