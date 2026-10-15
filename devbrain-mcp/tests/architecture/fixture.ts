import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../../src/lib/process-runner.js';

export interface Fixture { repo: string; temp: string; write(file: string, content: string): Promise<void>; git(...args: string[]): Promise<void>; cleanup(): Promise<void> }

/** Temporary repository under a workspace boundary; committed once so provenance starts clean. */
export async function fixture(files: Record<string, string>, options: { git?: boolean } = {}): Promise<Fixture> {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-arch-')), repo = path.join(temp, 'repo'), previous = process.env.DEVBRAIN_WORKSPACE_ROOT;
  const write = async (file: string, content: string) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), content); };
  const git = async (...args: string[]) => { const result = await runProcess({ executable: 'git', args, cwd: repo }); if (result.status !== 'completed' || result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`); };
  await mkdir(repo, { recursive: true });
  for (const [file, content] of Object.entries(files)) await write(file, content);
  if (options.git !== false) { for (const args of [['init', '-q'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'], ['add', '.'], ['commit', '-q', '-m', 'initial']]) await git(...args); }
  process.env.DEVBRAIN_WORKSPACE_ROOT = temp;
  return { repo, temp, write, git, cleanup: async () => { if (previous === undefined) delete process.env.DEVBRAIN_WORKSPACE_ROOT; else process.env.DEVBRAIN_WORKSPACE_ROOT = previous; await rm(temp, { recursive: true, force: true }); } };
}

export const expressPackage = JSON.stringify({ name: 'shop', version: '1.0.0', main: 'src/app.ts', scripts: { start: 'node src/app.ts' }, dependencies: { express: '^4.0.0' }, devDependencies: { vitest: '^1.0.0' } });
