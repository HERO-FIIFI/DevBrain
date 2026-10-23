import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repositoryIdentity } from '../../src/execution/trust/repository-identity.js';
import { runProcess } from '../../src/lib/process-runner.js';
import { contextPack } from '../../src/tools/context-pack.js';
import { sessionHandoff } from '../../src/context/session-handoff.js';

let temp: string;
let repo: string;
let home: string;

async function git(...args: string[]) { return runProcess({ executable: 'git', args, cwd: repo }); }

beforeEach(async () => {
  temp = await fsTemp();
  repo = path.join(temp, 'repo');
  home = path.join(temp, 'home');
  await mkdir(repo, { recursive: true });
  const oldWorkspace = process.env.DEVBRAIN_WORKSPACE_ROOT;
  const oldHome = process.env.DEVBRAIN_HOME;
  (globalThis as { __handoffEnv?: { workspace?: string; home?: string } }).__handoffEnv = { workspace: oldWorkspace, home: oldHome };
  process.env.DEVBRAIN_WORKSPACE_ROOT = temp;
  process.env.DEVBRAIN_HOME = home;
  await writeFile(path.join(repo, 'README.md'), '# Demo\n');
  await writeFile(path.join(repo, 'src.ts'), '// TODO: finish this\nexport const value = 1;\n');
  await git('init');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('add', '.');
  await git('commit', '-m', 'initial');
});

async function fsTemp() { return (await import('node:fs/promises')).mkdtemp(path.join(os.tmpdir(), 'devbrain-handoff-')); }

afterEach(async () => {
  const saved = (globalThis as { __handoffEnv?: { workspace?: string; home?: string } }).__handoffEnv;
  if (saved?.workspace === undefined) delete process.env.DEVBRAIN_WORKSPACE_ROOT;
  else process.env.DEVBRAIN_WORKSPACE_ROOT = saved.workspace;
  if (saved?.home === undefined) delete process.env.DEVBRAIN_HOME;
  else process.env.DEVBRAIN_HOME = saved.home;
  await rm(temp, { recursive: true, force: true });
});

describe('session handoff', () => {
  it('summarizes clean repositories and outstanding work deterministically', async () => {
    const before = (await git('status', '--porcelain=v1')).stdout;
    const first = await sessionHandoff({ path: repo, mode: 'compact' });
    const second = await sessionHandoff({ path: repo, mode: 'compact' });
    const after = (await git('status', '--porcelain=v1')).stdout;
    expect(first).toMatchObject({ status: 'complete', mode: 'compact', truncated: false });
    expect(first.markdown.replace(/- Snapshot: .*\n/, '')).toBe(second.markdown.replace(/- Snapshot: .*\n/, ''));
    expect(first.markdown).toContain('## Repository');
    expect(first.markdown).toContain('Working tree: clean');
    expect(first.markdown).toContain('TODO');
    expect(first.markdown).toContain('UNKNOWN');
    expect(after).toBe(before);
  });

  it('groups staged, unstaged, and untracked changes without file contents', async () => {
    await writeFile(path.join(repo, 'README.md'), '# Changed\n');
    await git('add', 'README.md');
    await writeFile(path.join(repo, 'src.ts'), '// FIXME: inspect\nexport const value = 2;\n');
    await writeFile(path.join(repo, 'secret.txt'), 'token=supersecretvalue\n');
    const result = await sessionHandoff({ path: repo, mode: 'detailed' });
    expect(result.markdown).toMatch(/Staged:.*README\.md/s);
    expect(result.markdown).toMatch(/Unstaged:.*src\.ts/s);
    expect(result.markdown).toMatch(/Untracked:.*secret\.txt/s);
    expect(result.markdown).not.toContain('supersecretvalue');
  });

  it('preserves detached-head identity and size-budget omissions', async () => {
    const head = (await git('rev-parse', 'HEAD')).stdout.trim();
    await git('checkout', '--detach', head);
    const result = await sessionHandoff({ path: repo, mode: 'detailed', maxTokens: 20 });
    expect(result.markdown).toContain('Branch: detached HEAD');
    expect(result.truncated).toBe(true);
    expect(result.omissions.length).toBeGreaterThan(0);
    expect(result.markdown).toContain('Omissions');
  });

  it('reports failed stale verification evidence without claiming current success', async () => {
    const identity = await repositoryIdentity(repo);
    const directory = path.join(home, 'executions', identity.repositoryId, 'exec_failed_123');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'metadata.json'), JSON.stringify({ executionId: 'exec_failed_123', capability: 'test', startedAt: '2026-01-01T00:00:00Z', git: { sha: 'old-sha', dirty: false }, command: { executable: 'npm', args: ['test'] } }));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ executionId: 'exec_failed_123', executionStatus: 'completed', resultStatus: 'failed', exitCode: 1, finishedAt: '2026-01-01T00:01:00Z', summary: { parseConfidence: 'high', failed: 2 }, log: {} }));
    await writeFile(path.join(directory, 'stdout.log'), 'failed');
    await writeFile(path.join(directory, 'stderr.log'), '');
    const result = await sessionHandoff({ path: repo, mode: 'compact' });
    expect(result.markdown).toContain('FAILED');
    expect(result.markdown).toContain('STALE');
    expect(result.markdown).toContain('timestamp 2026-01-01T00:01:00Z');
    expect(result.markdown).not.toContain('tests pass');
  });

  it('reports missing Git history without failing the handoff', async () => {
    const empty = path.join(temp, 'empty');
    await mkdir(empty, { recursive: true });
    await runProcess({ executable: 'git', args: ['init'], cwd: empty });
    const result = await sessionHandoff({ path: empty, mode: 'compact' });
    expect(result.status).toBe('complete');
    expect(result.markdown).toContain('HEAD: UNKNOWN');
    expect(result.markdown).toContain('No history available');
  });

  it('integrates additively with context-pack only when requested', async () => {
    const ordinary = await contextPack({ path: repo, objective: 'value' });
    const handoff = await contextPack({ path: repo, objective: 'value', view: 'handoff', handoff: { mode: 'compact' } });
    expect(ordinary).not.toHaveProperty('handoff');
    expect(handoff).toHaveProperty('handoff.markdown');
    expect(handoff).toHaveProperty('items');
  });
});
