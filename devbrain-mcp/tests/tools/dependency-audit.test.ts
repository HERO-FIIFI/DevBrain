import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyAudit } from '../../src/tools/dependency-audit.js';
describe('dependency audit', () => it('preserves inventory when remote checks are not run', async () => {
  const result = await dependencyAudit({ path: path.join(process.cwd(), 'fixtures/python-poetry'), limit: 20 });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result.inventoryStatus).toBe('complete'); expect(result.inventory).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'django' })]));
  expect(result.status).toBe('partial');
}, 15_000));
describe('dependency audit (uv)', () => it('reads PEP 621 inventory from a uv project', async () => {
  const result = await dependencyAudit({ path: path.join(process.cwd(), 'fixtures/python-uv'), limit: 20 });
  if ('errorCode' in result) throw new Error(String(result.message));
  expect(result.packageManagers).toEqual(['uv']);
  expect(result.inventory).toEqual([
    expect.objectContaining({ name: 'fastapi', declaredVersion: '>=0.110', dependencyType: 'production' }),
    expect.objectContaining({ name: 'uvicorn', declaredVersion: '>=0.29', dependencyType: 'production' }),
    expect.objectContaining({ name: 'pytest', declaredVersion: '>=8', dependencyType: 'development' }),
  ]);
}, 30_000));
