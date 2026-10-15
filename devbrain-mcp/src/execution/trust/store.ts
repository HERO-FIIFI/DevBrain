import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { approvalsDirectory, atomicJson, ensureDevbrainHome, readJson, trustRegistryPath } from '../home.js';
import type { ApprovalRequest, Capability, RepositoryIdentity, ResolvedCapability, TrustRegistry } from '../types.js';

const emptyRegistry = (): TrustRegistry => ({ version: 1, repositories: {} });
export const approvalPath = (id: string) => path.join(approvalsDirectory(), `${id}.json`);
export async function loadRegistry(): Promise<TrustRegistry> { await ensureDevbrainHome(); return readJson(trustRegistryPath(), emptyRegistry()); }
export async function saveRegistry(registry: TrustRegistry): Promise<void> { await ensureDevbrainHome(); await atomicJson(trustRegistryPath(), registry); }

export async function createApproval(repository: RepositoryIdentity, resolved: ResolvedCapability, reason: string): Promise<ApprovalRequest> {
  await ensureDevbrainHome();
  for (const file of await readdir(approvalsDirectory())) {
    if (!file.endsWith('.json')) continue;
    const existing = await readJson<ApprovalRequest | null>(path.join(approvalsDirectory(), file), null);
    if (existing?.status === 'pending' && existing.repository.fingerprint === repository.fingerprint && existing.capability === resolved.capability && existing.definition.fingerprint === resolved.definition.fingerprint && JSON.stringify(existing.invocation) === JSON.stringify(resolved.invocation)) return existing;
  }
  const request: ApprovalRequest = { approvalId: `apr_${randomUUID()}`, status: 'pending', createdAt: new Date().toISOString(), repository, capability: resolved.capability, invocation: resolved.invocation, definition: resolved.definition, reason };
  await atomicJson(approvalPath(request.approvalId), request); return request;
}

export async function approve(approvalId: string): Promise<ApprovalRequest> {
  if (!/^apr_[0-9a-f-]+$/i.test(approvalId)) throw new Error('INVALID_APPROVAL_ID');
  const request = await readJson<ApprovalRequest | null>(approvalPath(approvalId), null);
  if (!request || request.status !== 'pending') throw new Error('APPROVAL_NOT_PENDING');
  const registry = await loadRegistry(); const existing = registry.repositories[request.repository.repositoryId];
  registry.repositories[request.repository.repositoryId] = { repository: request.repository, capabilities: { ...(existing?.capabilities ?? {}), [request.capability]: { invocation: request.invocation, definition: request.definition, approvedAt: new Date().toISOString(), approvalId } } };
  request.status = 'approved'; request.approvedAt = new Date().toISOString();
  await saveRegistry(registry); await atomicJson(approvalPath(approvalId), request); return request;
}

export async function revoke(repository: RepositoryIdentity, capability?: Capability): Promise<boolean> {
  const registry = await loadRegistry(); const entry = registry.repositories[repository.repositoryId]; if (!entry) return false;
  if (capability) delete entry.capabilities[capability]; else delete registry.repositories[repository.repositoryId];
  await saveRegistry(registry); return true;
}

export async function listApprovals(): Promise<ApprovalRequest[]> {
  await ensureDevbrainHome(); const result: ApprovalRequest[] = [];
  for (const file of await readdir(approvalsDirectory())) if (file.endsWith('.json')) { const item = await readJson<ApprovalRequest | null>(path.join(approvalsDirectory(), file), null); if (item) result.push(item); }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
