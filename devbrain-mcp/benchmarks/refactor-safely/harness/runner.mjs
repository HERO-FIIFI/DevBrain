// Orchestrates one benchmark condition through an explicit state machine and guards the two-run pilot matrix.
// A condition never schedules another condition and a failed condition is never retried.
import { Buffer } from 'node:buffer';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { DEVBRAIN_SERVER_ENTRY, prepareDevBrainApprovals } from './approvals.mjs';
import { ArtifactStore } from './artifacts.mjs';
import { CODEX_EXEC_FLAGS, PINNED_MODEL, assertConditionParity, controlInvocation, devbrainInvocation, renderCodexHome } from './conditions.mjs';
import { PARSER_VERSION, auditControlIsolation, deriveRunMetrics } from './derive.mjs';
import { parseJsonl } from './events.mjs';
import { loadTask, materializeTask, runCommand, snapshotRepository } from './fixtures.mjs';
import { exact, unknownMeasurement } from './measurements.mjs';
import { assertPinnedModel, discoverModels, resolveModelEvidence, verifyCliSurface } from './model-gate.mjs';
import { classifyPatch, classifySkillDiscipline } from './outcome.mjs';
import { assertPromptIsolation, auditIsolation, createRunLayout, plantCanary, spawnCodex } from './process.mjs';
import { newRunRecord } from './run-record.mjs';

export const HARNESS_VERSION = 'refactor-safely-harness@1';
export const STATES = Object.freeze(['prepared', 'model_verified', 'agent_complete', 'harness_verified', 'evaluated', 'derived', 'blocked', 'harness_error']);
export const PILOT_MATRIX = Object.freeze([{ taskId: 'task-a', condition: 'control', repetition: 1 }, { taskId: 'task-a', condition: 'devbrain', repetition: 1 }]);
const BENCHMARK_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILL_SOURCE = fileURLToPath(new URL('../../../skills/refactor-safely/', import.meta.url)).replace(/[\\/]$/, '');
const EVALUATOR_CLI = path.join(BENCHMARK_ROOT, 'evaluators', 'cli.mjs');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const posix = (value) => value.replaceAll('\\', '/');

// Only SKILL.md is injected by the host; references are measured when the agent reads them. `evals/` never ships.
const SKILL_SHIPPED = ['SKILL.md', 'agents', 'references'];
async function injectedSkillFiles(source) { return [{ path: 'SKILL.md', bytes: Buffer.byteLength(await readFile(path.join(source, 'SKILL.md'), 'utf8')) }]; }
async function copySkill(source, target) { await mkdir(target, { recursive: true }); for (const entry of SKILL_SHIPPED) await cp(path.join(source, entry), path.join(target, entry), { recursive: true }); }

/** Run-specific roots differ between conditions by construction; parity is judged after replacing them. */
function normalizeForParity(invocation, runRoot) { const text = JSON.stringify(invocation).replaceAll(JSON.stringify(runRoot).slice(1, -1), '<RUN_ROOT>').replaceAll(posix(runRoot), '<RUN_ROOT>'); return JSON.parse(text); }

// ---- model preflight ----------------------------------------------------------------------------------------------

