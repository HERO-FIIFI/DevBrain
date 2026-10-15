// Tolerant Codex `exec --json` JSONL normalization. Recognized shapes get exact fields; anything else is retained as
// `kind: 'unknown'` so schema drift shows up as explicit unknowns rather than silently missing counts.

export const EVENT_PARSER_VERSION = 'codex-jsonl@1';

const eventId = (lineNumber) => `L${lineNumber}`;

export function parseJsonl(text) {
  const events = [], malformed = [];
  const lines = text.split('\n');
  if (lines.length && lines.at(-1) === '') lines.pop();
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === '') return;
    let raw;
    try { raw = JSON.parse(line); } catch (error) { malformed.push({ lineNumber, error: `Invalid JSON: ${error.message}` }); return; }
    events.push(normalizeEvent(raw, lineNumber));
  });
  return { events, malformed, totalLines: lines.length };
}

export function normalizeEvent(raw, lineNumber) {
  const base = { lineNumber, eventId: eventId(lineNumber), rawType: typeof raw?.type === 'string' ? raw.type : null, raw };
  if (!raw || typeof raw !== 'object' || base.rawType === null) return { ...base, kind: 'unknown' };
  const [family, phase] = base.rawType.split('.');
  if (family === 'thread' && phase) return { ...base, kind: 'thread', phase, threadId: raw.thread_id ?? null };
  if (family === 'turn' && phase) {
    const usage = raw.usage && typeof raw.usage === 'object' ? { inputTokens: numberOrNull(raw.usage.input_tokens), cachedInputTokens: numberOrNull(raw.usage.cached_input_tokens), outputTokens: numberOrNull(raw.usage.output_tokens) } : null;
    return { ...base, kind: 'turn', phase, usage, error: raw.error?.message ?? null };
  }
  if (base.rawType === 'error') return { ...base, kind: 'error', error: raw.message ?? null };
  if (family === 'item' && phase && raw.item && typeof raw.item === 'object') {
    const event = { ...base, kind: 'item', phase, item: normalizeItem(raw.item) };
    event.tool = classifyToolEvent(event);
    return event;
  }
  return { ...base, kind: 'unknown' };
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

function normalizeItem(item) {
  const common = { id: item.id ?? null, type: typeof item.type === 'string' ? item.type : null, status: item.status ?? null };
  switch (common.type) {
    case 'command_execution': return { ...common, command: item.command ?? null, output: typeof item.aggregated_output === 'string' ? item.aggregated_output : null, exitCode: numberOrNull(item.exit_code) };
    case 'mcp_tool_call': {
      const resultText = extractResultText(item.result);
      let structured = item.result?.structured_content ?? item.result?.structuredContent ?? null;
      if (structured === null && resultText !== null) { try { structured = JSON.parse(resultText); } catch { structured = null; } }
      return { ...common, server: item.server ?? null, tool: item.tool ?? null, arguments: item.arguments ?? null, resultText, structured, error: item.error ?? null };
    }
    case 'file_change': return { ...common, changes: Array.isArray(item.changes) ? item.changes.map((change) => ({ path: change.path ?? null, kind: change.kind ?? null })) : [] };
    case 'agent_message': return { ...common, text: typeof item.text === 'string' ? item.text : null };
    case 'reasoning': return { ...common, text: typeof item.text === 'string' ? item.text : null };
    default: return { ...common, raw: item };
  }
}

function extractResultText(result) {
  if (result === null || result === undefined) return null;
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) return result.content.filter((part) => part && part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') || null;
  if (typeof result.text === 'string') return result.text;
  return JSON.stringify(result);
}

// ---- shell command classification -------------------------------------------------------------------------------

const WRAPPERS = [/^(?:bash|sh|zsh)\s+-l?c\s+(.*)$/s, /^(?:powershell|pwsh)(?:\.exe)?\s+(?:-NoProfile\s+)?(?:-Command|-c)\s+(.*)$/is, /^cmd(?:\.exe)?\s+\/c\s+(.*)$/is];
const unquote = (text) => { const t = text.trim(); return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t; };

/** Strips `bash -lc "..."`, `powershell -Command "..."`, and `cmd /c ...` wrappers; accepts argv arrays too. */
export function unwrapShell(command) {
  if (Array.isArray(command)) {
    const [head, flag, ...rest] = command;
    if (/^(bash|sh|zsh)$/.test(head ?? '') && /^-l?c$/.test(flag ?? '') && rest.length === 1) return rest[0];
    return command.join(' ');
  }
  if (typeof command !== 'string') return '';
  for (const wrapper of WRAPPERS) { const match = wrapper.exec(command.trim()); if (match) return unquote(match[1]); }
  return command.trim();
}

const tokens = (command) => command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(unquote) ?? [];
const READ_VERBS = new Set(['cat', 'sed', 'head', 'tail', 'less', 'more', 'type', 'Get-Content', 'gc', 'bat', 'nl']);
const SEARCH_VERBS = new Set(['grep', 'rg', 'ag', 'ack', 'findstr', 'Select-String', 'sls', 'egrep', 'fgrep']);
const LIST_VERBS = new Set(['ls', 'dir', 'find', 'fd', 'tree', 'Get-ChildItem', 'gci', 'pwd', 'wc', 'stat', 'file', 'du']);
const LINT_HINTS = /(^|[\s/])(eslint|ruff|flake8|pylint|lint\.mjs|lint\.js)(\s|$)/;
const BUILD_HINTS = /(^|[\s/])(tsc|build\.mjs|build\.js|webpack|vite build|esbuild)(\s|$)/;
const TEST_RUNNERS = /^(vitest|jest|mocha|pytest|tap|ava)$/;

function classifyShell(command) {
  const segments = command.split(/\s*(?:\|\||&&|;|\|)\s*/).filter(Boolean);
  const classes = segments.map(classifySegment);
  const primary = classes.find((entry) => entry.category !== 'unclassified') ?? classes[0] ?? { category: 'unclassified' };
  return { ...primary, command, segments: segments.length };
}

function classifySegment(segment) {
  const argv = tokens(segment);
  const [verb, ...args] = argv;
  if (!verb) return { category: 'unclassified' };
  if (/(^|\s)>{1,2}\s*\S/.test(segment) && !/\s2>/.test(segment)) return { category: 'edit' };
  if (verb === 'sed' && args.some((arg) => arg === '-i' || arg.startsWith('-i'))) return { category: 'edit' };
  if (['apply_patch', 'tee', 'Set-Content', 'Out-File', 'patch'].includes(verb)) return { category: 'edit' };
  if (verb === 'git') return args[0] === 'grep' ? { category: 'search' } : { category: 'git', subcommand: args[0] ?? null };
  if (READ_VERBS.has(verb)) return { category: 'read' };
  if (SEARCH_VERBS.has(verb)) return { category: 'search' };
  if (LIST_VERBS.has(verb)) return { category: 'list' };
  if (verb === 'node' || verb === 'npm' || verb === 'npx' || verb === 'yarn' || verb === 'pnpm' || verb === 'python' || verb === 'python3' || TEST_RUNNERS.test(verb)) return classifyRuntime(verb, args, segment);
  return { category: 'unclassified' };
}

function classifyRuntime(verb, args, segment) {
  if (verb === 'node' && args[0] === '--test') return { category: 'test', scope: args.slice(1).some((arg) => !arg.startsWith('-')) ? 'targeted' : 'full' };
  if ((verb === 'npm' || verb === 'yarn' || verb === 'pnpm') && (args[0] === 'test' || args[0] === 't')) return { category: 'test', scope: args.length > 1 && !args[1].startsWith('-') ? 'targeted' : 'full' };
  if ((verb === 'npm' || verb === 'yarn' || verb === 'pnpm') && args[0] === 'run') {
    const script = args[1] ?? '';
    if (/^test/.test(script)) return { category: 'test', scope: /targeted|:.+/.test(script) || args.length > 2 ? 'targeted' : 'full' };
    if (/lint/.test(script)) return { category: 'lint' };
    if (/build/.test(script)) return { category: 'build' };
    return { category: 'unclassified' };
  }
  if (verb === 'npx' && TEST_RUNNERS.test(args[0] ?? '')) return { category: 'test', scope: args.slice(1).some((arg) => !arg.startsWith('-') && arg !== 'run') ? 'targeted' : 'full' };
  if (TEST_RUNNERS.test(verb)) return { category: 'test', scope: args.some((arg) => !arg.startsWith('-') && arg !== 'run') ? 'targeted' : 'full' };
  if ((verb === 'python' || verb === 'python3') && args[0] === '-m' && args[1] === 'pytest') return { category: 'test', scope: args.length > 2 ? 'targeted' : 'full' };
  if (LINT_HINTS.test(segment)) return { category: 'lint' };
  if (BUILD_HINTS.test(segment)) return { category: 'build' };
  return { category: 'unclassified' };
}

// ---- DevBrain tool classification ---------------------------------------------------------------------------------

const DEVBRAIN_SUBCATEGORY = {
  devbrain_context_pack: 'retrieval', devbrain_read_file_slice: 'retrieval', devbrain_read_symbol: 'retrieval', devbrain_search_text: 'retrieval', devbrain_search_symbols: 'retrieval', devbrain_find_references: 'retrieval', devbrain_get_diff: 'retrieval',
  devbrain_change_impact: 'impact', devbrain_dependency_graph: 'impact', devbrain_architecture_map: 'impact', devbrain_api_inventory: 'impact', devbrain_route_inventory: 'impact', devbrain_database_schema: 'impact', devbrain_migration_status: 'impact',
  devbrain_run_tests: 'execution', devbrain_run_targeted_tests: 'execution', devbrain_run_lint: 'execution', devbrain_run_build: 'execution', devbrain_get_execution_evidence: 'execution', devbrain_diagnose_log: 'execution',
  devbrain_repo_map: 'inventory', devbrain_project_health: 'inventory', devbrain_git_history: 'inventory', devbrain_dependency_audit: 'inventory', devbrain_find_todos: 'inventory', devbrain_inspect_docker: 'inventory',
};
const EXECUTION_SCOPE = { devbrain_run_tests: 'full', devbrain_run_targeted_tests: 'targeted', devbrain_run_lint: 'lint', devbrain_run_build: 'build' };

/** Classifies an item event into a bounded tool vocabulary; unrecognized commands stay `unclassified`. */
export function classifyToolEvent(event) {
  const item = event?.item;
  if (!item) return { category: 'none' };
  if (item.type === 'command_execution') return classifyShell(unwrapShell(item.command));
  if (item.type === 'mcp_tool_call') {
    if (item.server === 'devbrain' || (typeof item.tool === 'string' && item.tool.startsWith('devbrain_'))) {
      const subcategory = DEVBRAIN_SUBCATEGORY[item.tool] ?? 'unclassified';
      return { category: 'devbrain', subcategory, tool: item.tool, ...(EXECUTION_SCOPE[item.tool] ? { scope: EXECUTION_SCOPE[item.tool] } : {}) };
    }
    return { category: 'mcp_other', server: item.server, tool: item.tool };
  }
  if (item.type === 'file_change') return { category: 'edit', files: item.changes.map((change) => change.path) };
  if (item.type === 'agent_message' || item.type === 'reasoning') return { category: 'message' };
  return { category: 'unclassified' };
}

// ---- read command shapes ------------------------------------------------------------------------------------------

const SED_RANGE = /^(\d+),(\d+)p$/;

/** Returns file and line range for recognized single-file read shapes, or null when attribution would be a guess. */
export function parseReadCommand(command) {
  if (/[|<>]/.test(command)) return null;
  const argv = tokens(command);
  const [verb, ...args] = argv;
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (verb === 'cat' || verb === 'type' || verb === 'Get-Content' || verb === 'gc' || verb === 'less' || verb === 'more') {
    const flags = args.filter((arg) => arg.startsWith('-'));
    if (positional.length !== 1 || flags.some((flag) => !['-n', '-b', '-A', '-s', '-e', '-t', '-v'].includes(flag))) return null;
    return { file: positional[0], startLine: 1, endLine: null, whole: true, numbered: flags.includes('-n') || flags.includes('-b') };
  }
  if (verb === 'nl' && positional.length === 1) return { file: positional[0], startLine: 1, endLine: null, whole: true, numbered: true };
  if (verb === 'sed') {
    const nIndex = args.indexOf('-n');
    const rest = args.filter((_, index) => index !== nIndex);
    const range = rest.length === 2 ? SED_RANGE.exec(rest[0]) : null;
    if (nIndex === -1 || !range) return null;
    return { file: rest[1], startLine: Number(range[1]), endLine: Number(range[2]), whole: false, numbered: false };
  }
  if (verb === 'head') {
    let count = 10, file = null;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '-n' && /^\d+$/.test(args[index + 1] ?? '')) { count = Number(args[index + 1]); index += 1; } else if (/^-n\d+$/.test(arg)) count = Number(arg.slice(2)); else if (/^-\d+$/.test(arg)) count = Number(arg.slice(1)); else if (arg.startsWith('-')) return null; else if (file === null) file = arg; else return null;
    }
    return file ? { file, startLine: 1, endLine: count, whole: false, numbered: false } : null;
  }
  if (verb === 'tail') {
    // Start line is unknowable without the file length, so tail is attributable by file only.
    const files = args.filter((arg, index) => !arg.startsWith('-') && !(args[index - 1] === '-n' && /^\d+$/.test(arg)));
    return files.length === 1 ? { file: files[0], startLine: null, endLine: null, whole: false, numbered: false } : null;
  }
  return null;
}
