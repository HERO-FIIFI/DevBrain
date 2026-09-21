// Shared hidden-evaluator machinery. Evaluators receive the completed repository, never modify it, read through an
// instrumented reader (explicit read bytes are exact; subprocess-internal reads stay unknown), and emit checks of
// the shape { id, dimension, status, critical, evidence }.
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listFiles, runCommand, runManifestCommand } from '../harness/fixtures.mjs';
import { exact, unknownMeasurement } from '../harness/measurements.mjs';

export const DIMENSIONS = Object.freeze(['transformation', 'behavior', 'scope']);

/** An exception raised by the repository under evaluation (load failure, thrown call): a patch failure, not ours. */
export class EvaluatedCodeError extends Error {
  constructor(message, cause) { super(message, { cause }); this.name = 'EvaluatedCodeError'; }
}

/** Guards a binding that an earlier `load` should have provided; its absence is the patch's failure, not ours. */
export const loaded = (value, name) => { if (value === null || value === undefined) throw new EvaluatedCodeError(`${name} is unavailable because its module did not load or export it`); return value; };

export class InstrumentedReader {
  constructor(root) { this.root = root; this.reads = []; }
  async read(file) { const text = await readFile(path.join(this.root, ...file.split('/')), 'utf8'); this.reads.push({ file, bytes: Buffer.byteLength(text, 'utf8') }); return text; }
  /** Imports a module from the completed repository with a cache-busting query so reruns see current bytes. */
  async load(file) {
    await this.read(file);
    try { return await import(`${pathToFileURL(path.join(this.root, ...file.split('/'))).href}?evaluated=${Date.now()}-${this.reads.length}`); }
    catch (error) { throw new EvaluatedCodeError(`${file} failed to load: ${error.message}`, error); }
  }
  summary() { return { files: new Set(this.reads.map((entry) => entry.file)).size, bytes: this.reads.reduce((sum, entry) => sum + entry.bytes, 0), reads: [...this.reads] }; }
}

/**
 * Builds one check; `run` may be sync or async and returns `{ pass, evidence? }`. Exceptions from the evaluated
 * repository become `fail`; any other exception is an evaluator `error` and never counts against the agent.
 */
export async function check(id, dimension, critical, run) {
  if (!DIMENSIONS.includes(dimension)) throw new Error(`INVALID_DIMENSION: ${dimension}`);
  try {
    const outcome = await run();
    return { id, dimension, status: outcome.pass ? 'pass' : 'fail', critical, evidence: outcome.evidence ?? {} };
  } catch (error) {
    if (error instanceof EvaluatedCodeError) return { id, dimension, status: 'fail', critical, evidence: { loadError: error.message } };
    return { id, dimension, status: 'error', critical, evidence: { error: error.message } };
  }
}

/** Deep-equality helper returning a `{ pass, evidence }` outcome for the first mismatching or throwing case. */
export function expectCases(cases) {
  for (const entry of cases) {
    let actual;
    try { actual = JSON.stringify(entry.actual()); } catch (error) { return { pass: false, evidence: { case: entry.name, expected: entry.expected, threw: `${error.name}: ${error.message}` } }; }
    const expected = JSON.stringify(entry.expected);
    if (actual !== expected) return { pass: false, evidence: { case: entry.name, expected: entry.expected, actual: JSON.parse(actual ?? 'null') } };
  }
  return { pass: true, evidence: { cases: cases.map((entry) => entry.name) } };
}

const STATUS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', '?': 'untracked' };

