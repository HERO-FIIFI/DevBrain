import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoMap } from '../../src/tools/repo-map.js';
describe('repo map', () => it('maps a fixture with evidence', async () => {
  const result = await repoMap({ path: path.join(process.cwd(), 'fixtures/npm-react') });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result).toMatchObject({ status: 'complete', packageManagers: ['npm'], frameworks: ['React'], repositoryType: 'single-package' });
  expect(result.evidence.length).toBeGreaterThan(0);
}));
