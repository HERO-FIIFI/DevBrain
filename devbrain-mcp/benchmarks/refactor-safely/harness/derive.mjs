// Derives per-run metrics from normalized events. Every number cites the raw artifact hashes and parser version;
// values the events cannot support are null with a reason, never zero.
import { Buffer } from 'node:buffer';
import { EVENT_PARSER_VERSION, parseReadCommand, unwrapShell } from './events.mjs';
import { ExposureLedger, lineBytes } from './exposure.mjs';
import { reported, unknownMeasurement } from './measurements.mjs';

export const PARSER_VERSION = `derive@1+${EVENT_PARSER_VERSION}`;
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const RETRIEVAL_TOOLS_WITH_SOURCE = new Set(['devbrain_context_pack', 'devbrain_read_file_slice', 'devbrain_read_symbol', 'devbrain_search_text', 'devbrain_find_references', 'devbrain_get_diff']);

const posix = (value) => String(value).replaceAll('\\', '/');
const isAbsolute = (file) => /^(?:[A-Za-z]:)?\//.test(file);

/** Where a read path lives: inside the task repository, under the skill directory, or elsewhere. */
function classifyPath(file, context) {
  const normalized = posix(file), repo = context.repositoryRoot ? posix(context.repositoryRoot).replace(/\/$/, '') : null, skill = context.skillRoot ? posix(context.skillRoot).replace(/\/$/, '') : null;
  if (skill && (normalized === skill || normalized.startsWith(`${skill}/`))) return 'skill';
  if (isAbsolute(normalized)) return repo && (normalized === repo || normalized.startsWith(`${repo}/`)) ? 'repository' : 'outside';
  return normalized.split('/').includes('..') ? 'outside' : 'repository';
}

const splitOutput = (output) => { const lines = output.split('\n'); if (lines.length && lines.at(-1) === '') lines.pop(); return lines; };

export function deriveRunMetrics(parsed, context, parserVersion = PARSER_VERSION) {
  const { events, malformed } = parsed;
  const ledger = new ExposureLedger();
  const tools = { totalCalls: 0, processCalls: 0, reads: 0, searches: 0, lists: 0, git: 0, edits: 0, tests: 0, lint: 0, build: 0, devbrain: 0, mcpOther: 0, unclassified: 0, repeatedSearches: 0, repeatedReads: 0, unclassifiedCommands: [] };
  const behavior = { targetedTestsRun: false, fullRegressionRun: false, lintRun: false, buildRun: false, verificationFailures: 0, contextExpansions: null, agentMessages: 0 };
  const devbrain = { calls: 0, contextPacks: [], retrievalCalls: 0, impactCalls: 0, executionCalls: 0 };
  const leak = [], searchCommands = new Map(), readRanges = new Map();
  let usage = null, firstPackIndex = -1, postPackShellSourceLines = 0, postPackShellDuplicateLines = 0, expansions = 0;

  ledger.add({ domain: 'agent_visible', category: 'task_instruction', metadataBytes: bytes(context.prompt ?? ''), eventId: 'prompt', confidence: 'exact', origin: 'harness' });
  for (const skillFile of context.skillFiles ?? []) ledger.add({ domain: 'agent_visible', category: 'skill_instruction', metadataBytes: skillFile.bytes, eventId: `skill:${skillFile.path}`, confidence: 'reported', origin: 'harness' });

  events.forEach((event, index) => {
    if (event.kind === 'turn' && event.phase === 'completed' && event.usage) usage = event.usage;
    if (event.kind !== 'item' || event.phase !== 'completed') return;
    const { item, tool } = event;
    if (tool.category === 'message') { if (item.type === 'agent_message') behavior.agentMessages += 1; return; }
    if (tool.category === 'none') return;
    tools.totalCalls += 1;
    const afterPack = firstPackIndex !== -1 && index > firstPackIndex;

    if (item.type === 'command_execution') {
      tools.processCalls += 1;
      const output = item.output ?? '';
      switch (tool.category) {
        case 'read': { tools.reads += 1; const entry = recordShellRead(ledger, event, tool.command, output, context, leak); if (entry?.attributed && entry.category === 'repository_source') { if (afterPack) { expansions += 1; postPackShellSourceLines += entry.grossLines; postPackShellDuplicateLines += entry.grossLines - entry.uniqueLines; } const key = `${entry.file}\0${entry.startLine}\0${entry.endLine}`; if (readRanges.has(key)) tools.repeatedReads += 1; readRanges.set(key, true); } else if (entry && entry.category === 'repository_source' && afterPack) expansions += 1; break; }
        case 'search': { tools.searches += 1; if (searchCommands.has(tool.command)) tools.repeatedSearches += 1; searchCommands.set(tool.command, true); if (item.exitCode === 0 && output) { ledger.add({ domain: 'agent_visible', category: 'repository_source', sourceBytes: bytes(output), eventId: event.eventId, confidence: 'partial', origin: 'shell', reason: 'search output carries source lines without a single attributable range' }); if (afterPack) expansions += 1; } else ledger.add({ domain: 'agent_visible', category: 'other_tool_output', metadataBytes: bytes(output), eventId: event.eventId, confidence: 'exact', origin: 'shell' }); break; }
        case 'test': case 'lint': case 'build': { tools[tool.category === 'test' ? 'tests' : tool.category] += 1; markVerification(behavior, tool.category, tool.scope, item.exitCode !== 0); ledger.add({ domain: 'agent_visible', category: 'verification_output', metadataBytes: bytes(output), eventId: event.eventId, confidence: 'exact', origin: 'shell' }); break; }
        case 'list': tools.lists += 1; other(ledger, event, output); break;
        case 'git': tools.git += 1; other(ledger, event, output); break;
        case 'edit': tools.edits += 1; other(ledger, event, output); break;
        default: tools.unclassified += 1; tools.unclassifiedCommands.push(tool.command ?? unwrapShell(item.command)); other(ledger, event, output);
      }
      return;
    }
    if (item.type === 'file_change') { tools.edits += 1; return; }
    if (item.type === 'mcp_tool_call' && tool.category === 'devbrain') {
      tools.devbrain += 1; devbrain.calls += 1;
      if (context.condition === 'control') leak.push(event.eventId);
      if (tool.subcategory === 'retrieval') { devbrain.retrievalCalls += 1; if (afterPack) expansions += 1; }
      if (tool.subcategory === 'impact') devbrain.impactCalls += 1;
      if (tool.subcategory === 'execution') devbrain.executionCalls += 1;
      if (item.tool === 'devbrain_context_pack' && firstPackIndex === -1) firstPackIndex = index;
      recordDevBrainResult(ledger, event, behavior, devbrain);
      return;
    }
    if (item.type === 'mcp_tool_call') { tools.mcpOther += 1; other(ledger, event, item.resultText ?? ''); return; }
    tools.unclassified += 1;
  });

  const summary = ledger.summary();
  const treatment = classifyTreatment(devbrain, summary.agent_visible.repository_source, postPackShellSourceLines, postPackShellDuplicateLines);
  behavior.contextExpansions = firstPackIndex === -1 ? null : expansions;
  return {
    provenance: { parserVersion, raw: context.raw ?? [], eventCount: events.length, unknownEvents: events.filter((event) => event.kind === 'unknown').length, malformedLines: malformed.length },
    tools, agentBehavior: behavior, devbrain, treatment,
    treatmentLeak: { detected: leak.length > 0, events: leak },
    context: { agentVisible: summary.agent_visible, deterministicScanning: { note: 'harness scans are recorded by the runner, not derived from agent events' }, evaluatorReads: { note: 'evaluator reads are recorded by the evaluator, not derived from agent events' } },
    usage: usage ? { inputTokens: tokenMeasurement(usage.inputTokens), cachedInputTokens: tokenMeasurement(usage.cachedInputTokens), outputTokens: tokenMeasurement(usage.outputTokens) } : { inputTokens: unknownMeasurement('tokens', 'no turn.completed usage event'), cachedInputTokens: unknownMeasurement('tokens', 'no turn.completed usage event'), outputTokens: unknownMeasurement('tokens', 'no turn.completed usage event') },
  };
}

