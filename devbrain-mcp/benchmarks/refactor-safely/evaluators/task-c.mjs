// Hidden evaluator for Task C: rename persistence column display_name -> full_name while the public API keeps
// `displayName`. Establishes storage/mapping behavior and API stability without prescribing mapper structure.
import { InstrumentedReader, changedFiles, check, expectCases, finishEvaluation, harnessCheck, loaded, runHarnessVerification, scopeChecks } from './common.mjs';

const throws = (fn, pattern) => { try { fn(); return false; } catch (error) { return pattern.test(error.message); } };

export async function evaluateTaskC(root, manifest) {
  const reader = new InstrumentedReader(root);
  const changed = await changedFiles(root);
  const changedPaths = changed.map((entry) => entry.path);
  const verification = await runHarnessVerification(root, manifest);
  const checks = [];
  let MemoryDatabase = null, MemberRepository = null, MemberService = null, createMemberRoute = null;
  const newDatabase = () => new (loaded(MemoryDatabase, 'MemoryDatabase'))();

  checks.push(await check('transformation.schema_declares_full_name', 'transformation', true, async () => {
    ({ MemoryDatabase } = await reader.load('src/db/memory-database.js'));
    const db = newDatabase();
    return expectCases([{ name: 'members columns', actual: () => db.schema.get('members'), expected: ['id', 'full_name', 'joined_at'] }]);
  }));
  checks.push(await check('behavior.seed_rows_load', 'behavior', true, () => {
    const db = newDatabase();
    return expectCases([
      { name: 'three rows', actual: () => db.select('members').length, expected: 3 },
      { name: 'm-1 stored under full_name', actual: () => db.select('members', { id: 'm-1' }), expected: [{ id: 'm-1', full_name: 'Ada Lovelace', joined_at: '2024-01-05' }] },
    ]);
  }));
  checks.push(await check('behavior.public_api_unchanged', 'behavior', true, async () => {
    ({ createMemberRoute } = await reader.load('src/http/member-route.js'));
    const handle = loaded(createMemberRoute, 'createMemberRoute')(newDatabase());
    return expectCases([
      { name: 'GET member', actual: () => handle({ method: 'GET', url: '/members/m-1' }), expected: { status: 200, body: { id: 'm-1', displayName: 'Ada Lovelace', joinedAt: '2024-01-05' } } },
      { name: 'GET second member', actual: () => handle({ method: 'GET', url: '/members/m-2' }), expected: { status: 200, body: { id: 'm-2', displayName: 'Grace Hopper', joinedAt: '2024-02-11' } } },
      { name: 'GET unknown', actual: () => handle({ method: 'GET', url: '/members/m-404' }), expected: { status: 404, body: { error: 'member_not_found' } } },
      { name: 'DELETE rejected', actual: () => handle({ method: 'DELETE', url: '/members/m-1' }), expected: { status: 405, body: { error: 'method_not_allowed' } } },
    ]);
  }));
  checks.push(await check('behavior.repository_mapping', 'behavior', true, async () => {
    ({ MemberRepository } = await reader.load('src/members/member-repository.js'));
    ({ MemberService } = await reader.load('src/members/member-service.js'));
    const db = newDatabase(), repository = new (loaded(MemberRepository, 'MemberRepository'))(db), service = new (loaded(MemberService, 'MemberService'))(repository);
    return expectCases([
      { name: 'findById maps to displayName', actual: () => repository.findById('m-2'), expected: { id: 'm-2', displayName: 'Grace Hopper', joinedAt: '2024-02-11' } },
      { name: 'findById unknown', actual: () => repository.findById('m-404'), expected: null },
      { name: 'service exact-name lookup', actual: () => service.findByDisplayName('Ada Lovelace').map((member) => member.id), expected: ['m-1', 'm-3'] },
      { name: 'rename returns mapped member', actual: () => service.renameMember('m-2', '  Grace B. Hopper '), expected: { id: 'm-2', displayName: 'Grace B. Hopper', joinedAt: '2024-02-11' } },
      { name: 'rename persisted under full_name', actual: () => db.select('members', { id: 'm-2' }), expected: [{ id: 'm-2', full_name: 'Grace B. Hopper', joined_at: '2024-02-11' }] },
      { name: 'rename unknown member', actual: () => service.renameMember('m-404', 'Nobody'), expected: null },
      { name: 'rename rejects blank', actual: () => throws(() => service.renameMember('m-1', '  '), /non-empty/), expected: true },
    ]);
  }));
  checks.push(await check('behavior.database_engine_unchanged', 'behavior', true, () => {
    const db = newDatabase();
    return { pass: !changedPaths.includes('src/db/memory-database.js') && throws(() => db.select('members', { display_name: 'x' }), /unknown column members\.display_name/) && throws(() => db.update('members', { id: 'm-1' }, { nickname: 'x' }), /unknown column/), evidence: { engineChanged: changedPaths.includes('src/db/memory-database.js') } };
  }));
  checks.push(await check('transformation.old_column_absent', 'transformation', true, async () => {
    const remaining = [];
    for (const file of ['db/schema.sql', 'db/seed.sql', 'src/members/member-repository.js', 'src/members/member-service.js', 'src/api/member-serializer.js', 'tests/visible/member-repository.test.js', 'tests/visible/member-api.test.js', 'src/http/member-route.js']) if (/\bdisplay_name\b/.test(await reader.read(file))) remaining.push(file);
    return { pass: remaining.length === 0, evidence: { remaining } };
  }));
  // scopeChecks also runs the generic old-reference scan; both must agree.
  checks.push(...(await scopeChecks(root, manifest, changed, reader)).filter((entry) => entry.id !== 'transformation.old_reference_absent'));
  checks.push(await harnessCheck(verification));
  return finishEvaluation({ taskId: 'task-c', root, manifest, reader, checks, changed, verification });
}
