import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { changeImpact } from '../../src/tools/change-impact.js';
import { repositoryIdentity } from '../../src/execution/trust/repository-identity.js';
import { fixture, type Fixture } from './fixture.js';

let current: Fixture | undefined;
afterEach(async () => { await current?.cleanup(); current = undefined; });

describe('change impact risk assessment', () => {
  it('scores an isolated change as low risk with explicit arithmetic', async () => {
    current = await fixture({ 'src/isolated.ts': 'export const isolated = 1;\n' });
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/isolated.ts' } });
    if (!('riskAssessment' in result) || !result.riskAssessment) throw new Error('missing risk assessment');
    expect(result.riskAssessment).toMatchObject({ level: 'LOW', score: 10, confidence: 'HIGH', affectedFiles: { count: 1 }, dependencyReach: { knownDependents: 0 }, testEvidence: { status: 'absent' } });
    expect(result.riskAssessment.factors.reduce((sum, factor) => sum + factor.contribution, 0)).toBe(result.riskAssessment.score);
  });

  it('raises risk for shared reach, authentication, and public interfaces', async () => {
    current = await fixture({
      'src/auth.ts': 'export function authenticate(token: string) { return token; }\n',
      'src/a.ts': "import { authenticate } from './auth'; export const a = authenticate;\n",
      'src/b.ts': "import { authenticate } from './auth'; export const b = authenticate;\n",
      'src/c.ts': "import { authenticate } from './auth'; export const c = authenticate;\n",
    });
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/auth.ts' } });
    if (!('riskAssessment' in result) || !result.riskAssessment) throw new Error('missing risk assessment');
    expect(result.riskAssessment.level).toBe('MEDIUM');
    expect(result.riskAssessment.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'sensitive_authentication', contribution: 10 }),
      expect.objectContaining({ id: 'dependency_reach_shared_modules', contribution: 5 }),
    ]));
  });

  it('reports unknowns and does not fabricate diff magnitude for a file seed', async () => {
    current = await fixture({ 'src/service.ts': 'export const service = 1;\n' });
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/service.ts' } });
    if (!('riskAssessment' in result) || !result.riskAssessment) throw new Error('missing risk assessment');
    expect(result.riskAssessment.unknowns).toEqual(expect.arrayContaining([expect.stringMatching(/absence of related tests/i)]));
    expect(result.riskAssessment.factors).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'change_magnitude_lines', observed: 'not_applicable', contribution: 0 })]));
  });

  it('can reach high risk when sensitive changes combine with broad known reach', async () => {
    const files: Record<string, string> = {
      'package.json': '{"name":"risk-fixture"}\n',
      'src/auth.ts': 'export function authenticate(token: string) { return token; }\n',
      'src/service.ts': 'export const service = 1;\n',
      'db/schema.sql': 'CREATE TABLE users (id INTEGER);\n',
    };
    for (let index = 0; index < 10; index++) files[`src/consumers/c${index}.ts`] = "import { authenticate } from '../auth'; export const consumer = authenticate;\n";
    current = await fixture(files);
    await current.write('package.json', '{"name":"risk-fixture","private":true}\n');
    await current.write('src/auth.ts', 'export function authenticate(token: string) { return token.trim(); }\n');
    await current.write('db/schema.sql', 'ALTER TABLE users ADD COLUMN active BOOLEAN;\n');
    const result = await changeImpact({ path: current.repo, seed: { type: 'diff', mode: 'working_tree' } });
    if (!('riskAssessment' in result) || !result.riskAssessment) throw new Error('missing risk assessment');
    expect(result.riskAssessment.level).toBe('HIGH');
    expect(result.riskAssessment.score).toBeGreaterThanOrEqual(60);
  });

  it('keeps risk output deterministic and bounded for a database/configuration change', async () => {
    current = await fixture({ 'db/migration.sql': 'ALTER TABLE users ADD COLUMN active BOOLEAN;\n', 'package.json': '{}\n' });
    await current.write('db/migration.sql', 'ALTER TABLE users ADD COLUMN active BOOLEAN DEFAULT true;\n');
    const input = { path: current.repo, seed: { type: 'diff' as const, mode: 'working_tree' as const } };
    const first = await changeImpact(input);
    const second = await changeImpact(input);
    if (!('riskAssessment' in first) || !first.riskAssessment || !('riskAssessment' in second) || !second.riskAssessment) throw new Error('missing risk assessment');
    expect(first.riskAssessment).toEqual(second.riskAssessment);
    expect(first.riskAssessment.score).toBeGreaterThanOrEqual(0);
    expect(first.riskAssessment.score).toBeLessThanOrEqual(100);
    expect(first.riskAssessment.factors).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'sensitive_database', contribution: 8 })]));
  });

  it('propagates failed and stale execution evidence without treating it as success', async () => {
    current = await fixture({ 'src/service.ts': 'export const service = 1;\n' });
    const oldHome = process.env.DEVBRAIN_HOME;
    process.env.DEVBRAIN_HOME = path.join(current.temp, 'home');
    const identity = await repositoryIdentity(current.repo);
    const directory = path.join(process.env.DEVBRAIN_HOME, 'executions', identity.repositoryId, 'exec_failed_123');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify({ executionId: 'exec_failed_123', capability: 'test', git: { sha: 'old', dirty: false }, command: { executable: 'npm', args: ['test'] } }));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ executionId: 'exec_failed_123', executionStatus: 'completed', resultStatus: 'failed', exitCode: 1, summary: { parseConfidence: 'high', failed: 1 }, log: {} }));
    await writeFile(path.join(directory, 'stdout.log'), 'failed');
    await writeFile(path.join(directory, 'stderr.log'), '');
    const result = await changeImpact({ path: current.repo, seed: { type: 'file', value: 'src/service.ts' }, executionIds: ['exec_failed_123'] });
    if (!('riskAssessment' in result) || !result.riskAssessment) throw new Error('missing risk assessment');
    expect(result.riskAssessment.testEvidence.executions).toEqual([{ receiptId: 'exec_failed_123', result: 'FAILED', freshness: 'STALE' }]);
    expect(result.riskAssessment.factors).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'test_evidence_failed', contribution: 10 }), expect.objectContaining({ id: 'test_evidence_stale', contribution: 5 })]));
    if (oldHome === undefined) delete process.env.DEVBRAIN_HOME; else process.env.DEVBRAIN_HOME = oldHome;
  });
});
