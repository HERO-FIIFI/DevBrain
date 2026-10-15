import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvaluatedCodeError, InstrumentedReader, changedFiles, check, runHarnessVerification } from '../../benchmarks/refactor-safely/evaluators/common.mjs';
import { evaluateTaskA } from '../../benchmarks/refactor-safely/evaluators/task-a.mjs';
import { evaluateTaskB } from '../../benchmarks/refactor-safely/evaluators/task-b.mjs';
import { evaluateTaskC } from '../../benchmarks/refactor-safely/evaluators/task-c.mjs';
import { loadTask, materializeTask } from '../../benchmarks/refactor-safely/harness/fixtures.mjs';

let temp = '';
const tasks: Record<string, any> = {};
beforeAll(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-evaluators-')); for (const id of ['task-a', 'task-b', 'task-c']) tasks[id] = await loadTask(id); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

let counter = 0;
async function variant(taskId: string, edits: Record<string, (text: string) => string>) {
  const root = path.join(temp, `${taskId}-${counter += 1}`);
  await materializeTask(tasks[taskId], root);
  for (const [file, edit] of Object.entries(edits)) { const target = path.join(root, ...file.split('/')); await writeFile(target, edit(await readFile(target, 'utf8'))); }
  return root;
}
const rename = (from: RegExp, to: string) => (text: string) => text.replace(from, to);
const statuses = (result: any) => Object.fromEntries(result.checks.map((check: any) => [check.id, check.status]));
const failed = (result: any) => result.checks.filter((check: any) => check.status === 'fail').map((check: any) => check.id).sort();
const RENAME_A = /\bvalidateToken\b/g;
const A_FILES = ['src/auth/auth-service.js', 'src/http/auth-middleware.js', 'src/session/session-restorer.js', 'src/cli/inspect-token.js', 'tests/visible/auth-service.test.js'];
const correctA = Object.fromEntries(A_FILES.map((file) => [file, rename(RENAME_A, 'verifyToken')]));

describe('Task A hidden evaluator', () => {
  it('passes a correct scoped patch that leaves the allowed-but-unneeded file untouched', async () => {
    const root = await variant('task-a', correctA);
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual([]);
    expect(result.checks.every((check: any) => ['transformation', 'behavior', 'scope'].includes(check.dimension))).toBe(true);
    expect(result.checks.map((check: any) => check.id)).toContain('scope.only_allowed_files_changed');
    expect(result.changedFiles.map((entry: any) => entry.path).sort()).toEqual([...A_FILES].sort());
    expect(result.changedFiles.map((entry: any) => entry.path)).not.toContain('tests/visible/integration.test.js');
    expect(result.reads.bytes).toBeGreaterThan(0);
    expect(result.reads.subprocessReads).toEqual({ value: null, confidence: 'unknown', unknownReason: expect.stringContaining('subprocess') , unit: 'bytes', sources: [] });
    expect(result.harnessVerification).toMatchObject({ status: 'ok', targeted: { exitCode: 0 }, lint: { exitCode: 0 }, build: { exitCode: 0 }, fullRegression: { exitCode: 0 } });
  }, 120_000);
  it('fails transformation and behavior when a caller is missed', async () => {
    const root = await variant('task-a', { ...correctA, 'src/session/session-restorer.js': (text) => text });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual(expect.arrayContaining(['transformation.old_reference_absent', 'transformation.required_files_changed', 'behavior.session_restorer']));
    expect(result.checks.find((check: any) => check.id === 'behavior.session_restorer')).toMatchObject({ critical: true, dimension: 'behavior' });
    expect(statuses(result)['behavior.token_verification']).toBe('pass');
  }, 120_000);
  it('fails behavior when the rename silently changes semantics', async () => {
    const root = await variant('task-a', { ...correctA, 'src/auth/auth-service.js': (text) => text.replace(RENAME_A, 'verifyToken').replace("claims.exp <= this.now()", "claims.exp < this.now()") });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toContain('behavior.token_verification');
    expect(result.checks.find((check: any) => check.id === 'behavior.token_verification').evidence).toEqual(expect.objectContaining({ case: expect.any(String) }));
  }, 120_000);
  it('fails when validateTokenFormat is accidentally renamed even though behavior is intact', async () => {
    const naive = (text: string) => text.replaceAll('validateToken', 'verifyToken');
    const root = await variant('task-a', Object.fromEntries([...A_FILES, 'src/auth/token-format.js', 'tests/visible/integration.test.js', 'src/index.js'].map((file) => [file, naive])));
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual(expect.arrayContaining(['behavior.format_helper_unchanged', 'scope.only_allowed_files_changed']));
    expect(statuses(result)['behavior.token_verification']).toBe('pass');
  }, 120_000);
  it('marks an unrelated file change as a non-critical scope failure', async () => {
    const root = await variant('task-a', { ...correctA, 'README.md': (text) => `${text}\nEdited by the agent.\n` });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual(['scope.only_allowed_files_changed']);
    expect(result.checks.find((check: any) => check.id === 'scope.only_allowed_files_changed')).toMatchObject({ critical: false, evidence: { unrelated: ['README.md'] } });
  }, 120_000);
  it('marks formatting churn as a non-critical bounded-diff failure', async () => {
    const root = await variant('task-a', { ...correctA, 'src/session/session-restorer.js': (text) => text.replace(RENAME_A, 'verifyToken').split('\n').map((line) => (line.trim() ? `${line}  ` : line)).join('\n').replaceAll('\n', '\n\n') });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual(['scope.bounded_diff']);
    expect(result.checks.find((check: any) => check.id === 'scope.bounded_diff')).toMatchObject({ critical: false, evidence: { changedLines: expect.any(Number), maxChangedLines: tasks['task-a'].maxChangedLines } });
  }, 120_000);
  it('accepts a different implementation shape when behavior holds', async () => {
    const root = await variant('task-a', { ...correctA, 'src/auth/auth-service.js': (text) => text.replace(RENAME_A, 'verifyToken').replace('  verifyToken(token) {', '  verifyToken(token) {\n    return this.#verify(token);\n  }\n\n  #verify(token) {') });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(failed(result)).toEqual([]);
  }, 120_000);
  it('treats a patch that no longer loads as a failure, and evaluator exceptions as errors', async () => {
    const root = await variant('task-a', { ...correctA, 'src/auth/auth-service.js': () => 'export const broken = ;' });
    const result = await evaluateTaskA(root, tasks['task-a']);
    expect(result.checks.find((check: any) => check.id === 'transformation.new_method_defined')).toMatchObject({ status: 'fail', evidence: { loadError: expect.stringContaining('Unexpected token') } });
    expect(result.checks.filter((check: any) => check.status === 'error')).toEqual([]);
    expect(await check('behavior.example', 'behavior', true, () => { throw new Error('evaluator bug'); })).toEqual({ id: 'behavior.example', dimension: 'behavior', status: 'error', critical: true, evidence: { error: 'evaluator bug' } });
    expect(await check('behavior.example', 'behavior', true, () => { throw new EvaluatedCodeError('src/x.js failed to load: boom'); })).toMatchObject({ status: 'fail', evidence: { loadError: 'src/x.js failed to load: boom' } });
  }, 120_000);
});

describe('evaluator common helpers', () => {
  it('lists changed files from git status including untracked, and instruments explicit reads', async () => {
    const root = await variant('task-a', { 'README.md': (text) => `${text}x` });
    await writeFile(path.join(root, 'NEW.txt'), 'new');
    expect(await changedFiles(root)).toEqual([{ path: 'NEW.txt', status: 'untracked' }, { path: 'README.md', status: 'modified' }]);
    const reader = new InstrumentedReader(root);
    const text = await reader.read('README.md');
    expect(text.endsWith('x')).toBe(true);
    expect(reader.summary()).toEqual({ files: 1, bytes: Buffer.byteLength(text), reads: [{ file: 'README.md', bytes: Buffer.byteLength(text) }] });
  }, 60_000);
  it('runs harness-owned verification and reports a spawn failure as an error status', async () => {
    const root = await variant('task-a', correctA);
    const ok = await runHarnessVerification(root, tasks['task-a']);
    expect(ok.status).toBe('ok');
    const broken = await runHarnessVerification(root, { ...tasks['task-a'], lintCommand: { executable: 'definitely-not-a-real-binary', args: [] } });
    expect(broken).toMatchObject({ status: 'error', lint: { error: expect.stringMatching(/ENOENT|SPAWN/) } });
  }, 120_000);
});

describe('Task B hidden evaluator', () => {
  const B_FILES = ['src/orders/order-service-contract.js', 'src/orders/order-service.js', 'src/http/order-route.js', 'src/cli/show-order.js', 'tests/doubles/fake-order-service.js', 'tests/visible/order-service.test.js'];
  const shapeOne = {
    'src/orders/order-service-contract.js': (t: string) => t.replace('(orderId: string) => Order | null', '(request: { orderId: string }) => Order | null'),
    'src/orders/order-service.js': (t: string) => t.replace('  getOrder(orderId) {\n    if (typeof orderId !== \'string\' || orderId.length === 0) throw new TypeError(\'orderId must be a non-empty string\');', '  getOrder(request) {\n    if (!request || typeof request !== \'object\') throw new TypeError(\'getOrder expects a request object\');\n    const { orderId } = request;\n    if (typeof orderId !== \'string\' || orderId.length === 0) throw new TypeError(\'orderId must be a non-empty string\');').replace('@param {string} orderId', '@param {{ orderId: string }} request'),
    'src/http/order-route.js': (t: string) => t.replace('service.getOrder(decodeURIComponent(match[1]))', 'service.getOrder({ orderId: decodeURIComponent(match[1]) })'),
    'src/cli/show-order.js': (t: string) => t.replace('service.getOrder(orderId)', 'service.getOrder({ orderId })'),
    'tests/doubles/fake-order-service.js': (t: string) => t.replace('  getOrder(orderId) {\n    this.calls.push(orderId);', '  getOrder({ orderId }) {\n    this.calls.push(orderId);'),
    'tests/visible/order-service.test.js': (t: string) => t.replaceAll("getOrder('o-100')", "getOrder({ orderId: 'o-100' })").replaceAll("getOrder('o-999')", "getOrder({ orderId: 'o-999' })").replaceAll("getOrder('')", "getOrder({ orderId: '' })"),
  };
  const shapeTwo = { ...shapeOne, 'src/orders/order-service.js': (t: string) => t.replace('  getOrder(orderId) {\n    if (typeof orderId !== \'string\' || orderId.length === 0) throw new TypeError(\'orderId must be a non-empty string\');', '  getOrder(request) {\n    const orderId = request?.orderId;\n    if (typeof request === \'string\' || typeof orderId !== \'string\' || orderId.length === 0) throw new TypeError(\'getOrder({ orderId }) requires a non-empty orderId\');').replace('@param {string} orderId', '@param {{ orderId: string }} request') };
  it.each([['destructuring shape', shapeOne], ['optional-chaining shape', shapeTwo]])('passes a behaviorally valid patch (%s)', async (_, edits) => {
    const root = await variant('task-b', edits);
    const result = await evaluateTaskB(root, tasks['task-b']);
    expect(failed(result)).toEqual([]);
    expect(result.changedFiles.map((entry: any) => entry.path).sort()).toEqual([...B_FILES].sort());
  }, 120_000);
  it('fails when the CLI adapter still passes a positional identifier', async () => {
    const root = await variant('task-b', { ...shapeOne, 'src/cli/show-order.js': (t: string) => t });
    const result = await evaluateTaskB(root, tasks['task-b']);
    expect(failed(result)).toEqual(expect.arrayContaining(['behavior.cli_unchanged', 'transformation.required_files_changed']));
    expect(statuses(result)['behavior.route_unchanged']).toBe('pass');
  }, 120_000);
  it('fails when positional calls are still accepted', async () => {
    const root = await variant('task-b', { ...shapeOne, 'src/orders/order-service.js': (t: string) => t.replace('  getOrder(orderId) {', '  getOrder(request) {\n    const orderId = typeof request === \'string\' ? request : request?.orderId;').replace('@param {string} orderId', '@param {{ orderId: string }} request') });
    const result = await evaluateTaskB(root, tasks['task-b']);
    expect(failed(result)).toContain('transformation.positional_rejected');
  }, 120_000);
});

describe('Task C hidden evaluator', () => {
  const RENAME_C = /\bdisplay_name\b/g;
  const C_FILES = ['db/schema.sql', 'db/seed.sql', 'src/members/member-repository.js', 'src/members/member-service.js', 'src/api/member-serializer.js', 'tests/visible/member-repository.test.js'];
  const shapeOne = Object.fromEntries(C_FILES.map((file) => [file, rename(RENAME_C, 'full_name')]));
  const shapeTwo = { ...shapeOne, 'src/members/member-repository.js': (t: string) => t.replace(RENAME_C, 'full_name').replace("const TABLE = 'members';", "const TABLE = 'members';\nconst COLUMNS = Object.freeze({ fullName: 'full_name' });").replace('displayName: row.full_name', 'displayName: row[COLUMNS.fullName]').replace('{ full_name: displayName }', '{ [COLUMNS.fullName]: displayName }') };
  it.each([['plain rename', shapeOne], ['column-map shape', shapeTwo]])('passes a behaviorally valid patch (%s)', async (_, edits) => {
    const root = await variant('task-c', edits);
    const result = await evaluateTaskC(root, tasks['task-c']);
    expect(failed(result)).toEqual([]);
    expect(result.changedFiles.map((entry: any) => entry.path).sort()).toEqual([...C_FILES].sort());
  }, 120_000);
  it('fails when the public API field leaks the storage rename', async () => {
    const root = await variant('task-c', { ...shapeOne, 'src/api/member-serializer.js': (t: string) => t.replace(RENAME_C, 'full_name').replace('displayName: row.full_name', 'fullName: row.full_name') });
    const result = await evaluateTaskC(root, tasks['task-c']);
    expect(failed(result)).toContain('behavior.public_api_unchanged');
  }, 120_000);
  it('fails when the seed still targets the old column', async () => {
    const root = await variant('task-c', { ...shapeOne, 'db/seed.sql': (t: string) => t });
    const result = await evaluateTaskC(root, tasks['task-c']);
    expect(failed(result)).toEqual(expect.arrayContaining(['transformation.old_column_absent', 'transformation.required_files_changed']));
  }, 120_000);
});
