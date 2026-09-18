import { z } from 'zod';
import { authorize } from '../execution/authorization.js';
import { discoverCapability } from '../execution/discovery.js';
import { execute } from '../execution/executor.js';
import { repositoryIdentity } from '../execution/trust/repository-identity.js';
import type { Capability } from '../execution/types.js';
import { failure, toolRoot } from './common.js';

const invocationSchema=z.object({executable:z.string(),args:z.array(z.string()),cwd:z.string().optional()});
const logSchema=z.object({stdoutPath:z.string(),stderrPath:z.string(),stdoutSha256:z.string(),stderrSha256:z.string(),stdoutTruncatedInResponse:z.boolean(),stderrTruncatedInResponse:z.boolean(),captureTruncated:z.boolean()});
const summarySchema=z.object({framework:z.string(),passed:z.number().int().optional(),failed:z.number().int().optional(),skipped:z.number().int().optional(),errors:z.number().int().optional(),failingTests:z.array(z.object({name:z.string(),message:z.string()})),failingTestsTotal:z.number().int(),failingTestsReturned:z.number().int(),failingTestsTruncated:z.boolean(),parseMethod:z.enum(['json_reporter','junit_xml','text_regex','exit_code_only','unknown']),parseConfidence:z.enum(['high','medium','low','unknown'])});
const provenanceSchema=z.object({executionId:z.string(),command:invocationSchema,cwd:z.string(),startedAt:z.string(),finishedAt:z.string(),durationMs:z.number().int(),exitCode:z.number().int().optional(),git:z.object({sha:z.string().optional(),branch:z.string().optional(),dirty:z.boolean(),dirtyFileCount:z.number().int()}),environment:z.object({platform:z.string(),arch:z.string(),nodeVersion:z.string(),packageManager:z.string().optional(),packageManagerVersion:z.string().optional()}),log:logSchema});

export const executionOutputSchema=z.object({
  status:z.enum(['complete','approval_required','unsupported','error']),authorizationStatus:z.enum(['authorized','approval_required','not_applicable']).optional(),executionStatus:z.enum(['completed','timed_out','execution_error']).optional(),resultStatus:z.enum(['passed','failed','partial','unknown','not_applicable']).optional(),
  capability:z.enum(['build','test','targeted_test','lint']).optional(),approvalId:z.string().optional(),reason:z.string().optional(),proposedInvocation:invocationSchema.optional(),definition:z.object({source:z.string(),script:z.string().optional(),fingerprint:z.string(),framework:z.enum(['vitest','jest','pytest','generic']).optional()}).optional(),
  executionId:z.string().optional(),startedAt:z.string().optional(),finishedAt:z.string().optional(),durationMs:z.number().int().optional(),exitCode:z.number().int().optional(),summary:summarySchema.optional(),provenance:provenanceSchema.optional(),output:z.object({stdoutTail:z.string(),stderrTail:z.string(),stdoutTruncated:z.boolean(),stderrTruncated:z.boolean()}).optional(),errorCode:z.string().optional(),message:z.string().optional(),
});

export async function runCapability(input:{path?:string;timeoutMs?:number;target?:string},capability:Capability) {
  try {
    const root=await toolRoot(input.path); if(!root.gitRepository) return {status:'unsupported',authorizationStatus:'not_applicable',capability,reason:'trusted_execution_requires_git_repository'};
    const identity=await repositoryIdentity(root.repositoryRoot); const resolved=await discoverCapability(root.requestedPath,capability,input.target)??(root.requestedPath===root.repositoryRoot?null:await discoverCapability(root.repositoryRoot,capability,input.target));
    if(!resolved) return {status:'unsupported',authorizationStatus:'not_applicable',capability,reason:'capability_not_detected'};
    const authorization=await authorize(identity,resolved);
    if(authorization.authorizationStatus==='approval_required') return {status:'approval_required',authorizationStatus:'approval_required',capability,approvalId:authorization.approval.approvalId,reason:authorization.approval.reason,proposedInvocation:resolved.invocation,definition:resolved.definition};
    return execute(identity,resolved,input.timeoutMs);
  } catch(error) { return failure(error,'EXECUTION_PIPELINE_FAILED'); }
}

export const executionAnnotations={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true} as const;
