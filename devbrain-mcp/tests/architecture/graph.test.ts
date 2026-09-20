import { afterEach, describe, expect, it } from 'vitest';
import { architectureMap } from '../../src/tools/architecture-map.js';
import { dependencyGraph } from '../../src/tools/dependency-graph.js';
import { HARD_GRAPH_LIMITS } from '../../src/architecture/model.js';
import { expressPackage, fixture, type Fixture } from './fixture.js';

let current: Fixture | undefined;
afterEach(async () => { await current?.cleanup(); current = undefined; });

const layered = {
  'package.json': expressPackage,
  'src/app.ts': `import express from 'express';\nimport { usersRouter } from './routes/users';\nconst app = express();\napp.use('/api', usersRouter);\n`,
  'src/routes/users.ts': `import { Router } from 'express';\nimport { listUsers } from '../services/userService';\nimport { missing } from './missing';\nexport const usersRouter = Router();\nusersRouter.get('/users', listUsers);\n`,
  'src/services/userService.ts': `import { User } from '../models/user';\nexport function listUsers(): User[] { return []; }\n`,
  'src/models/user.ts': `export interface User { id: string }\nexport class AdminUser implements User { id = 'admin'; }\n`,
  'src/cycle/a.ts': `import { b } from './b';\nexport const a = () => b();\n`,
  'src/cycle/b.ts': `import { a } from './a';\nexport const b = () => a();\n`,
  'tests/userService.test.ts': `import { listUsers } from '../src/services/userService';\nlistUsers();\n`,
};

