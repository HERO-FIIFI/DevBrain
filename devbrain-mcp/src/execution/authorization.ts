import { createApproval, loadRegistry } from './trust/store.js';
import type { RepositoryIdentity, ResolvedCapability } from './types.js';

export async function authorize(repository: RepositoryIdentity, resolved: ResolvedCapability) {
  const entry = (await loadRegistry()).repositories[repository.repositoryId];
  const approved = entry?.repository.fingerprint === repository.fingerprint ? entry.capabilities[resolved.capability] : undefined;
  const matches = approved && approved.definition.fingerprint === resolved.definition.fingerprint && JSON.stringify(approved.invocation) === JSON.stringify(resolved.invocation);
  if (matches) return { authorizationStatus: 'authorized' as const };
  const reason = approved ? 'execution_definition_changed' : 'execution_definition_not_approved';
  return { authorizationStatus: 'approval_required' as const, approval: await createApproval(repository, resolved, reason) };
}