const tokenMeasurement = (value) => (value === null ? unknownMeasurement('tokens', 'usage field absent from turn.completed') : reported(value, 'tokens'));
const other = (ledger, event, output) => ledger.add({ domain: 'agent_visible', category: 'other_tool_output', metadataBytes: bytes(output), eventId: event.eventId, confidence: 'exact', origin: 'shell' });

function markVerification(behavior, category, scope, failed) {
  if (category === 'test') { if (scope === 'full') behavior.fullRegressionRun = true; else behavior.targetedTestsRun = true; }
  if (category === 'lint') behavior.lintRun = true;
  if (category === 'build') behavior.buildRun = true;
  if (failed) behavior.verificationFailures += 1;
}

function recordShellRead(ledger, event, command, output, context, leak) {
  const shape = parseReadCommand(command);
  const base = { domain: 'agent_visible', eventId: event.eventId, origin: 'shell' };
  if (event.item.exitCode !== 0) return ledger.add({ ...base, category: 'other_tool_output', metadataBytes: bytes(output), confidence: 'exact' });
  if (!shape) return ledger.add({ ...base, category: 'repository_source', sourceBytes: bytes(output), confidence: 'partial', reason: 'read command shape is not attributable to one file range' });
  const location = classifyPath(shape.file, context);
  if (location === 'skill') { if (context.condition === 'control') leak.push(event.eventId); return ledger.add({ ...base, category: 'skill_instruction', metadataBytes: bytes(output), confidence: 'exact' }); }
  if (location === 'outside') return ledger.add({ ...base, category: 'other_tool_output', metadataBytes: bytes(output), confidence: 'exact' });
  if (shape.startLine === null) return ledger.add({ ...base, category: 'repository_source', file: shape.file, sourceBytes: bytes(output), confidence: 'partial', reason: 'tail output has no known start line' });
  const lines = splitOutput(output);
  const expected = shape.endLine === null ? lines.length : shape.endLine - shape.startLine + 1;
  if (lines.length > expected) return ledger.add({ ...base, category: 'repository_source', file: shape.file, sourceBytes: bytes(output), confidence: 'partial', reason: 'output has more lines than the requested range' });
  // A short file ends the range early; the exposed lines are exactly what was returned.
  return ledger.add({ ...base, category: 'repository_source', file: posix(shape.file), startLine: shape.startLine, endLine: shape.startLine + lines.length - 1, text: lines.join('\n'), numbered: shape.numbered ? 'cat-n' : false, confidence: 'exact' });
}

