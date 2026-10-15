import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../src/lib/process-runner.js';
import { gitHistory } from '../../src/tools/git-history.js';

let temp = '';
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); temp = ''; });
describe('git history tool', () => it('returns bounded scoped history', async () => {
  const base = path.join(process.cwd(), '.test-tmp'); await mkdir(base, { recursive: true }); temp = await mkdtemp(path.join(base, 'history-'));
  for (const args of [['init'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'DevBrain Test']]) expect((await runProcess({ executable: 'git', args, cwd: temp })).status).toBe('completed');
  await writeFile(path.join(temp, 'one.txt'), 'one'); await runProcess({ executable: 'git', args: ['add', '.'], cwd: temp }); await runProcess({ executable: 'git', args: ['commit', '-m', 'first'], cwd: temp });
  await writeFile(path.join(temp, 'two.txt'), 'two'); await runProcess({ executable: 'git', args: ['add', '.'], cwd: temp }); await runProcess({ executable: 'git', args: ['commit', '-m', 'second'], cwd: temp });
  const result = await gitHistory({ path: temp, limit: 1, historyPath: 'one.txt' });
  expect(result.status).not.toBe('error'); if ('errorCode' in result) return;
  expect(result.status).toBe('complete'); expect(result.returnedCount).toBe(1); expect(result.commits?.[0]).toMatchObject({ message: 'first' });
}));
