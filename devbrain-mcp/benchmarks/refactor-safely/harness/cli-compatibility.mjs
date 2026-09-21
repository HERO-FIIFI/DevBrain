// Parses installed-CLI diagnostic evidence and proves the two benchmark conditions differ only by DevBrain.
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { PINNED_MODEL } from './conditions.mjs';
import { runCommand } from './fixtures.mjs';

const normalized = (value) => String(value ?? '').replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const canonicalApproval = (value) => normalized(value).replaceAll('-', '') === 'never' ? 'Never' : String(value ?? '');
const canonicalFilesystem = (value) => normalized(value).replaceAll('-', '') === 'workspacewrite' ? 'workspace-write' : normalized(value);
const canonicalNetwork = (value) => ['restricted', 'disabled', 'false'].includes(normalized(value)) ? 'restricted' : normalized(value);
const configEvidence = (value, parseStatus) => {
  if (typeof value === 'string') return { path: value, loaded: parseStatus === 'ok' };
  if (Array.isArray(value)) return { path: value[0], loaded: ['loaded', 'ok'].includes(normalized(value[1])) };
  if (value && typeof value === 'object') return { path: value.path, loaded: ['loaded', 'ok'].includes(normalized(value.status)) };
  return { path: null, loaded: false };
};
const mcpEntries = (value) => Array.isArray(value) ? value : Array.isArray(value?.servers) ? value.servers : [];
const skillNames = (promptInput) => {
  const text = JSON.stringify(promptInput ?? []);
  const known = [];
  if (/refactor-safely/i.test(text)) known.push('refactor-safely');
  if (/unrelated-skill/i.test(text)) known.push('unrelated-skill');
  return known;
};

export function parseCliCapabilities({ doctor, mcpList, promptInput, expectedHome, expectedSandbox = 'workspace-write' }) {
  const config = doctor?.checks?.['config.load'], sandbox = doctor?.checks?.['sandbox.helpers'];
  if (config?.status !== 'ok' || sandbox?.status !== 'ok') throw new Error('CLI_DIAGNOSTICS_INCOMPLETE');
  const actualHome = config.details?.CODEX_HOME;
  if (normalized(actualHome) !== normalized(expectedHome) || !path.isAbsolute(actualHome)) throw new Error(`CONFIG_HOME_MISMATCH: expected ${expectedHome}; actual ${actualHome ?? '<missing>'}`);
  const loadedConfig = configEvidence(config.details?.['config.toml'], config.details?.['config.toml parse']);
  if (normalized(loadedConfig.path) !== normalized(path.join(expectedHome, 'config.toml')) || !loadedConfig.loaded) throw new Error('MINIMAL_CONFIG_NOT_LOADED');
  const servers = mcpEntries(mcpList).filter((entry) => entry.enabled !== false).map((entry) => entry.name).sort();
  return {
    cliVersion: doctor.codexVersion,
    configHome: actualHome,
    configuredModel: config.details?.model ?? null,
    resolvedModel: null,
    approvalPolicy: canonicalApproval(sandbox.details?.['approval policy']),
    sandbox: expectedSandbox,
    doctorFilesystem: canonicalFilesystem(sandbox.details?.['filesystem sandbox']),
    network: canonicalNetwork(sandbox.details?.['network sandbox']),
    mcpServers: servers,
    skills: skillNames(promptInput),
  };
}

export function auditCliCapabilities(control, devbrain) {
  if (control.approvalPolicy !== 'Never' || devbrain.approvalPolicy !== 'Never') throw new Error('APPROVAL_POLICY_MISMATCH');
  const common = ['cliVersion', 'configuredModel', 'approvalPolicy', 'sandbox', 'doctorFilesystem', 'network'];
  for (const key of common) if (control[key] !== devbrain[key]) throw new Error(`CONDITION_CAPABILITY_MISMATCH: ${key}`);
  if (control.configuredModel !== PINNED_MODEL) throw new Error('CONFIGURED_MODEL_MISMATCH');
  if (control.sandbox !== 'workspace-write' || !['workspace-write', 'restricted'].includes(control.doctorFilesystem) || control.network !== 'restricted') throw new Error('SANDBOX_POLICY_MISMATCH');
  if (control.mcpServers.length) throw new Error('CONTROL_MCP_LEAK');
  if (control.skills.length) throw new Error('CONTROL_SKILL_LEAK');
  if (devbrain.mcpServers.some((name) => name !== 'devbrain') || devbrain.mcpServers.length !== 1) throw new Error('UNAPPROVED_MCP_SERVER');
  if (devbrain.skills.some((name) => name !== 'refactor-safely') || devbrain.skills.length !== 1) throw new Error('UNAPPROVED_SKILL');
  return { status: 'ready', cliVersion: control.cliVersion, common: { model: control.configuredModel, approvalPolicy: control.approvalPolicy, sandbox: control.sandbox, doctorFilesystem: control.doctorFilesystem, network: control.network }, delta: { mcpServers: devbrain.mcpServers, skills: devbrain.skills } };
}

export async function inspectCliCondition({ executable = 'codex', cwd, codexHome, environment, run = runCommand }) {
  const invoke = (args) => run({ executable, args }, cwd, { timeoutMs: 30_000, env: environment });
  const doctorResult = await invoke(['doctor', '--json']);
  const mcpResult = await invoke(['mcp', 'list', '--json']);
  const promptResult = await invoke(['debug', 'prompt-input', 'task']);
  if (!doctorResult.stdout?.trim()) throw new Error(`CLI_DOCTOR_EVIDENCE_MISSING: ${doctorResult.stderr?.trim() ?? ''}`);
  if (mcpResult.exitCode !== 0) throw new Error(`CLI_MCP_INSPECTION_FAILED: ${(mcpResult.stderr || mcpResult.stdout).trim()}`);
  if (promptResult.exitCode !== 0) throw new Error(`CLI_PROMPT_INSPECTION_FAILED: ${(promptResult.stderr || promptResult.stdout).trim()}`);
  const doctor = JSON.parse(doctorResult.stdout), mcpList = JSON.parse(mcpResult.stdout), promptInput = JSON.parse(promptResult.stdout);
  const expectedHome = await realpath(codexHome).catch(() => codexHome);
  return {
    capabilities: parseCliCapabilities({ doctor, mcpList, promptInput, expectedHome }),
    raw: { doctor, mcpList, promptInput },
  };
}
