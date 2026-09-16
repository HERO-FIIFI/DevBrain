import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectHealth } from '../../src/tools/project-health.js';
describe('project health', () => it('reports observations without release judgment', async () => {
  const result = await projectHealth({ path: path.join(process.cwd(), 'fixtures/python-pip') });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result.status).toBe('partial'); expect(result.redFlags).toContain('missing_gitignore'); expect(JSON.stringify(result)).not.toContain('deploymentBlocked');
}), it('reports conflicting JavaScript lockfiles', async () => {
  const result = await projectHealth({ path: path.join(process.cwd(), 'fixtures/mixed-stack') });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result.redFlags).toContain('multiple_lockfiles');
}));
