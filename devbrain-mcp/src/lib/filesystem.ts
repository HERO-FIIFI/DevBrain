import { access, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.venv', 'venv',
  '__pycache__', '.pytest_cache', 'vendor',
]);

export class PathBoundaryError extends Error {
  readonly code = 'PATH_OUTSIDE_WORKSPACE';
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function canonicalPath(candidate: string): Promise<string> {
  return realpath(path.resolve(candidate));
}

export async function resolveSafePath(candidate = process.cwd(), boundary = process.env.DEVBRAIN_WORKSPACE_ROOT ?? process.cwd()): Promise<string> {
  const [resolved, allowed] = await Promise.all([canonicalPath(candidate), canonicalPath(boundary)]);
  if (!isWithin(allowed, resolved)) throw new PathBoundaryError(`Path is outside permitted workspace: ${candidate}`);
  return resolved;
}

export async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

export async function directoriesAt(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export async function walkFiles(root: string, maxFiles = 20_000): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue = [''];
  while (queue.length && files.length < maxFiles) {
    const relativeDirectory = queue.shift()!;
    const entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
    for (const entry of entries) {
      const relative = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) queue.push(relative);
      else if (entry.isFile()) files.push(relative);
      if (files.length >= maxFiles) break;
    }
  }
  return { files, truncated: queue.length > 0 };
}

export async function modifiedTime(candidate: string): Promise<number | undefined> {
  try { return (await stat(candidate)).mtimeMs; } catch { return undefined; }
}
