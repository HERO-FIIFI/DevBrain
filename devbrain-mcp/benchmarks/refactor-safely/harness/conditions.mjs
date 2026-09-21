// Both conditions derive from one frozen shared invocation. The only permitted difference is the `treatment` field
// (DevBrain MCP entry + skill), which is rendered into an isolated CODEX_HOME so user configuration cannot leak in.

export const PINNED_MODEL = 'gpt-5.6-sol';
// Flags the live preflight must find in `codex exec --help` before any measured run; nothing here is assumed to exist.
export const CODEX_EXEC_FLAGS = Object.freeze(['--model', '--json', '--ephemeral', '--strict-config', '--sandbox', '--ignore-rules']);
export const ENV_ALLOWLIST = Object.freeze(['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'SystemDrive', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'OPENAI_API_KEY', 'CODEX_API_KEY']);
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD/i;
const PARITY_DELTA = Object.freeze(['treatment.mcpConfiguration', 'treatment.skillInstruction']);
const posix = (value) => String(value).replaceAll('\\', '/').replace(/\/$/, '');

const deepFreeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };

/** The immutable configuration both conditions share: model, flags, prompt, cwd, allowlisted env, timeout. */
export function sharedInvocation(run) {
  if (typeof run.visiblePrompt !== 'string' || !run.visiblePrompt) throw new Error('RUN_REQUIRES_PROMPT');
  if (!run.repositoryRoot || !run.codexHome) throw new Error('RUN_REQUIRES_ROOTS');
  const env = {};
  for (const key of ENV_ALLOWLIST) if (run.environment?.[key] !== undefined) env[key] = run.environment[key];
  env.CODEX_HOME = run.codexHome;
  return deepFreeze({
    executable: 'codex',
    args: ['exec', '--model', PINNED_MODEL, '--json', '--ephemeral', '--strict-config', '--sandbox', 'workspace-write', '--ignore-rules', run.visiblePrompt],
    prompt: run.visiblePrompt,
    model: PINNED_MODEL,
    cwd: run.repositoryRoot,
    env,
    redactedEnvironment: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, SECRET_ENV.test(key) ? '[REDACTED]' : value])),
    timeoutMs: run.timeoutMs ?? 1_800_000,
    codexHome: run.codexHome,
    configIsolation: 'CODEX_HOME points at a run-private directory rendered by the harness; user config, MCP servers, and skills are not visible',
  });
}

function buildInvocation(shared, condition, treatment) {
  const invocation = { ...shared, condition, treatment };
  invocation.renderedConfig = renderConfig(invocation);
  return deepFreeze(invocation);
}

export const controlInvocation = (run) => buildInvocation(sharedInvocation(run), 'control', { mcpConfiguration: null, skillInstruction: null });

export function devbrainInvocation(run) {
  const { serverEntry, home, workspaceRoot, skillSource, skillFiles } = run.devbrain ?? {};
  if (!serverEntry || !home || !workspaceRoot || !skillSource) throw new Error('DEVBRAIN_RUN_REQUIRES_SERVER_HOME_WORKSPACE_SKILL');
  return buildInvocation(sharedInvocation(run), 'devbrain', {
      mcpConfiguration: { name: 'devbrain', command: 'node', args: [serverEntry], env: { DEVBRAIN_HOME: home, DEVBRAIN_WORKSPACE_ROOT: workspaceRoot } },
      skillInstruction: { name: 'refactor-safely', source: skillSource, path: `${posix(run.codexHome)}/skills/refactor-safely`, files: skillFiles ?? [] },
  });
}

const canonical = (value) => JSON.stringify(value, (_, inner) => (inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]])) : inner));

/** Everything outside the allowlisted delta must be identical; CONTROL must carry no treatment at all. */
export function assertConditionParity(control, treatment) {
  if (control.treatment?.mcpConfiguration !== null || control.treatment?.skillInstruction !== null) throw new Error('CONTROL_HAS_TREATMENT');
  if (/\[mcp_servers\.|\[\[skills\.config\]\]/.test(control.renderedConfig ?? '')) throw new Error('CONTROL_HAS_UNAPPROVED_CONFIGURATION');
  const keys = new Set([...Object.keys(control), ...Object.keys(treatment)]);
  keys.delete('treatment'); keys.delete('condition'); keys.delete('renderedConfig');
  for (const key of [...keys].sort()) if (canonical(control[key]) !== canonical(treatment[key])) throw new Error(`CONDITION_PARITY_VIOLATION: ${key}`);
  if (control.condition !== 'control' || treatment.condition !== 'devbrain') throw new Error('CONDITION_PARITY_VIOLATION: condition');
  if (!treatment.renderedConfig?.startsWith(control.renderedConfig)) throw new Error('CONDITION_PARITY_VIOLATION: config');
  if (!/\[mcp_servers\.devbrain\]/.test(treatment.renderedConfig) || !/\[\[skills\.config\]\]/.test(treatment.renderedConfig)) throw new Error('DEVBRAIN_TREATMENT_CONFIGURATION_MISSING');
  return { status: 'parity', delta: [...PARITY_DELTA] };
}

export function normalizeConditionInvocation(invocation) {
  const normalized = {};
  for (const key of Object.keys(invocation).sort()) if (!['condition', 'treatment', 'renderedConfig'].includes(key)) normalized[key] = invocation[key];
  normalized.renderedConfig = (invocation.renderedConfig ?? '').split('[mcp_servers.devbrain]')[0];
  return normalized;
}

const toml = (value) => JSON.stringify(value);

/** Files for the isolated CODEX_HOME: a rendered config.toml plus, for DEVBrain only, the skill copy and a pointer. */
function renderConfig(invocation) {
  const lines = [
    `model = ${toml(invocation.model)}`,
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'web_search = "disabled"',
    'check_for_update_on_startup = false',
    '',
    '[analytics]',
    'enabled = false',
    '',
    '[features]',
    'apps = false',
    'goals = false',
    'hooks = false',
    'memories = false',
    'multi_agent = false',
    'remote_plugin = false',
    '',
    '[sandbox_workspace_write]',
    'network_access = false',
    '',
    '[shell_environment_policy]',
    'inherit = "none"',
    'ignore_default_excludes = false',
    '',
  ];
  const { mcpConfiguration, skillInstruction } = invocation.treatment;
  if (mcpConfiguration) {
    lines.push(`[mcp_servers.${mcpConfiguration.name}]`, `command = ${toml(mcpConfiguration.command)}`, `args = [${mcpConfiguration.args.map(toml).join(', ')}]`, 'required = true', `[mcp_servers.${mcpConfiguration.name}.env]`);
    for (const [key, value] of Object.entries(mcpConfiguration.env)) lines.push(`${key} = ${toml(value)}`);
    lines.push('');
  }
  if (skillInstruction) lines.push('[[skills.config]]', `path = ${toml(skillInstruction.path)}`, 'enabled = true', '');
  return `${lines.join('\n')}\n`;
}

export function renderCodexHome(invocation) {
  const files = {};
  const { mcpConfiguration, skillInstruction } = invocation.treatment;
  files['config.toml'] = invocation.renderedConfig ?? renderConfig(invocation);
  if (skillInstruction) {
    files[`skills/${skillInstruction.name}`] = { copyFrom: skillInstruction.source };
    files['AGENTS.md'] = `# Workflow\n\nFor refactoring requests, follow the \`${skillInstruction.name}\` skill in \`skills/${skillInstruction.name}/SKILL.md\` under this Codex home. Use the \`devbrain\` MCP server it describes.\n`;
  }
  return files;
}
