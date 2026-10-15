import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalRepositoryHash, listFiles, loadTask, materializeTask, runManifestCommand, scopedReferenceFiles } from '../../benchmarks/refactor-safely/harness/fixtures.mjs';

let temp = '';
beforeAll(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-fixtures-')); });
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

const loadModule = (root: string, file: string) => import(pathToFileURL(path.join(root, file)).href);

describe('deterministic materialization', () => {
  it('materializes Task A identically twice', async () => {
    const task = await loadTask('task-a');
    const first = await materializeTask(task, path.join(temp, 'a1'));
    const second = await materializeTask(task, path.join(temp, 'a2'));
    expect(first.contentSha256).toBe(second.contentSha256);
    expect(first.repositorySha).toBe(second.repositorySha);
    expect(first.files).toEqual(second.files);
    expect(first.status).toBe('clean');
    expect(first.repositorySha).toMatch(/^[0-9a-f]{40}$/);
    expect(first.files).toEqual([...first.files].sort());
    expect(first.files.every((file: string) => !file.includes('\\') && !file.startsWith('.git/'))).toBe(true);
  }, 60_000);
  it('changes the content hash when one byte changes', async () => {
    const task = await loadTask('task-a');
    const root = path.join(temp, 'a3');
    const original = await materializeTask(task, root);
    const file = path.join(root, 'src', 'auth', 'auth-service.js');
    await writeFile(file, (await readFile(file, 'utf8')).replace('validateToken', 'validateTokem'));
    expect((await canonicalRepositoryHash(root)).contentSha256).not.toBe(original.contentSha256);
  }, 60_000);
  it('normalizes CRLF fixture bytes to LF independent of the host checkout', async () => {
    const taskRoot = path.join(temp, 'synthetic-task');
    await mkdir(path.join(taskRoot, 'repository', 'src'), { recursive: true });
    await writeFile(path.join(taskRoot, 'repository', 'src', 'a.js'), 'export const a = 1;\r\nexport const b = 2;\r\n');
    await writeFile(path.join(taskRoot, 'manifest.json'), JSON.stringify({ taskId: 'synthetic', visiblePrompt: 'x', allowedChangedFiles: ['src/a.js'], requiredChangedFiles: [], targetedCommand: { executable: 'node', args: ['--check', 'src/a.js'] }, lintCommand: { executable: 'node', args: ['--check', 'src/a.js'] }, buildCommand: { executable: 'node', args: ['--check', 'src/a.js'] }, fullRegressionCommand: { executable: 'node', args: ['--check', 'src/a.js'] } }));
    const task = await loadTask(taskRoot);
    const snapshot = await materializeTask(task, path.join(temp, 'synthetic-out'));
    expect(await readFile(path.join(temp, 'synthetic-out', 'src', 'a.js'), 'utf8')).toBe('export const a = 1;\nexport const b = 2;\n');
    expect(snapshot.files).toEqual(['src/a.js']);
  }, 60_000);
  it('refuses to materialize into a non-empty destination', async () => {
    const task = await loadTask('task-a');
    const root = path.join(temp, 'occupied');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'stale.txt'), 'x');
    await expect(materializeTask(task, root)).rejects.toThrow('DESTINATION_NOT_EMPTY');
  });
  it('rejects unknown or unsafe task identifiers', async () => {
    await expect(loadTask('../secrets')).rejects.toThrow('INVALID_TASK_ID');
    await expect(loadTask('task-z')).rejects.toThrow('TASK_NOT_FOUND');
  });
});

