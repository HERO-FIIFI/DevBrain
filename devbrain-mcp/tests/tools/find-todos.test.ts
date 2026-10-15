import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findTodos } from '../../src/tools/find-todos.js';
describe('todo scanner', () => {
  it('finds and bounds literal markers', async () => {
    const result = await findTodos({ path: path.join(process.cwd(), 'fixtures/mixed-stack'), limit: 1 });
    expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
    expect(result.totalCount).toBe(2); expect(result.returnedCount).toBe(1); expect(result.truncated).toBe(true);
  });
  it('treats pattern as literal data', async () => {
    const result = await findTodos({ path: path.join(process.cwd(), 'fixtures/mixed-stack'), pattern: 'HACK; echo unsafe', limit: 10 });
    expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
    expect(result.totalCount).toBe(0);
  });
});