describe('dependency graph', () => {
  it('refreshes the model when an already-untracked source file changes', async () => {
    current = await fixture({ 'package.json': JSON.stringify({ name: 'cache-fixture' }) });
    await current.write('src/untracked/service.ts', 'export class FirstVersion {}\n');
    expect(await dependencyGraph({ path: current.repo, scope: { type: 'symbol', value: 'FirstVersion' } })).toMatchObject({ status: 'complete' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await current.write('src/untracked/service.ts', 'export class SecondVersion {}\n');
    expect(await dependencyGraph({ path: current.repo, scope: { type: 'symbol', value: 'SecondVersion' } })).toMatchObject({ status: 'complete' });
  });

  it('resolves imports into observed edges with evidence, counts unresolved imports, and links manifests to packages', async () => {
    current = await fixture(layered);
    const result = await dependencyGraph({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', repository: { dirty: false }, unresolvedImports: 1, boundary: { evidence: 'static_repository_analysis', runtime: 'not_observed' } });
    if (!('edges' in result) || !result.edges) throw new Error('missing edges');
    expect(result.edges).toContainEqual({ from: 'file:src/routes/users.ts', to: 'file:src/services/userService.ts', relationship: 'imports', evidence: { file: 'src/routes/users.ts', line: 2, method: 'import_statement' }, classification: 'observed', resolutionMethod: 'path_resolution', confidence: 'high' });
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'package:.', to: 'external:express', relationship: 'depends_on_package', classification: 'observed', confidence: 'high' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'symbol:src/models/user.ts#AdminUser', to: 'symbol:src/models/user.ts#User', relationship: 'implements', classification: 'observed', confidence: 'medium' }));
    expect(result.edges.every((edge) => ['observed', 'inferred', 'potential'].includes(edge.classification) && ['high', 'medium', 'low', 'unknown'].includes(edge.confidence) && edge.evidence.file)).toBe(true);
  });

  it('terminates on import cycles and honours depth, node, and edge limits with truncation metadata', async () => {
    current = await fixture(layered);
    const cycle = await dependencyGraph({ path: current.repo, scope: { type: 'file', value: 'src/cycle/a.ts' }, depth: 5 });
    expect(cycle).toMatchObject({ status: 'complete', truncated: false });
    expect('nodes' in cycle && cycle.nodes?.filter((node) => node.type === 'file').map((node) => node.id).sort()).toEqual(['file:src/cycle/a.ts', 'file:src/cycle/b.ts']);
    expect('edges' in cycle && cycle.edges?.filter((edge) => edge.relationship === 'imports')).toHaveLength(2);
    const shallow = await dependencyGraph({ path: current.repo, scope: { type: 'file', value: 'src/routes/users.ts' }, depth: 1 });
    expect('nodes' in shallow && shallow.nodes?.some((node) => node.id === 'file:src/services/userService.ts')).toBe(true);
    expect('nodes' in shallow && shallow.nodes?.some((node) => node.id === 'file:src/models/user.ts')).toBe(false);
    expect(shallow).toMatchObject({ status: 'partial', truncated: true, depthReached: 1 });
    const deep = await dependencyGraph({ path: current.repo, scope: { type: 'file', value: 'src/routes/users.ts' }, depth: 2 });
    expect('nodes' in deep && deep.nodes?.some((node) => node.id === 'file:src/models/user.ts')).toBe(true);
    const nodes = await dependencyGraph({ path: current.repo, maxNodes: 3 });
    expect(nodes).toMatchObject({ status: 'partial', truncated: true, returnedNodes: 3 });
    const edges = await dependencyGraph({ path: current.repo, maxEdges: 2 });
    expect(edges).toMatchObject({ status: 'partial', truncated: true, returnedEdges: 2 });
    expect(await dependencyGraph({ path: current.repo, scope: { type: 'file', value: '../outside.ts' } })).toMatchObject({ status: 'error', errorCode: 'DEPENDENCY_GRAPH_FAILED' });
    expect(HARD_GRAPH_LIMITS).toEqual({ maxNodes: 500, maxEdges: 1500, maxDepth: 5, maxFiles: 300, maxResults: 500 });
  });

  it('keeps monorepo packages distinct and records cross-package dependencies', async () => {
    current = await fixture({
      'package.json': JSON.stringify({ name: 'acme', private: true, workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@acme/auth': 'workspace:*' } }),
      'apps/web/src/login.ts': `import { AuthClient } from '@acme/auth';\nexport const LoginPage = () => new AuthClient();\n`,
      'packages/auth/package.json': JSON.stringify({ name: '@acme/auth', main: 'src/index.ts' }),
      'packages/auth/src/index.ts': `export class AuthClient {}\n`,
    });
    const result = await dependencyGraph({ path: current.repo, scope: { type: 'workspace', value: 'apps/web' } });
    if (!('nodes' in result) || !result.nodes || !result.edges) throw new Error('missing graph');
    expect(result.nodes.find((node) => node.id === 'file:apps/web/src/login.ts')).toMatchObject({ package: 'package:apps/web' });
    expect(result.nodes.find((node) => node.id === 'file:packages/auth/src/index.ts')).toMatchObject({ package: 'package:packages/auth' });
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:apps/web/src/login.ts', to: 'file:packages/auth/src/index.ts', relationship: 'imports' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'package:apps/web', to: 'package:packages/auth', relationship: 'depends_on_module', classification: 'inferred' }));
    expect(await dependencyGraph({ path: current.repo, scope: { type: 'workspace', value: 'apps/nope' } })).toMatchObject({ status: 'error' });
  });

  it('does not merge references to same-named symbols across workspaces', async () => {
    current = await fixture({
      'package.json': JSON.stringify({ name: 'acme', private: true, workspaces: ['apps/*', 'packages/*'] }),
      'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { '@acme/auth': 'workspace:*' } }),
      'apps/web/src/use.ts': `import { AuthService } from '@acme/auth';\nexport const auth = new AuthService();\n`,
      'packages/auth/package.json': JSON.stringify({ name: '@acme/auth', main: 'src/index.ts' }),
      'packages/auth/src/index.ts': `export class AuthService {}\n`,
      'packages/other/package.json': JSON.stringify({ name: '@acme/other', main: 'src/index.ts' }),
      'packages/other/src/index.ts': `export class AuthService {}\n`,
    });
    const result = await dependencyGraph({ path: current.repo, scope: { type: 'symbol', value: 'AuthService' } });
    if (!('edges' in result) || !result.edges) throw new Error('missing graph');
    expect(result).toMatchObject({ scope: { seeds: ['symbol:packages/auth/src/index.ts#AuthService', 'symbol:packages/other/src/index.ts#AuthService'] } });
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:apps/web/src/use.ts', to: 'symbol:packages/auth/src/index.ts#AuthService', relationship: 'references' }));
    expect(result.edges).not.toContainEqual(expect.objectContaining({ from: 'file:apps/web/src/use.ts', to: 'symbol:packages/other/src/index.ts#AuthService', relationship: 'references' }));
  });

  it('resolves Python relative, absolute, stdlib, declared, and undeclared imports and supports symbol scope', async () => {
    current = await fixture({
      'requirements.txt': 'fastapi==0.115.0\n',
      'main.py': `import os\nimport requests\nfrom fastapi import FastAPI\nfrom pkg import a\n`,
      'pkg/__init__.py': '',
      'pkg/a.py': `from .b import helper\nfrom . import c\n\ndef run():\n    return helper()\n`,
      'pkg/b.py': `def helper():\n    return 1\n`,
      'pkg/c.py': `VALUE = 1\n`,
    });
    const result = await dependencyGraph({ path: current.repo });
    if (!('edges' in result) || !result.edges) throw new Error('missing edges');
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:pkg/a.py', to: 'file:pkg/b.py', relationship: 'imports' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:pkg/a.py', to: 'file:pkg/c.py', relationship: 'imports' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:main.py', to: 'file:pkg/a.py', relationship: 'imports' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:main.py', to: 'external:fastapi', classification: 'observed', confidence: 'high' }));
    expect(result.edges).toContainEqual(expect.objectContaining({ from: 'file:main.py', to: 'external:requests', classification: 'inferred', confidence: 'medium' }));
    expect(result.edges.some((edge) => edge.to === 'external:os')).toBe(false);
    const symbol = await dependencyGraph({ path: current.repo, scope: { type: 'symbol', value: 'helper' } });
    expect(symbol).toMatchObject({ scope: { type: 'symbol', value: 'helper', seeds: ['symbol:pkg/b.py#helper'] } });
    expect('edges' in symbol && symbol.edges).toContainEqual(expect.objectContaining({ from: 'file:pkg/a.py', to: 'symbol:pkg/b.py#helper', relationship: 'references', classification: 'inferred', confidence: 'low', resolutionMethod: 'textual' }));
    expect(await dependencyGraph({ path: current.repo, scope: { type: 'symbol', value: 'nothing' } })).toMatchObject({ status: 'error' });
  });

  it('analyses a non-Git directory without Git provenance', async () => {
    current = await fixture({ 'a.ts': `import { b } from './b';\nexport const a = b;\n`, 'b.ts': 'export const b = 1;\n' }, { git: false });
    expect(await dependencyGraph({ path: current.repo })).toMatchObject({ status: 'complete', repository: { dirty: false, dirtyFileCount: 0 }, returnedEdges: 3 });
  });
});

