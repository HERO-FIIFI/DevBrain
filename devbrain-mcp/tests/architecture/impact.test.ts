import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { changeImpact } from '../../src/tools/change-impact.js';
import { git } from '../../src/lib/git.js';
import { expressPackage, fixture, type Fixture } from './fixture.js';

let current: Fixture | undefined;
afterEach(async () => { await current?.cleanup(); current = undefined; });

const application = {
  'package.json': JSON.stringify({ ...JSON.parse(expressPackage), dependencies: { express: '^4.0.0', '@prisma/client': '5.0.0' } }),
  'prisma/schema.prisma': `datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n\nmodel User {\n  id String @id\n}\n`,
  'src/app.ts': `import express from 'express';\nimport { usersRouter } from './routes/users';\nconst app = express();\napp.use(usersRouter);\n`,
  'src/routes/users.ts': `import { Router } from 'express';\nimport { listUsers } from '../services/users';\nexport const usersRouter = Router();\nusersRouter.get('/users', listUsers);\n`,
  'src/services/users.ts': `export function listUsers() { return prisma.user.findMany(); }\n`,
  'tests/users.test.ts': `import { listUsers } from '../src/services/users';\nlistUsers();\n`,
};

describe('change impact', () => {
  it('explains direct, transitive, interface, persistence, and test impacts for a file seed', async () => {
    current = await fixture(application);
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/services/users.ts' }, depth: 3 });
    expect(result).toMatchObject({ status: 'complete', seed: { type: 'file', value: 'src/services/users.ts', resolved: true }, changed: { files: ['src/services/users.ts'] }, boundary: { runtime: 'not_observed' } });
    if (!('impacts' in result) || !result.impacts) throw new Error('missing impacts');
    const byId = (id: string) => result.impacts!.find((impact) => impact.target.id === id);
    expect(byId('file:src/routes/users.ts')).toMatchObject({ category: 'direct', relationshipPath: ['file:src/services/users.ts', 'file:src/routes/users.ts'], classification: 'potential', confidence: 'high', evidence: [{ file: 'src/routes/users.ts', line: 2, method: 'import_statement' }] });
    expect(byId('file:src/app.ts')).toMatchObject({ category: 'transitive', relationshipPath: ['file:src/services/users.ts', 'file:src/routes/users.ts', 'file:src/app.ts'], classification: 'potential', confidence: 'medium' });
    expect(byId('route:GET /users')).toMatchObject({ category: 'interface', relationshipPath: ['file:src/services/users.ts', 'file:src/routes/users.ts', 'route:GET /users'], classification: 'potential', confidence: 'high' });
    expect(byId('table:User')).toMatchObject({ category: 'persistence', relationshipPath: ['file:src/services/users.ts', 'table:User'], classification: 'potential', confidence: 'medium' });
    expect(byId('file:tests/users.test.ts')).toMatchObject({ target: { type: 'test' }, category: 'test', relationship: 'covered_by_test', classification: 'potential', confidence: 'medium' });
    expect(result.impacts.every((impact) => impact.evidence.length > 0 && impact.relationshipPath.length > 1)).toBe(true);
  });

  it('returns an honest empty result for an unresolved symbol seed', async () => {
    current = await fixture(application);
    expect(await changeImpact({ path: current.repo, seed: { type: 'symbol', value: 'MissingService' } })).toMatchObject({ status: 'complete', seed: { resolved: false }, changed: { files: [], symbols: [] }, impacts: [], confidence: 'unknown', message: expect.stringContaining('no impact is claimed') });
  });

  it('resolves a symbol seed to its defining file and symbol evidence', async () => {
    current = await fixture(application);
    const result = await changeImpact({ path: current.repo, seed: { type: 'symbol', value: 'listUsers' } });
    expect(result).toMatchObject({ seed: { type: 'symbol', value: 'listUsers', resolved: true }, changed: { files: ['src/services/users.ts'], symbols: [{ file: 'src/services/users.ts', symbol: 'listUsers', line: 1 }] } });
    expect('impacts' in result && result.impacts).toEqual(expect.arrayContaining([expect.objectContaining({ target: expect.objectContaining({ id: 'route:GET /users' }), category: 'interface', classification: 'potential' })]));
  });

  it('does not report truncation when the requested depth reaches a leaf', async () => {
    current = await fixture({
      'src/service.ts': 'export const service = 1;\n',
      'src/leaf.ts': `import { service } from './service';\nexport const leaf = service;\n`,
    });
    expect(await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/service.ts' }, depth: 1 })).toMatchObject({ status: 'complete', depthReached: 1, totalCandidates: 1, truncated: false });
  });

  it('seeds impact from the working-tree diff with exact dirty provenance', async () => {
    current = await fixture(application);
    await current.write('src/services/users.ts', `export function listUsers() { return prisma.user.findMany({ where: { active: true } }); }\n`);
    const result = await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'working_tree' } });
    expect(result).toMatchObject({
      status: 'complete',
      repository: { dirty: true, dirtyFileCount: 1 },
      seed: { type: 'diff', mode: 'working_tree', resolved: true },
      changed: { files: ['src/services/users.ts'], symbols: [{ file: 'src/services/users.ts', symbol: 'listUsers', line: 1 }] },
    });
    expect('impacts' in result && result.impacts).toEqual(expect.arrayContaining([expect.objectContaining({ target: { type: 'route', id: 'route:GET /users', name: 'GET /users', file: 'src/routes/users.ts' }, category: 'interface', classification: 'potential' })]));
  });

  it('supports staged, commit, and range diff seeds', async () => {
    current = await fixture(application);
    const before = (await git(current.repo, ['rev-parse', 'HEAD'])).stdout.trim();
    await current.write('src/services/users.ts', `export function listUsers() { return prisma.user.findMany({ take: 10 }); }\n`);
    await current.git('add', 'src/services/users.ts');
    expect(await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'staged' } })).toMatchObject({ repository: { dirty: true }, seed: { resolved: true }, changed: { files: ['src/services/users.ts'] } });
    await current.git('commit', '-q', '-m', 'change users');
    const after = (await git(current.repo, ['rev-parse', 'HEAD'])).stdout.trim();
    expect(await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'commit', commit: after } })).toMatchObject({ repository: { sha: after, dirty: false }, seed: { resolved: true }, changed: { files: ['src/services/users.ts'] } });
    expect(await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'range', from: before, to: after } })).toMatchObject({ repository: { sha: after, dirty: false }, seed: { resolved: true }, changed: { files: ['src/services/users.ts'] } });
  });

  it('keeps renamed and deleted paths as Git evidence without reading absent content', async () => {
    current = await fixture({ 'src/old.ts': 'export const value = 1;\n' });
    await current.git('mv', 'src/old.ts', 'src/new.ts');
    expect(await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'staged' } })).toMatchObject({ status: 'complete', repository: { dirty: true }, seed: { resolved: true }, changed: { files: ['src/new.ts'] } });
    await current.cleanup();
    current = await fixture({ 'src/deleted.ts': 'export const removed = 1;\n' });
    await rm(`${current.repo}/src/deleted.ts`);
    expect(await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'working_tree' } })).toMatchObject({ status: 'complete', repository: { dirty: true }, seed: { resolved: true }, changed: { files: ['src/deleted.ts'] }, impacts: [] });
  });

  it('bounds cyclic impact traversal and result counts', async () => {
    current = await fixture({
      'src/a.ts': `import { b } from './b';\nexport const a = () => b();\n`,
      'src/b.ts': `import { a } from './a';\nexport const b = () => a();\n`,
      'src/c.ts': `import { a } from './a';\nexport const c = a;\n`,
    });
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/a.ts' }, depth: 5, maxResults: 1 });
    expect(result).toMatchObject({ status: 'partial', totalCandidates: 2, truncated: true, impacts: [expect.any(Object)] });
    expect('impacts' in result && result.impacts).toHaveLength(1);
  });
});
