import { z } from 'zod';
import path from 'node:path';
import { exists, modifiedTime } from '../lib/filesystem.js';
import { git, parsePorcelainV2 } from '../lib/git.js';
import { detectStack } from '../lib/stack-detector.js';
import { failure, toolRoot } from './common.js';

export const projectHealthInput = z.object({ path: z.string().optional() });
const gitHealthSchema = z.object({
  status: z.string(), branch: z.string().optional(), detached: z.boolean().optional(), upstream: z.string().optional(),
  ahead: z.number().optional(), behind: z.number().optional(), staged: z.number().optional(), unstaged: z.number().optional(),
  untracked: z.number().optional(), uncommitted: z.number().optional(), lastCommitSha: z.string().optional(), lastCommitDate: z.string().optional(),
  reason: z.string().optional(), errorCode: z.string().optional(),
});
export const projectHealthOutput = z.object({
  status: z.enum(['complete', 'partial', 'error']), requestedPath: z.string().optional(), repositoryRoot: z.string().optional(), git: gitHealthSchema.optional(),
  hygiene: z.object({ readmePresent: z.boolean(), gitignorePresent: z.boolean(), lockfiles: z.array(z.string()) }).optional(),
  dependencyEnvironment: z.array(z.object({ ecosystem: z.string(), state: z.string(), matchVerified: z.boolean().optional() })).optional(),
  redFlags: z.array(z.string()).optional(), errorCode: z.string().optional(), message: z.string().optional(),
});

export async function projectHealth(input: z.infer<typeof projectHealthInput>) {
  try {
    const root = await toolRoot(input.path); const stack = await detectStack(root.repositoryRoot); const flags: string[] = [];
    const readme = await Promise.all(['README.md', 'README', 'README.rst'].map((f) => exists(path.join(root.repositoryRoot, f)))).then((v) => v.some(Boolean));
    const gitignore = await exists(path.join(root.repositoryRoot, '.gitignore'));
    if (!readme) flags.push('missing_readme'); if (!gitignore) flags.push('missing_gitignore');
    if (!stack.packageManagers.length && (stack.languages.includes('JavaScript') || stack.languages.includes('TypeScript') || stack.languages.includes('Python'))) flags.push('missing_lockfile');
    const jsLocks = stack.packageManagers.filter((m) => ['npm', 'pnpm', 'yarn'].includes(m)); if (jsLocks.length > 1) flags.push('multiple_lockfiles');

    let gitInfo: unknown = { status: 'unsupported', reason: 'Not a Git repository' };
    if (root.gitRepository) {
      const status = await git(root.repositoryRoot, ['status', '--porcelain=v2', '--branch']);
      const last = await git(root.repositoryRoot, ['log', '-1', '--format=%H%x00%cI']);
      if (status.status === 'completed') {
        const parsed = parsePorcelainV2(status.stdout); const total = parsed.staged + parsed.unstaged + parsed.untracked;
        if (parsed.detached) flags.push('detached_head'); if (!parsed.upstream) flags.push('no_upstream'); if (total >= 50) flags.push('large_uncommitted_change_set');
        const [sha, date] = last.status === 'completed' ? last.stdout.trim().split('\0') : [null, null];
        const known = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== null));
        gitInfo = { status: 'complete', ...known, uncommitted: total, ...(sha ? { lastCommitSha: sha } : {}), ...(date ? { lastCommitDate: date } : {}) };
      } else gitInfo = { status: 'error', errorCode: 'GIT_STATUS_FAILED' };
    }

    const environments: Array<Record<string, unknown>> = [];
    if (stack.packageManagers.some((m) => ['npm', 'pnpm', 'yarn'].includes(m))) {
      const envPath = path.join(root.repositoryRoot, 'node_modules'); const present = await exists(envPath);
      const newestLock = Math.max(0, ...(await Promise.all(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].map((f) => modifiedTime(path.join(root.repositoryRoot, f))))).filter((v): v is number => v !== undefined));
      const envTime = await modifiedTime(envPath); const state = !present ? 'missing' : envTime && newestLock > envTime ? 'possibly_stale' : 'present';
      environments.push({ ecosystem: 'node', state }); if (state !== 'present') flags.push(`dependency_environment_${state}`);
    }
    if (stack.languages.includes('Python')) {
      const present = await exists(path.join(root.repositoryRoot, '.venv')) || await exists(path.join(root.repositoryRoot, 'venv'));
      environments.push({ ecosystem: 'python', state: present ? 'present' : 'missing', matchVerified: false }); if (!present) flags.push('dependency_environment_missing');
    }
    return { status: root.gitRepository ? 'complete' : 'partial', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, git: gitInfo,
      hygiene: { readmePresent: readme, gitignorePresent: gitignore, lockfiles: stack.packageManagers }, dependencyEnvironment: environments, redFlags: [...new Set(flags)] };
  } catch (error) { return failure(error, 'PROJECT_HEALTH_FAILED'); }
}
