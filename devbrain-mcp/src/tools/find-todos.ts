import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { walkFiles } from '../lib/filesystem.js';
import { git } from '../lib/git.js';
import { failure, toolRoot } from './common.js';

export const findTodosInput = z.object({ path: z.string().optional(), pattern: z.string().max(100).optional(), limit: z.number().int().min(1).max(500).default(100) });
const todoFindingSchema = z.object({ file: z.string(), line: z.number().int(), column: z.number().int(), tag: z.string(), context: z.string() });
export const findTodosOutput = z.object({ status: z.enum(['complete', 'partial', 'error']), requestedPath: z.string().optional(), repositoryRoot: z.string().optional(), findings: z.array(todoFindingSchema).optional(), countsByTag: z.record(z.string(), z.number().int()).optional(), totalCount: z.number().int().optional(), returnedCount: z.number().int().optional(), truncated: z.boolean().optional(), limit: z.number().int().optional(), errorCode: z.string().optional(), message: z.string().optional() });
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.java', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.kts', '.cpp', '.c', '.h', '.md', '.yaml', '.yml', '.toml']);

export async function findTodos(input: z.infer<typeof findTodosInput>) {
  try {
    const root = await toolRoot(input.path); let files: string[]; let discoveryTruncated = false;
    if (root.gitRepository) {
      const listed = await git(root.repositoryRoot, ['ls-files', '--cached', '--others', '--exclude-standard']);
      if (listed.status !== 'completed') throw new Error('Git file discovery failed'); files = listed.stdout.split(/\r?\n/).filter(Boolean);
    } else { const walked = await walkFiles(root.repositoryRoot); files = walked.files; discoveryTruncated = walked.truncated; }
    const tags = (input.pattern ? input.pattern.split(/[|,]/) : ['TODO', 'FIXME', 'HACK', 'XXX']).map((v) => v.trim()).filter(Boolean).slice(0, 20);
    if (!tags.length) throw new Error('Pattern must contain a literal marker');
    const pattern = new RegExp(`\\b(${tags.map((tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
    const findings: Array<Record<string, unknown>> = []; const countsByTag: Record<string, number> = Object.fromEntries(tags.map((tag) => [tag.toUpperCase(), 0])); let totalCount = 0;
    for (const file of files.filter((item) => sourceExtensions.has(path.extname(item).toLowerCase()))) {
      let content: string; try { content = await readFile(path.join(root.repositoryRoot, file), 'utf8'); } catch { continue; }
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        pattern.lastIndex = 0; let match: RegExpExecArray | null;
        while ((match = pattern.exec(line))) {
          const tag = match[1].toUpperCase(); countsByTag[tag] = (countsByTag[tag] ?? 0) + 1; totalCount++;
          if (findings.length < input.limit) findings.push({ file: file.replaceAll('\\', '/'), line: index + 1, column: match.index + 1, tag, context: line.trim().slice(0, 240) });
        }
      }
    }
    return { status: discoveryTruncated ? 'partial' : 'complete', requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, findings, countsByTag, totalCount, returnedCount: findings.length, truncated: discoveryTruncated || totalCount > findings.length, limit: input.limit };
  } catch (error) { return failure(error, 'TODO_SCAN_FAILED'); }
}