/** Changed paths from `git status --porcelain -uall`, POSIX-relative and sorted. */
export async function changedFiles(root) {
  const result = await runCommand({ executable: 'git', args: ['status', '--porcelain', '-uall'] }, root);
  if (result.exitCode !== 0) throw new Error(`GIT_STATUS_FAILED: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const code = line.slice(0, 2).trim()[0] ?? 'M'; const file = line.slice(3).trim().replace(/^"(.*)"$/, '$1'); return { path: (file.includes(' -> ') ? file.split(' -> ')[1] : file).replaceAll('\\', '/'), status: STATUS[code] ?? 'modified' }; }).sort((a, b) => a.path.localeCompare(b.path));
}

/** Added plus deleted lines across tracked changes (`git diff --numstat HEAD`) plus every line of untracked files. */
export async function changedLineCount(root, changed) {
  const result = await runCommand({ executable: 'git', args: ['diff', '--numstat', 'HEAD', '--'] }, root);
  if (result.exitCode !== 0) throw new Error(`GIT_DIFF_FAILED: ${result.stderr.trim()}`);
  let lines = 0;
  for (const row of result.stdout.split(/\r?\n/).filter(Boolean)) { const [added, deleted] = row.split('\t'); lines += (Number(added) || 0) + (Number(deleted) || 0); }
  for (const entry of changed.filter((item) => item.status === 'untracked')) lines += (await readFile(path.join(root, ...entry.path.split('/')), 'utf8')).split('\n').length;
  return lines;
}

/** Files carrying `identifier` as a whole word; preserved identifiers (e.g. validateTokenFormat) never match. */
export async function filesReferencing(root, identifier, reader) {
  const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const matches = [];
  for (const file of await listFiles(root)) if (pattern.test(await reader.read(file))) matches.push(file);
  return matches;
}

/** The scope and transformation-completeness checks every task shares. */
export async function scopeChecks(root, manifest, changed, reader) {
  const changedPaths = changed.map((entry) => entry.path);
  return [
    await check('transformation.required_files_changed', 'transformation', true, () => { const missing = manifest.requiredChangedFiles.filter((file) => !changedPaths.includes(file)); return { pass: missing.length === 0, evidence: { missing } }; }),
    await check('transformation.old_reference_absent', 'transformation', true, async () => { if (manifest.scopedIdentifiers.old === manifest.scopedIdentifiers.new) return { pass: true, evidence: { note: 'identifier unchanged by design; contract change is checked behaviorally' } }; const remaining = await filesReferencing(root, manifest.scopedIdentifiers.old, reader); return { pass: remaining.length === 0, evidence: { remaining } }; }),
    await check('scope.only_allowed_files_changed', 'scope', false, () => { const unrelated = changedPaths.filter((file) => !manifest.allowedChangedFiles.includes(file)); return { pass: unrelated.length === 0, evidence: { unrelated } }; }),
    await check('scope.bounded_diff', 'scope', false, async () => { const changedLines = await changedLineCount(root, changed); return { pass: changedLines <= manifest.maxChangedLines, evidence: { changedLines, maxChangedLines: manifest.maxChangedLines } }; }),
  ];
}

/** Harness-owned verification commands from the manifest; a spawn failure is an evaluator error, not a patch result. */
export async function runHarnessVerification(root, manifest) {
  const result = { status: 'ok' };
  for (const [key, command] of [['targeted', 'targetedCommand'], ['lint', 'lintCommand'], ['build', 'buildCommand'], ['fullRegression', 'fullRegressionCommand']]) {
    try { const run = await runManifestCommand(manifest, command, root, { timeoutMs: 300_000 }); result[key] = { exitCode: run.exitCode, timedOut: run.timedOut, durationMs: run.durationMs, stdoutBytes: Buffer.byteLength(run.stdout), stderrBytes: Buffer.byteLength(run.stderr), stdoutTail: run.stdout.slice(-2_000), stderrTail: run.stderr.slice(-2_000) }; }
    catch (error) { result[key] = { error: error.message }; result.status = 'error'; }
  }
  return result;
}

export const harnessCheck = (verification) => check('behavior.harness_verification', 'behavior', true, () => { if (verification.status !== 'ok') throw new Error(`harness verification error: ${JSON.stringify(verification)}`); const failed = ['targeted', 'lint', 'build', 'fullRegression'].filter((key) => verification[key].exitCode !== 0); return { pass: failed.length === 0, evidence: { failed } }; });

/** Assembles the common result envelope every task evaluator returns. */
export async function finishEvaluation({ taskId, root, manifest, reader, checks, changed, verification }) {
  const reads = reader.summary();
  return { taskId, root, checks, changedFiles: changed, harnessVerification: verification, reads: { files: reads.files, bytes: reads.bytes, explicitReads: exact(reads.bytes, 'bytes'), subprocessReads: unknownMeasurement('bytes', 'evaluator subprocess (git, node --test, lint, build) internal reads are not observable'), detail: reads.reads }, manifest: { allowedChangedFiles: manifest.allowedChangedFiles, requiredChangedFiles: manifest.requiredChangedFiles, maxChangedLines: manifest.maxChangedLines } };
}