describe('architecture map', () => {
  it('classifies layers from route, path, and test evidence and relates components', async () => {
    current = await fixture(layered);
    const result = await architectureMap({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', frameworks: ['express'], layering: { status: 'detected', classification: 'inferred', confidence: 'high' }, summary: { routes: 1, tables: 0 } });
    if (!('components' in result) || !result.components || !result.relationships) throw new Error('missing components');
    expect(result.components.find((component) => component.id === 'api:package:.')).toMatchObject({ type: 'api_module', files: ['src/routes/users.ts'], classification: 'observed', confidence: 'high', resolutionMethod: 'route_evidence' });
    expect(result.components.find((component) => component.id === 'service:package:.')).toMatchObject({ type: 'service_module', classification: 'inferred', confidence: 'medium' });
    expect(result.components.find((component) => component.id === 'persistence:package:.')).toMatchObject({ type: 'persistence_module', files: ['src/models/user.ts'] });
    expect(result.components.find((component) => component.id === 'entry:package:.')).toMatchObject({ type: 'entry_point', files: ['src/app.ts'], classification: 'observed', resolutionMethod: 'manifest_entry_point' });
    expect(result.components.find((component) => component.id === 'test:package:.')).toMatchObject({ type: 'test_module' });
    expect(result.components.find((component) => component.id === 'package:.')).toMatchObject({ type: 'application' });
    expect(result.relationships).toContainEqual(expect.objectContaining({ from: 'api:package:.', to: 'service:package:.', type: 'uses_service', classification: 'inferred', confidence: 'medium' }));
    expect(result.relationships).toContainEqual(expect.objectContaining({ from: 'service:package:.', to: 'test:package:.', type: 'covered_by_test', classification: 'inferred' }));
    expect(result.relationships).toContainEqual(expect.objectContaining({ from: 'package:.', to: 'external:express', type: 'depends_on_package', classification: 'observed' }));
  });

  it('reports undetermined layering and no frameworks when evidence is absent', async () => {
    current = await fixture({ 'package.json': JSON.stringify({ name: 'plain', dependencies: { lodash: '1.0.0' } }), 'src/alpha.ts': `import { beta } from './beta';\nexport const alpha = beta;\n`, 'src/beta.ts': `const app = { get() {} };\napp.get('/looks-like-a-route');\nexport const beta = 1;\n` });
    const result = await architectureMap({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', frameworks: [], layering: { status: 'undetermined', confidence: 'unknown' }, summary: { routes: 0 } });
    expect('components' in result && result.components?.every((component) => ['package', 'application', 'module', 'external_dependency'].includes(component.type))).toBe(true);
  });

  it('separates monorepo packages into their own components', async () => {
    current = await fixture({ 'package.json': JSON.stringify({ name: 'acme', workspaces: ['apps/*', 'packages/*'] }), 'apps/web/package.json': JSON.stringify({ name: 'web' }), 'apps/web/src/index.ts': `import { x } from '../../../packages/lib/src/index';\nexport const y = x;\n`, 'packages/lib/package.json': JSON.stringify({ name: 'lib' }), 'packages/lib/src/index.ts': 'export const x = 1;\n' });
    const result = await architectureMap({ path: current.repo });
    expect(result).toMatchObject({ repositoryType: 'monorepo', summary: { packages: 3 } });
    expect('relationships' in result && result.relationships).toContainEqual(expect.objectContaining({ from: 'entry:package:apps/web', to: 'entry:package:packages/lib', type: 'imports' }));
    expect('components' in result && result.components?.map((component) => component.id)).toEqual(expect.arrayContaining(['package:apps/web', 'package:packages/lib']));
  });
});
