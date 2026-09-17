import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../../lib/git.js';
import type { RepositoryIdentity } from '../types.js';

export const sha256 = (value: string | Buffer) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
function safeRemote(value:string):string{try{const url=new URL(value);url.username='';url.password='';return url.toString().replace(/\/$/,'');}catch{return value.replace(/^(?:[^@/]+@)(?=[^:]+:)/,'');}}

export async function repositoryIdentity(repositoryRoot: string): Promise<RepositoryIdentity> {
  const root = await realpath(repositoryRoot);
  const top = await git(root, ['rev-parse', '--show-toplevel']);
  if (top.status !== 'completed' || path.resolve(top.stdout.trim()).toLowerCase() !== path.resolve(root).toLowerCase()) throw new Error('TRUST_REQUIRES_GIT_REPOSITORY_ROOT');
  const roots = await git(root, ['rev-list', '--max-parents=0', '--all']);
  if (roots.status !== 'completed' || !roots.stdout.trim()) throw new Error('REPOSITORY_HAS_NO_COMMIT');
  const initialCommit = roots.stdout.trim().split(/\r?\n/).sort().join(',');
  const remoteResult = await git(root, ['remote', 'get-url', 'origin']);
  const remote = remoteResult.status === 'completed' ? safeRemote(remoteResult.stdout.trim()) : undefined;
  const fingerprint = sha256([path.normalize(root).toLowerCase(), initialCommit, remote ?? 'local-only'].join('\0'));
  return { repositoryRoot: root, repositoryId: fingerprint.slice(7, 39), fingerprint, initialCommit, ...(remote ? { remote } : {}) };
}
