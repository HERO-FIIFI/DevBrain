import { resolveSafePath } from '../lib/filesystem.js';
import { resolveRepository } from '../lib/git.js';
import { safeError } from '../lib/redaction.js';

export async function toolRoot(candidate?: string) {
  const requestedPath = await resolveSafePath(candidate ?? process.cwd());
  try { return { ...(await resolveRepository(requestedPath)), gitRepository: true }; }
  catch { return { requestedPath, repositoryRoot: requestedPath, gitRepository: false }; }
}

export function failure(error: unknown, code = 'TOOL_EXECUTION_FAILED') {
  return { status: 'error' as const, errorCode: code, message: safeError(error) };
}

export function summary(result: Record<string, unknown>): string {
  if (result.status === 'error') return `DevBrain failed: ${String(result.message ?? result.errorCode)}`;
  return `DevBrain completed with status ${String(result.status)}.`;
}
