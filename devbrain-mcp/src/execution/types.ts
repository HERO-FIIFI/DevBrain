export type Capability = 'build' | 'test' | 'targeted_test' | 'lint';
export type ExecutionStatus = 'completed' | 'timed_out' | 'execution_error';
export type ResultStatus = 'passed' | 'failed' | 'partial' | 'unknown' | 'not_applicable';

export interface RepositoryIdentity {
  repositoryRoot: string;
  repositoryId: string;
  fingerprint: string;
  initialCommit: string;
  remote?: string;
}

export interface Invocation { executable: string; args: string[]; cwd: string }
export interface ExecutionDefinition { source: string; script?: string; fingerprint: string; framework?: 'vitest' | 'jest' | 'pytest' | 'generic' }
export interface ResolvedCapability { capability: Capability; invocation: Invocation; definition: ExecutionDefinition; packageManager?: string }

export interface ApprovalRequest {
  approvalId: string;
  status: 'pending' | 'approved' | 'superseded';
  createdAt: string;
  approvedAt?: string;
  repository: RepositoryIdentity;
  capability: Capability;
  invocation: Invocation;
  definition: ExecutionDefinition;
  reason: string;
}

export interface TrustEntry {
  repository: RepositoryIdentity;
  capabilities: Partial<Record<Capability, { invocation: Invocation; definition: ExecutionDefinition; approvedAt: string; approvalId: string }>>;
}

export interface TrustRegistry { version: 1; repositories: Record<string, TrustEntry> }
