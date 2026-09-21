// Both conditions derive from one frozen shared invocation. The only permitted difference is the `treatment` field
// (DevBrain MCP entry + skill), which is rendered into an isolated CODEX_HOME so user configuration cannot leak in.

export const PINNED_MODEL = 'gpt-5.6-sol';
// Flags the live preflight must find in `codex exec --help` before any measured run; nothing here is assumed to exist.
export const CODEX_EXEC_FLAGS = Object.freeze(['--model', '--json', '--ephemeral', '--ignore-user-config', '--sandbox', '--ask-for-approval']);
export const ENV_ALLOWLIST = Object.freeze(['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'SYSTEMDRIVE', 'SystemDrive', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'LANG', 'LC_ALL', 'TERM', 'SHELL', 'OPENAI_API_KEY', 'CODEX_API_KEY']);
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD/i;
const PARITY_DELTA = Object.freeze(['treatment.mcpConfiguration', 'treatment.skillInstruction']);

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
    args: ['exec', '--model', PINNED_MODEL, '--json', '--ephemeral', '--ignore-user-config', '--sandbox', 'workspace-write', '--ask-for-approval', 'never', run.visiblePrompt],
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

export const controlInvocation = (run) => deepFreeze({ ...sharedInvocation(run), condition: 'control', treatment: { mcpConfiguration: null, skillInstruction: null } });

export function devbrainInvocation(run) {
  const { serverEntry, home, workspaceRoot, skillSource, skillFiles } = run.devbrain ?? {};
  if (!serverEntry || !home || !workspaceRoot || !skillSource) throw new Error('DEVBRAIN_RUN_REQUIRES_SERVER_HOME_WORKSPACE_SKILL');
  return deepFreeze({
    ...sharedInvocation(run), condition: 'devbrain',
    treatment: {
      mcpConfiguration: { name: 'devbrain', command: 'node', args: [serverEntry], env: { DEVBRAIN_HOME: home, DEVBRAIN_WORKSPACE_ROOT: workspaceRoot } },
      skillInstruction: { name: 'refactor-safely', source: skillSource, files: skillFiles ?? [] },
    },
  });
}

const canonical = (value) => JSON.stringify(value, (_, inner) => (inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.keys(inner).sort().map((key) => [key, inner[key]])) : inner));

/** Everything outside the allowlisted delta must be identical; CONTROL must carry no treatment at all. */
export function assertConditionParity(control, treatment) {
  if (control.treatment?.mcpConfiguration !== null || control.treatment?.skillInstruction !== null) throw new Error('CONTROL_HAS_TREATMENT');
  const keys = new Set([...Object.keys(control), ...Object.keys(treatment)]);
  keys.delete('treatment'); keys.delete('condition');
  for (const key of [...keys].sort()) if (canonical(control[key]) !== canonical(treatment[key])) throw new Error(`CONDITION_PARITY_VIOLATION: ${key}`);
  if (control.condition !== 'control' || treatment.condition !== 'devbrain') throw new Error('CONDITION_PARITY_VIOLATION: condition');
  return { status: 'parity', delta: [...PARITY_DELTA] };
}

const toml = (value) => JSON.stringify(value);

/** Files for the isolated CODEX_HOME: a rendered config.toml plus, for DEVBrain only, the skill copy and a pointer. */
export function renderCodexHome(invocation) {
  const lines = [`model = ${toml(invocation.model)}`, 'approval_policy = "never"', 'sandbox_mode = "workspace-write"', '', '[sandbox_workspace_write]', 'network_access = false', ''];
  const files = {};
  const { mcpConfiguration, skillInstruction } = invocation.treatment;
  if (mcpConfiguration) {
    lines.push(`[mcp_servers.${mcpConfiguration.name}]`, `command = ${toml(mcpConfiguration.command)}`, `args = [${mcpConfiguration.args.map(toml).join(', ')}]`, `[mcp_servers.${mcpConfiguration.name}.env]`);
    for (const [key, value] of Object.entries(mcpConfiguration.env)) lines.push(`${key} = ${toml(value)}`);
    lines.push('');
  }
  files['config.toml'] = `${lines.join('\n')}\n`;
  if (skillInstruction) {
    files[`skills/${skillInstruction.name}`] = { copyFrom: skillInstruction.source };
    files['AGENTS.md'] = `# Workflow\n\nFor refactoring requests, follow the \`${skillInstruction.name}\` skill in \`skills/${skillInstruction.name}/SKILL.md\` under this Codex home. Use the \`devbrain\` MCP server it describes.\n`;
  }
  return files;
}