/** CLI surface, catalog discovery, then one trivial ephemeral probe whose events/stderr must resolve the pinned model. */
export async function preflightModel({ executable = 'codex', cliHelp, discover = discoverModels, probe } = {}) {
  const help = cliHelp ?? (async () => { const result = await runCommand({ executable, args: ['exec', '--help'] }, process.cwd(), { timeoutMs: 30_000 }); if (result.exitCode !== 0) throw new Error(`CLI_HELP_FAILED: ${(result.stderr || result.stdout).trim().slice(0, 200)}`); return result.stdout; });
  const record = { requested: PINNED_MODEL, harnessVersion: HARNESS_VERSION, checkedAt: new Date().toISOString() };
  let helpText;
  try { helpText = await help(); } catch (error) { return { ...record, status: 'BLOCKED', reason: `CLI unavailable: ${error.message}`, cliSurface: null, catalog: null, resolved: null, evidence: null }; }
  const cliSurface = verifyCliSurface(helpText, CODEX_EXEC_FLAGS);
  if (cliSurface.status !== 'ok') return { ...record, status: 'BLOCKED', reason: `CLI surface lacks planned flags: ${cliSurface.missing.join(', ')}`, cliSurface, catalog: null, resolved: null, evidence: null };
  const discovery = await discover({ executable });
  const catalogGate = assertPinnedModel({ requested: PINNED_MODEL, resolved: PINNED_MODEL, catalog: discovery.catalog });
  if (catalogGate.status !== 'ready') return { ...record, status: 'BLOCKED', reason: catalogGate.reason, cliSurface, catalog: discovery.catalog, adapters: discovery.adapters, resolved: null, evidence: null };
  const probed = await (probe ?? defaultProbe)({ executable });
  const evidence = resolveModelEvidence({ parsed: parseJsonl(probed.events), stderr: probed.stderr });
  const gate = assertPinnedModel({ requested: PINNED_MODEL, resolved: evidence.resolved, evidence: evidence.evidence, conflicts: evidence.conflicts, catalog: discovery.catalog });
  return { ...record, status: gate.status, reason: gate.reason ?? null, cliSurface, catalog: discovery.catalog, adapters: discovery.adapters, resolved: evidence.resolved, evidence: evidence.evidence, probe: { eventBytes: Buffer.byteLength(probed.events), stderrBytes: Buffer.byteLength(probed.stderr) } };
}

async function defaultProbe({ executable }) {
  const home = path.join(os.tmpdir(), `devbrain-preflight-${Date.now()}`), cwd = path.join(home, 'empty');
  await mkdir(cwd, { recursive: true });
  const invocation = controlInvocation({ visiblePrompt: 'Reply with the single word OK and do nothing else.', repositoryRoot: cwd, codexHome: path.join(home, 'codex-home'), environment: process.env, timeoutMs: 120_000 });
  await mkdir(invocation.codexHome, { recursive: true });
  await writeFile(path.join(invocation.codexHome, 'config.toml'), renderCodexHome(invocation)['config.toml']);
  const store = await ArtifactStore.open(path.join(home, 'artifacts'));
  const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
  await spawnCodex({ ...invocation, executable }, sinks);
  await Promise.all([sinks.stdout.finalize(), sinks.stderr.finalize()]);
  return { events: await readFile(sinks.stdout.path, 'utf8'), stderr: await readFile(sinks.stderr.path, 'utf8'), artifacts: store.root };
}

// ---- one condition ------------------------------------------------------------------------------------------------

/**
 * Runs exactly one condition and returns `{ state, runId, path, transitions, error? }`.
 * deps: { spawn, preflight, prepareApprovals, evaluate } are injectable so tests never launch a real model.
 */