describe('Task A baseline', () => {
  let root = '';
  let task: any;
  beforeAll(async () => { task = await loadTask('task-a'); root = path.join(temp, 'a-baseline'); await materializeTask(task, root); }, 60_000);

  it('declares scope contracts consistent with the fixture, not with any agent diff', async () => {
    expect(task.allowedChangedFiles).toEqual(['src/auth/auth-service.js', 'src/http/auth-middleware.js', 'src/session/session-restorer.js', 'src/cli/inspect-token.js', 'tests/visible/auth-service.test.js', 'tests/visible/integration.test.js']);
    expect(task.requiredChangedFiles.every((file: string) => task.allowedChangedFiles.includes(file))).toBe(true);
    // Required files are exactly the fixture files carrying the scoped old identifier; validateTokenFormat is not a match.
    expect(await scopedReferenceFiles(root, task.scopedIdentifiers.old)).toEqual([...task.requiredChangedFiles].sort());
    expect(task.requiredChangedFiles).not.toContain('tests/visible/integration.test.js');
    const files = await listFiles(root);
    for (const file of task.allowedChangedFiles) expect(files).toContain(file);
    expect(files).toContain('src/auth/token-format.js');
  });
  it('passes targeted, lint, build, and full regression commands untouched', async () => {
    for (const command of ['targetedCommand', 'lintCommand', 'buildCommand', 'fullRegressionCommand']) {
      const result = await runManifestCommand(task, command, root);
      expect(result, `${command}: ${result.stderr}`).toMatchObject({ exitCode: 0, timedOut: false });
    }
  }, 120_000);
  it('has the literal behavior the hidden evaluator will expect', async () => {
    const { AuthService } = await loadModule(root, 'src/auth/auth-service.js');
    const { validateTokenFormat } = await loadModule(root, 'src/auth/token-format.js');
    const { createAuthMiddleware } = await loadModule(root, 'src/http/auth-middleware.js');
    const { SessionRestorer } = await loadModule(root, 'src/session/session-restorer.js');
    const { inspectToken } = await loadModule(root, 'src/cli/inspect-token.js');
    const auth = new AuthService({ secret: 'test-secret', now: () => 1_000_000 });
    const good = auth.issueToken('alice', 60), expired = auth.issueToken('bob', -5), [h, p] = good.split('.');
    expect(auth.validateToken(good)).toEqual({ valid: true, subject: 'alice' });
    expect(auth.validateToken(expired)).toEqual({ valid: false, reason: 'expired' });
    expect(auth.validateToken(`${h}.${p}.AAAA`)).toEqual({ valid: false, reason: 'invalid_signature' });
    expect(auth.validateToken('not-a-token')).toEqual({ valid: false, reason: 'malformed' });
    expect(validateTokenFormat(good)).toBe(true);
    expect(validateTokenFormat('a.b')).toBe(false);
    expect(validateTokenFormat('x.y.z')).toBe(true);
    const authorize = createAuthMiddleware(auth);
    expect(authorize({ headers: { authorization: `Bearer ${good}` } })).toEqual({ status: 200, subject: 'alice' });
    expect(authorize({ headers: { authorization: `Bearer ${expired}` } })).toEqual({ status: 401, error: 'expired' });
    expect(authorize({ headers: {} })).toEqual({ status: 401, error: 'missing_token' });
    const restorer = new SessionRestorer(auth);
    expect(restorer.restore({ session: good })).toEqual({ authenticated: true, subject: 'alice' });
    expect(restorer.restore({ session: `${h}.${p}.AAAA` })).toEqual({ authenticated: false, reason: 'invalid_signature' });
    expect(restorer.restore({})).toEqual({ authenticated: false, reason: 'no_session' });
    expect(inspectToken([good], auth)).toEqual({ exitCode: 0, output: 'valid subject=alice' });
    expect(inspectToken([expired], auth)).toEqual({ exitCode: 1, output: 'invalid reason=expired' });
    expect(inspectToken(['nope'], auth)).toEqual({ exitCode: 1, output: 'format: invalid' });
    expect(inspectToken([], auth)).toEqual({ exitCode: 2, output: 'usage: inspect-token <token>' });
  });
});

