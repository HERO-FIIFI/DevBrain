import { z } from 'zod';
import path from 'node:path';
import { isWithin, resolveSafePath } from '../lib/filesystem.js';
import { git } from '../lib/git.js';
import { failure, toolRoot } from './common.js';

export const gitHistoryInput = z.object({ path: z.string().optional(), limit: z.number().int().min(1).max(100).default(20), since: z.string().max(100).optional(), author: z.string().max(200).optional(), historyPath: z.string().max(1000).optional() });
const commitSchema = z.object({ sha: z.string(), shortSha: z.string(), authorName: z.string(), authorEmail: z.string(), date: z.string(), message: z.string(), filesChanged: z.number().int(), insertions: z.number().int(), deletions: z.number().int() });
export const gitHistoryOutput = z.object({ status: z.enum(['complete', 'unsupported', 'error']), requestedPath: z.string().optional(), repositoryRoot: z.string().optional(), commits: z.array(commitSchema).optional(), returnedCount: z.number().int().optional(), limit: z.number().int().optional(), truncated: z.boolean().optional(), errorCode: z.string().optional(), message: z.string().optional() });

export async function gitHistory(input: z.infer<typeof gitHistoryInput>) {
  try {
    const root = await toolRoot(input.path); if (!root.gitRepository) return { status: 'unsupported', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, commits: [], returnedCount: 0, limit: input.limit, truncated: false };
    const args = ['log', `-${input.limit + 1}`, '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s', '--shortstat'];
    if (input.since) args.splice(1, 0, `--since=${input.since}`); if (input.author) args.splice(1, 0, `--author=${input.author}`);
    if (input.historyPath) {
      const scoped = await resolveSafePath(path.resolve(root.repositoryRoot, input.historyPath), root.repositoryRoot);
      if (!isWithin(root.repositoryRoot, scoped)) throw new Error('historyPath escapes repository'); args.push('--', path.relative(root.repositoryRoot, scoped));
    }
    const result = await git(root.repositoryRoot, args); if (result.status !== 'completed') return failure(new Error(result.stderr), 'GIT_HISTORY_FAILED');
    const lines = result.stdout.split(/\r?\n/); const commits: any[] = [];
    for (const line of lines) {
      if (line.includes('\x1f')) { const [sha, shortSha, authorName, authorEmail, date, message] = line.split('\x1f'); commits.push({ sha, shortSha, authorName, authorEmail, date, message, filesChanged: 0, insertions: 0, deletions: 0 }); }
      else if (commits.length) { const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(line.trim()); if (m) Object.assign(commits.at(-1), { filesChanged: Number(m[1]), insertions: Number(m[2] ?? 0), deletions: Number(m[3] ?? 0) }); }
    }
    const truncated = commits.length > input.limit; return { status: 'complete', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, commits: commits.slice(0, input.limit), returnedCount: Math.min(commits.length, input.limit), limit: input.limit, truncated };
  } catch (error) { return failure(error, 'GIT_HISTORY_FAILED'); }
}
