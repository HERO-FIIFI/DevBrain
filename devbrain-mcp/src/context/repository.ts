import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IGNORED_DIRECTORIES, resolveSafePath, walkFiles } from '../lib/filesystem.js';
import { git } from '../lib/git.js';
import { redactString } from '../lib/redaction.js';
import { toolRoot } from '../tools/common.js';

const BINARY_EXTENSIONS = new Set(['.7z','.avi','.bin','.bmp','.class','.dll','.doc','.docx','.exe','.gif','.gz','.ico','.jar','.jpeg','.jpg','.lockb','.mov','.mp3','.mp4','.o','.pdf','.png','.pyc','.so','.tar','.tiff','.ttf','.wasm','.webp','.woff','.woff2','.zip']);
export const repositorySource = { type: 'repository_file' as const, trust: 'untrusted_content' as const };

export async function contextRoot(candidate?: string) {
  const root = await toolRoot(candidate);
  return { requestedPath: root.requestedPath, repositoryRoot: root.repositoryRoot, gitRepository: root.gitRepository };
}

export function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/');
}

export async function safeRepositoryFile(root: string, file: string): Promise<{ absolute: string; relative: string }> {
  if (!file || path.isAbsolute(file) || file.includes('\0')) throw new Error('INVALID_REPOSITORY_FILE');
  const absolute = await resolveSafePath(path.resolve(root, file), root);
  const relative = normalizeRelative(path.relative(root, absolute));
  if (!relative || relative.startsWith('../')) throw new Error('INVALID_REPOSITORY_FILE');
  return { absolute, relative };
}

export function isSupportedTextFile(file: string): boolean {
  return !BINARY_EXTENSIONS.has(path.extname(file).toLowerCase());
}

export async function repositoryFiles(root: string, gitRepository: boolean, ceiling = 20_000): Promise<{ files: string[]; truncated: boolean; ignoredFiles: number }> {
  if (gitRepository) {
    const result = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
    if (result.status === 'completed') {
      const all = result.stdout.split('\0').filter(Boolean).map(normalizeRelative).sort();
      const files = all.filter((file) => isSupportedTextFile(file) && !file.split('/').some((part) => IGNORED_DIRECTORIES.has(part))).slice(0, ceiling);
      return { files, truncated: all.length > ceiling, ignoredFiles: all.length - files.length };
    }
  }
  const walked = await walkFiles(root, ceiling);
  const files = walked.files.map(normalizeRelative).filter(isSupportedTextFile).sort();
  return { files, truncated: walked.truncated, ignoredFiles: walked.files.length - files.length };
}

export async function readRepositoryText(root: string, file: string, maxBytes = 1_000_000): Promise<{ relative: string; text: string; bytes: number }> {
  const target = await safeRepositoryFile(root, file);
  if (!isSupportedTextFile(target.relative)) throw new Error('BINARY_FILE_UNSUPPORTED');
  const content = await readFile(target.absolute);
  if (content.includes(0)) throw new Error('BINARY_FILE_UNSUPPORTED');
  const bytes = content.byteLength;
  return { relative: target.relative, text: content.subarray(0, maxBytes).toString('utf8'), bytes };
}

export function redactRepositoryText(value: string) {
  const text = redactString(value);
  const redactionCount = (text.match(/\[REDACTED\]/g) ?? []).length;
  return { text, redacted: text !== value, redactionCount };
}

export function globMatcher(glob?: string): (file: string) => boolean {
  if (!glob) return () => true;
  if (glob.length > 200 || glob.includes('\0') || glob.startsWith('/')) throw new Error('INVALID_FILE_GLOB');
  const pattern = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '::ALL::').replaceAll('*', '[^/]*').replaceAll('::ALL::', '.*').replaceAll('?', '.');
  const regex = new RegExp(`^${pattern}$`, 'i');
  return (file) => regex.test(file);
}

export function byteSlice(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return { value, truncated: false };
  return { value: buffer.subarray(0, maxBytes).toString('utf8'), truncated: true };
}