function recordDevBrainResult(ledger, event, behavior, devbrain) {
  const { item, tool } = event;
  const base = { domain: 'agent_visible', eventId: event.eventId, origin: 'devbrain' };
  if (item.resultText === null) return ledger.add({ ...base, category: 'devbrain_metadata', confidence: 'unknown', unknownReason: `${item.tool} result payload absent from event` });
  const total = bytes(item.resultText), structured = item.structured ?? {};
  if (tool.subcategory === 'execution') {
    if (tool.scope) markVerification(behavior, tool.scope === 'lint' || tool.scope === 'build' ? tool.scope : 'test', tool.scope, structured.resultStatus === 'failed' || (structured.executionStatus && structured.executionStatus !== 'completed'));
    return ledger.add({ ...base, category: 'verification_output', metadataBytes: total, confidence: 'exact' });
  }
  if (item.tool === 'devbrain_context_pack') devbrain.contextPacks.push({ eventId: event.eventId, status: structured.status ?? null, candidateItems: structured.excluded?.candidateItems ?? null, includedItems: structured.items?.length ?? null, budgetExcludedItems: structured.excluded?.budgetExcludedItems ?? null, truncated: structured.truncated ?? null, confidence: structured.confidence ?? null, usage: structured.usage ?? null });
  if (!RETRIEVAL_TOOLS_WITH_SOURCE.has(item.tool)) return ledger.add({ ...base, category: 'devbrain_metadata', metadataBytes: total, confidence: 'exact' });
  let sourceBytes = 0;
  const slices = [];
  if (Array.isArray(structured.items)) for (const slice of structured.items) if (typeof slice.content === 'string') slices.push({ file: slice.file, startLine: slice.startLine, text: slice.content, numbered: 'devbrain' });
  if (typeof structured.content === 'string' && structured.file && Number.isInteger(structured.startLine)) slices.push({ file: structured.file, startLine: structured.startLine, text: structured.content, numbered: 'devbrain' });
  for (const match of structured.matches ?? []) if (typeof match.preview === 'string') slices.push({ file: match.file, startLine: match.line, text: match.preview, numbered: false });
  for (const reference of structured.references ?? []) if (typeof reference.context === 'string') slices.push({ file: reference.file, startLine: reference.line, text: reference.context, numbered: false });
  for (const slice of slices) {
    const lines = slice.text.split('\n');
    // Numbered DevBrain slices carry their own line numbers; trust them over the declared range when bounded by bytes.
    const start = slice.numbered === 'devbrain' ? Number(/^(\d+): /.exec(lines[0])?.[1] ?? slice.startLine) : slice.startLine;
    ledger.add({ ...base, category: 'repository_source', file: posix(slice.file), startLine: start, endLine: start + lines.length - 1, text: slice.text, numbered: slice.numbered, confidence: 'exact' });
    sourceBytes += lines.reduce((sum, line) => sum + lineBytes(line), 0);
  }
  if (typeof structured.patch === 'string' && structured.patch) { ledger.add({ ...base, category: 'repository_source', sourceBytes: bytes(structured.patch) + 1, confidence: 'partial', reason: 'diff patch text carries source lines without one attributable range' }); sourceBytes += bytes(structured.patch) + 1; }
  return ledger.add({ ...base, category: 'devbrain_metadata', metadataBytes: Math.max(0, total - sourceBytes), confidence: 'exact' });
}

function classifyTreatment(devbrain, source, postPackShellSourceLines, postPackShellDuplicateLines) {
  if (devbrain.retrievalCalls === 0) return { classification: 'unknown', reason: 'no DevBrain retrieval events in this run', postPackShellSourceLines: null, postPackShellDuplicateLines: null };
  if (devbrain.contextPacks.length === 0) return { classification: 'unknown', reason: 'DevBrain retrieval without a Context Pack has no substitution baseline', postPackShellSourceLines: null, postPackShellDuplicateLines: null };
  if (source.unattributedEvents > 0) return { classification: 'unknown', reason: 'unattributable shell source output prevents overlap measurement', postPackShellSourceLines, postPackShellDuplicateLines };
  if (postPackShellSourceLines === 0) return { classification: 'substitutive', reason: 'no repository lines were read through shell commands after the first Context Pack', postPackShellSourceLines, postPackShellDuplicateLines };
  if (postPackShellDuplicateLines === postPackShellSourceLines) return { classification: 'additive', reason: 'every repository line read through shell commands after the first Context Pack had already been provided by DevBrain', postPackShellSourceLines, postPackShellDuplicateLines };
  return { classification: 'mixed', reason: 'shell reads after the first Context Pack mixed already-provided lines with new lines', postPackShellSourceLines, postPackShellDuplicateLines };
}