describe.each([
  ['task-b', 'getOrder', ['tests/visible/order-route.test.js'], ['src/orders/order-store.js']],
  ['task-c', 'display_name', ['tests/visible/member-api.test.js'], ['src/db/memory-database.js', 'src/http/member-route.js']],
])('%s prepared baseline', (taskId, oldIdentifier, allowedButUnneeded, outsideScope) => {
  let root = '';
  let task: any;
  beforeAll(async () => { task = await loadTask(taskId); root = path.join(temp, `${taskId}-baseline`); await materializeTask(task, root); }, 60_000);

  it('materializes identically twice', async () => {
    const again = await materializeTask(task, path.join(temp, `${taskId}-again`));
    const first = await import('../../benchmarks/refactor-safely/harness/fixtures.mjs').then((m) => m.snapshotRepository(root));
    expect(again).toEqual(first);
    expect(first.status).toBe('clean');
  }, 60_000);
  it('declares scope contracts consistent with the fixture', async () => {
    expect(task.scopedIdentifiers.old).toBe(oldIdentifier);
    expect(await scopedReferenceFiles(root, oldIdentifier)).toEqual([...task.requiredChangedFiles].sort());
    for (const file of allowedButUnneeded) { expect(task.allowedChangedFiles).toContain(file); expect(task.requiredChangedFiles).not.toContain(file); }
    for (const file of outsideScope) { expect(await listFiles(root)).toContain(file); expect(task.allowedChangedFiles).not.toContain(file); }
  });
  it('passes targeted, lint, build, and full regression commands untouched', async () => {
    for (const command of ['targetedCommand', 'lintCommand', 'buildCommand', 'fullRegressionCommand']) {
      const result = await runManifestCommand(task, command, root);
      expect(result, `${command}: ${result.stderr}`).toMatchObject({ exitCode: 0, timedOut: false });
    }
  }, 120_000);
});

describe('Task B literal behavior', () => {
  it('routes and CLI produce the outputs the hidden evaluator will expect', async () => {
    const root = path.join(temp, 'task-b-baseline');
    const { OrderService } = await loadModule(root, 'src/orders/order-service.js');
    const { createOrderRoute } = await loadModule(root, 'src/http/order-route.js');
    const { showOrder } = await loadModule(root, 'src/cli/show-order.js');
    const service = new OrderService();
    expect(service.getOrder('o-100')).toEqual({ orderId: 'o-100', customerId: 'c-1', totalCents: 4200, status: 'open' });
    expect(service.getOrder('o-999')).toBeNull();
    expect(createOrderRoute(service)({ method: 'GET', url: '/orders/o-101' })).toEqual({ status: 200, body: { orderId: 'o-101', customerId: 'c-1', totalCents: 1999, status: 'shipped' } });
    expect(showOrder(['o-102'], service)).toEqual({ exitCode: 0, output: 'order o-102: customer=c-2 total=0.00 status=open' });
  });
});

describe('Task C literal behavior', () => {
  it('public API shape and storage mapping are what the hidden evaluator will expect', async () => {
    const root = path.join(temp, 'task-c-baseline');
    const { MemoryDatabase } = await loadModule(root, 'src/db/memory-database.js');
    const { createMemberRoute } = await loadModule(root, 'src/http/member-route.js');
    const { MemberRepository } = await loadModule(root, 'src/members/member-repository.js');
    const { MemberService } = await loadModule(root, 'src/members/member-service.js');
    const db = new MemoryDatabase();
    expect(db.schema.get('members')).toEqual(['id', 'display_name', 'joined_at']);
    expect(createMemberRoute(db)({ method: 'GET', url: '/members/m-1' })).toEqual({ status: 200, body: { id: 'm-1', displayName: 'Ada Lovelace', joinedAt: '2024-01-05' } });
    const service = new MemberService(new MemberRepository(db));
    expect(service.findByDisplayName('Ada Lovelace').map((m: any) => m.id)).toEqual(['m-1', 'm-3']);
    expect(service.renameMember('m-2', 'Grace B. Hopper')).toEqual({ id: 'm-2', displayName: 'Grace B. Hopper', joinedAt: '2024-02-11' });
    expect(db.select('members', { id: 'm-2' })[0].display_name).toBe('Grace B. Hopper');
  });
});