export async function runCondition(spec, deps = {}) {
  const { taskId, condition, repetition } = spec;
  const runId = `${taskId}-${condition}-${repetition}`;
  const root = path.join(spec.runsRoot, runId);
  const transitions = [];
  const transition = async (state, detail = {}) => { transitions.push({ state, at: new Date().toISOString(), ...detail }); await writeFile(path.join(root, 'run-state.json'), json({ runId, state, transitions })); };
  const finish = (state, error) => ({ state, runId, path: root, transitions, ...(error ? { error } : {}) });
  const spawn = deps.spawn ?? spawnCodex, prepareApprovals = deps.prepareApprovals ?? prepareDevBrainApprovals;
  try {
    // prepared: fresh layout, canary, deterministic fixture, isolated codex home, invocation artifacts.
    const layout = await createRunLayout(root);
    const store = await ArtifactStore.open(layout.artifacts);
    const canary = await plantCanary(layout);
    const task = await loadTask(taskId);
    const before = await materializeTask(task, layout.repository);
    assertPromptIsolation(task.visiblePrompt);
    if (spec.expectedBaseline && (spec.expectedBaseline.repositorySha !== before.repositorySha || spec.expectedBaseline.contentSha256 !== before.contentSha256)) { await transition('blocked', { reason: 'FIXTURE_IDENTITY_MISMATCH' }); return finish('blocked', `FIXTURE_IDENTITY_MISMATCH: expected ${spec.expectedBaseline.repositorySha}/${spec.expectedBaseline.contentSha256}, materialized ${before.repositorySha}/${before.contentSha256}`); }
    const runInput = { runId, taskId, condition, repetition, visiblePrompt: task.visiblePrompt, repositoryRoot: layout.repository, codexHome: layout.codexHome, timeoutMs: spec.timeoutMs, environment: spec.environment ?? process.env, devbrain: { serverEntry: posix(DEVBRAIN_SERVER_ENTRY), home: posix(layout.devbrainHome), workspaceRoot: posix(layout.root), skillSource: posix(SKILL_SOURCE), skillFiles: await injectedSkillFiles(SKILL_SOURCE) } };
    const invocation = condition === 'devbrain' ? devbrainInvocation(runInput) : controlInvocation(runInput);
    for (const [file, content] of Object.entries(renderCodexHome(invocation))) { const target = path.join(layout.codexHome, file); if (typeof content === 'string') { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); } else await copySkill(content.copyFrom, target); }
    await store.createRaw('invocation.json', json({ ...invocation, env: invocation.redactedEnvironment, redactedEnvironment: undefined }));
    await store.createRaw('environment.json', json({ platform: process.platform, arch: process.arch, node: process.version, harnessVersion: HARNESS_VERSION, parserVersion: PARSER_VERSION, hostname: os.hostname(), runsRoot: spec.runsRoot }));
    await store.createRaw('repository-before.json', json(before));
    const scanned = await scannedBytes(layout.repository, before.files);
    await transition('prepared', { repositorySha: before.repositorySha, contentSha256: before.contentSha256 });

    // model_verified: the preflight decision is data; a run never launches on a BLOCKED gate.
    const preflight = deps.preflight ?? (await readPreflight());
    await store.createRaw('model-preflight.json', json(preflight));
    if (preflight?.status !== 'ready') { await transition('blocked', { reason: 'MODEL_GATE_BLOCKED' }); return finish('blocked', `MODEL_GATE_BLOCKED: ${preflight?.reason ?? 'no preflight record'}`); }
    await transition('model_verified', { resolved: preflight.resolved });

    // agent_complete: approvals for the treatment only, then one agent process streamed into raw sinks.
    if (condition === 'devbrain') await store.createRaw('approvals.json', json(await prepareApprovals({ task, repositoryRoot: layout.repository, workspaceRoot: layout.root, devbrainHome: layout.devbrainHome })));
    const sinks = { stdout: await store.openRawSink('codex-events.jsonl'), stderr: await store.openRawSink('codex-stderr.log') };
    let agent;
    try { agent = await spawn(invocation, sinks); } finally { await Promise.all([sinks.stdout.finalize(), sinks.stderr.finalize()]); }
    const after = await snapshotRepository(layout.repository);
    await store.createRaw('agent-process.json', json(agent));
    await store.createRaw('repository-after.json', json(after));
    await store.createRaw('repository-diff.patch', (await runCommand({ executable: 'git', args: ['diff', 'HEAD', '--'] }, layout.repository)).stdout);
    await transition('agent_complete', { exitCode: agent.exitCode, timedOut: agent.timedOut, durationMs: agent.durationMs });

    // harness_verified + evaluated: the hidden evaluator runs in a separate process against the finished repository.
    const evaluation = await (deps.evaluate ?? evaluateInProcessTree)(taskId, layout.repository);
    await store.createRaw('visible-verification.json', json(evaluation.harnessVerification));
    if (evaluation.harnessVerification?.status === 'ok') await transition('harness_verified');
    await store.createRaw('hidden-evaluation.json', json({ checks: evaluation.checks, changedFiles: evaluation.changedFiles, reads: evaluation.reads }));
    await transition('evaluated', { checks: evaluation.checks.length });

    // derived: parse, audit, gate, derive, classify; everything cites raw hashes.
    const eventsText = await readFile(sinks.stdout.path, 'utf8'), stderrText = await readFile(sinks.stderr.path, 'utf8');
    const parsed = parseJsonl(eventsText);
    const isolation = auditIsolation({ rawEvents: eventsText, stderr: stderrText, canary, layout });
    const controlAudit = condition === 'control' ? auditControlIsolation(parsed, { repositoryRoot: layout.repository, skillRoot: path.join(layout.codexHome, 'skills', 'refactor-safely') }) : { status: 'not_applicable', events: [] };
    const modelEvidence = resolveModelEvidence({ parsed, stderr: stderrText });
    // A run whose own evidence disagrees with the preflight is a conflict, whichever identifier the run reports.
    const conflicts = preflight.resolved && modelEvidence.resolved && modelEvidence.resolved !== preflight.resolved ? [{ field: 'preflight', value: preflight.resolved }, { eventId: modelEvidence.evidence?.eventId, field: modelEvidence.evidence?.field ?? 'run', value: modelEvidence.resolved }] : modelEvidence.conflicts;
    const modelGate = assertPinnedModel({ requested: PINNED_MODEL, resolved: modelEvidence.resolved, evidence: modelEvidence.evidence, conflicts, catalog: preflight.catalog ?? undefined });
    await store.createRaw('artifact-hashes.json', json(await store.manifest()));
    const raw = await store.manifest();
    const metrics = deriveRunMetrics(parsed, { condition, repositoryRoot: layout.repository, skillRoot: path.join(layout.codexHome, 'skills', 'refactor-safely'), prompt: task.visiblePrompt, skillFiles: condition === 'devbrain' ? runInput.devbrain.skillFiles : [], raw: raw.map(({ name, sha256 }) => ({ name, sha256 })) }, PARSER_VERSION);
    const record = newRunRecord({ runId, taskId, condition, repetition });
    Object.assign(record, {
      agent: { requestedModel: PINNED_MODEL, resolvedModel: modelEvidence.resolved, modelEvidence: modelEvidence.evidence, modelGate: { status: modelGate.status, reason: modelGate.reason ?? null }, configuration: { args: invocation.args, cwd: invocation.cwd, env: invocation.redactedEnvironment, treatment: invocation.treatment } },
      baseline: before,
      after: { repositorySha: after.repositorySha, contentSha256: after.contentSha256, status: after.status },
      context: { agentVisible: metrics.context.agentVisible, deterministicScanning: { repositorySource: exact(scanned, 'bytes'), subprocessReads: unknownMeasurement('bytes', 'git and hashing subprocess reads are not observable') }, evaluatorReads: { explicitReads: evaluation.reads.explicitReads, subprocessReads: evaluation.reads.subprocessReads, files: evaluation.reads.files } },
      tools: metrics.tools, changes: evaluation.changedFiles, harnessVerification: evaluation.harnessVerification, agentBehavior: metrics.agentBehavior,
      patch: classifyPatch(evaluation.checks, evaluation.harnessVerification), discipline: classifySkillDiscipline(metrics.agentBehavior),
      devbrain: metrics.devbrain, treatment: metrics.treatment, treatmentLeak: metrics.treatmentLeak, usage: metrics.usage,
      isolation: { canary: isolation, control: controlAudit },
      timing: { startedAt: agent.startedAt, endedAt: agent.endedAt, durationMs: agent.durationMs, timedOut: agent.timedOut, exitCode: agent.exitCode },
      notes: [], provenance: metrics.provenance,
    });
    const provenance = { parserVersion: PARSER_VERSION, harnessVersion: HARNESS_VERSION, raw: raw.map(({ name, sha256 }) => ({ name, sha256 })), rule: 'deriveRunMetrics + classifyPatch + classifySkillDiscipline over codex-events.jsonl, hidden-evaluation.json, visible-verification.json' };
    await store.createDerived('run-record.json', record, provenance);
    await store.createDerived('metric-provenance.json', { events: metrics.provenance, exposureCategories: Object.keys(metrics.context.agentVisible), isolation: record.isolation, modelGate: record.agent.modelGate }, provenance);
    if (isolation.status !== 'clean' || controlAudit.status === 'CONTROL_TREATMENT_LEAK') { await transition('harness_error', { reason: 'ISOLATION_VIOLATION' }); return finish('harness_error', `ISOLATION_VIOLATION: ${JSON.stringify({ canary: isolation.findings, control: controlAudit.events })}`); }
    if (modelGate.status !== 'ready') { await transition('blocked', { reason: 'MODEL_GATE_BLOCKED_POST_RUN' }); return finish('blocked', `MODEL_GATE_BLOCKED_POST_RUN: ${modelGate.reason}`); }
    if (record.patch.status === 'HARNESS_ERROR') { await transition('harness_error', { reason: 'EVALUATION_HARNESS_ERROR' }); return finish('harness_error', `EVALUATION_HARNESS_ERROR: ${record.patch.reasons.join('; ')}`); }
    await transition('derived', { patch: record.patch.status, discipline: record.discipline.status });
    return finish('derived');
  } catch (error) {
    await transition('harness_error', { error: error.message }).catch(() => {});
    return finish('harness_error', error.message);
  }
}

