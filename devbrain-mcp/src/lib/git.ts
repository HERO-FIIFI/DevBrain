import path from 'node:path';
import { isWithin, resolveSafePath } from './filesystem.js';
import { runProcess, type ProcessResult } from './process-runner.js';

export async function git(cwd: string, args: string[], timeoutMs = 10_000): Promise<ProcessResult> {
  return runProcess({ executable: 'git', args, cwd, timeoutMs });
}

export async function resolveRepository(candidate = process.cwd(), boundary = process.env.DEVBRAIN_WORKSPACE_ROOT ?? process.cwd()): Promise<{ requestedPath: string; repositoryRoot: string }> {
  const requestedPath = await resolveSafePath(candidate, boundary);
  const result = await git(requestedPath, ['rev-parse', '--show-toplevel']);
  if (result.status !== 'completed') throw new Error('NOT_GIT_REPOSITORY');
  const repositoryRoot = path.resolve(result.stdout.trim());
  const allowed = await resolveSafePath(boundary, boundary);
  if (!isWithin(allowed, repositoryRoot)) throw new Error('REPOSITORY_OUTSIDE_WORKSPACE');
  return { requestedPath, repositoryRoot };
}

export interface PorcelainStatus {
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

export function parsePorcelainV2(text: string): PorcelainStatus {
  const result: PorcelainStatus = { branch: null, detached: false, upstream: null, ahead: null, behind: null, staged: 0, unstaged: 0, untracked: 0 };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) { const head = line.slice(14); result.detached = head === '(detached)'; result.branch = result.detached ? null : head; }
    else if (line.startsWith('# branch.upstream ')) result.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) { const match = /\+(\d+) -(\d+)/.exec(line); if (match) { result.ahead = Number(match[1]); result.behind = Number(match[2]); } }
    else if (line.startsWith('? ')) result.untracked++;
    else if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) {
      const xy = line.split(' ')[1] ?? '..';
      if (xy[0] !== '.') result.staged++;
      if (xy[1] !== '.') result.unstaged++;
    }
  }
  return result;
}
