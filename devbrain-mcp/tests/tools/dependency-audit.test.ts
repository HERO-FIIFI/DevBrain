import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyAudit } from '../../src/tools/dependency-audit.js';
describe('dependency audit', () => it('preserves inventory when remote checks are not run', async () => {
  const result = await dependencyAudit({ path: path.join(process.cwd(), 'fixtures/python-poetry'), limit: 20 });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result.inventoryStatus).toBe('complete'); expect(result.inventory).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'django' })]));
  expect(result.status).toBe('partial');
}, 15_000));