async function scannedBytes(root, files) { let total = 0; for (const file of files) total += (await readFile(path.join(root, ...file.split('/')))).length; return total; }

async function readPreflight() { try { return JSON.parse(await readFile(path.join(BENCHMARK_ROOT, 'reports', 'model-preflight.json'), 'utf8')); } catch { return null; } }

async function evaluateInProcessTree(taskId, root) {
  const result = await runCommand({ executable: 'node', args: [EVALUATOR_CLI, taskId, root] }, BENCHMARK_ROOT, { timeoutMs: 600_000 });
  if (result.exitCode !== 0) throw new Error(`EVALUATOR_PROCESS_FAILED: ${result.stderr.trim().slice(0, 500)}`);
  return JSON.parse(result.stdout);
}

// ---- pilot ----------------------------------------------------------------------------------------------------------

/** Exactly the two Task A runs, CONTROL first, each in its own fresh root; anything else is rejected before any launch. */
export async function runPilotAfterApproval({ approval, runsRoot, environment, matrix = PILOT_MATRIX, deps = {}, timeoutMs = 1_800_000 }) {
  if (!approval || approval.statement !== 'PILOT_EXECUTION_APPROVED' || !approval.approvedBy) throw new Error('PILOT_NOT_AUTHORIZED: pilot execution requires an explicit approval record');
  if (matrix.length !== PILOT_MATRIX.length || !matrix.every((entry, index) => JSON.stringify(entry) === JSON.stringify(PILOT_MATRIX[index]))) throw new Error('MATRIX_OUT_OF_SCOPE: only Task A CONTROL repetition 1 and Task A DEVBrain repetition 1 are authorized');
  const runs = [];
  for (const entry of matrix) runs.push({ ...entry, ...(await runCondition({ ...entry, runsRoot, environment, timeoutMs }, deps)) });
  const rawJson = async (run, name) => { try { return JSON.parse(await readFile(path.join(run.path, 'artifacts', 'raw', name), 'utf8')); } catch { return null; } };
  const [control, treatment] = await Promise.all(runs.map((run) => rawJson(run, 'repository-before.json')));
  const baselineParity = control && treatment && control.repositorySha === treatment.repositorySha && control.contentSha256 === treatment.contentSha256 ? { status: 'identical', repositorySha: control.repositorySha, contentSha256: control.contentSha256 } : { status: 'mismatch', control, treatment };
  let conditionParity;
  try {
    const [c, t] = await Promise.all(runs.map((run) => rawJson(run, 'invocation.json')));
    conditionParity = assertConditionParity(normalizeForParity(c, runs[0].path), normalizeForParity(t, runs[1].path));
  } catch (error) { conditionParity = { status: 'violation', error: error.message }; }
  return { approval: { approvedBy: approval.approvedBy, at: approval.at ?? new Date().toISOString() }, runs, baselineParity, conditionParity };
}
