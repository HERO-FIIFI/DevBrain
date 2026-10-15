import { z } from 'zod';
import { directoriesAt } from '../lib/filesystem.js';
import { detectStack } from '../lib/stack-detector.js';
import { failure, toolRoot } from './common.js';

export const repoMapInput = z.object({ path: z.string().optional() });
export const repoMapOutput = z.object({
  status: z.enum(['complete', 'partial', 'error']), requestedPath: z.string().optional(), repositoryRoot: z.string().optional(),
  languages: z.array(z.string()).optional(), packageManagers: z.array(z.string()).optional(), frameworks: z.array(z.string()).optional(),
  repositoryType: z.string().optional(), workspaces: z.array(z.string()).optional(), entryPoints: z.array(z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(), topLevelDirectories: z.array(z.string()).optional(), importantConfigFiles: z.array(z.string()).optional(),
  evidence: z.array(z.object({ kind: z.string(), source: z.string(), detail: z.string() })).optional(), truncated: z.boolean().optional(),
  errorCode: z.string().optional(), message: z.string().optional(),
});

export async function repoMap(input: z.infer<typeof repoMapInput>) {
  try {
    const root = await toolRoot(input.path); const stack = await detectStack(root.repositoryRoot);
    return { status: stack.truncated ? 'partial' as const : 'complete' as const, requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot,
      ...stack, topLevelDirectories: await directoriesAt(root.repositoryRoot) };
  } catch (error) { return failure(error, 'REPO_MAP_FAILED'); }
}
