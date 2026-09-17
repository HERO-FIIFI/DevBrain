import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { executionsDirectory, atomicJson } from './home.js';
import { git } from '../lib/git.js';
import { runProcess } from '../lib/process-runner.js';
import type { RepositoryIdentity, ResolvedCapability } from './types.js';

const hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const executionId = () => `exec_${Date.now().toString(36)}_${randomUUID()}`;

export async function gitProvenance(root: string) {
  const [sha, branch, dirty] = await Promise.all([git(root,['rev-parse','HEAD']), git(root,['symbolic-ref','--short','-q','HEAD']), git(root,['status','--porcelain=v1'])]);
  const files = dirty.status === 'completed' ? dirty.stdout.split(/\r?\n/).filter(Boolean) : [];
  return { ...(sha.status === 'completed' ? { sha: sha.stdout.trim() } : {}), ...(branch.status === 'completed' ? { branch: branch.stdout.trim() } : {}), dirty: files.length > 0, dirtyFileCount: files.length };
}

export async function environmentProvenance(resolved: ResolvedCapability) {
  let packageManagerVersion: string | undefined;
  const version = await runProcess({ executable: resolved.invocation.executable, args: ['--version'], cwd: resolved.invocation.cwd, timeoutMs: 10_000, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 });
  if (version.status === 'completed') packageManagerVersion = version.stdout.trim().slice(0, 100);
  return { platform: process.platform, arch: process.arch, nodeVersion: process.version, ...(resolved.packageManager ? { packageManager: resolved.packageManager } : {}), ...(packageManagerVersion ? { packageManagerVersion } : {}) };
}

export async function persistEvidence(repository: RepositoryIdentity, id: string, metadata: unknown, result: unknown, stdout: string, stderr: string) {
  const parent = path.join(executionsDirectory(), repository.repositoryId); await mkdir(parent,{recursive:true}); const directory = path.join(parent,id); await mkdir(directory);
  const stdoutPath=path.join(directory,'stdout.log'), stderrPath=path.join(directory,'stderr.log');
  await Promise.all([writeFile(stdoutPath,stdout,{encoding:'utf8',flag:'wx',mode:0o600}),writeFile(stderrPath,stderr,{encoding:'utf8',flag:'wx',mode:0o600})]);
  const log = { stdoutPath, stderrPath, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) };
  await atomicJson(path.join(directory,'metadata.json'),metadata); await atomicJson(path.join(directory,'result.json'),{ ...(result as object), log });
  return log;
}
