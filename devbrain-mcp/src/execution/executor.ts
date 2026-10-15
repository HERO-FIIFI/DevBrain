import { runProcess } from '../lib/process-runner.js';
import { redactString } from '../lib/redaction.js';
import { environmentProvenance, executionId, gitProvenance, persistEvidence } from './evidence.js';
import { parseResult } from './parsers.js';
import type { Capability, ExecutionStatus, RepositoryIdentity, ResolvedCapability } from './types.js';

const policy: Record<Capability,{defaultMs:number;ceilingMs:number}> = {
  lint:{defaultMs:60_000,ceilingMs:300_000},build:{defaultMs:300_000,ceilingMs:900_000},targeted_test:{defaultMs:120_000,ceilingMs:600_000},test:{defaultMs:600_000,ceilingMs:1_800_000},
};
const tail = (value: string) => { const max=8_192; return { value:redactString(value.slice(-max)),truncated:Buffer.byteLength(value)>max }; };

export async function execute(repository: RepositoryIdentity, resolved: ResolvedCapability, requestedTimeout?: number) {
  const timeoutMs=requestedTimeout??policy[resolved.capability].defaultMs; if (!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>policy[resolved.capability].ceilingMs) throw new Error('INVALID_TIMEOUT');
  const id=executionId(), startedAt=new Date().toISOString(), start=Date.now();
  const [git,environment] = await Promise.all([gitProvenance(repository.repositoryRoot),environmentProvenance(resolved)]);
  const metadata={executionId:id,capability:resolved.capability,command:{executable:resolved.invocation.executable,args:resolved.invocation.args},cwd:resolved.invocation.cwd,definition:resolved.definition,repository,startedAt,git,environment,timeoutMs};
  const executionEnvironment=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('DEVBRAIN_')));
  const processResult=await runProcess({...resolved.invocation,timeoutMs,maxStdoutBytes:10_000_000,maxStderrBytes:10_000_000,env:executionEnvironment});
  const finishedAt=new Date().toISOString(), durationMs=Date.now()-start;
  const executionStatus:ExecutionStatus=processResult.status==='timeout'?'timed_out':processResult.status==='completed'||processResult.status==='failed'?'completed':'execution_error';
  const parsed=parseResult(resolved.definition.framework,processResult.stdout,processResult.stderr,processResult.exitCode,executionStatus);
  const result={status:'complete',authorizationStatus:'authorized',executionStatus,resultStatus:parsed.resultStatus,executionId:id,startedAt,finishedAt,durationMs,...(processResult.exitCode!==null?{exitCode:processResult.exitCode}:{}),summary:parsed.summary};
  const log=await persistEvidence(repository,id,metadata,result,processResult.stdout,processResult.stderr); const out=tail(processResult.stdout),err=tail(processResult.stderr);
  return {...result,provenance:{executionId:id,command:{executable:resolved.invocation.executable,args:resolved.invocation.args},cwd:resolved.invocation.cwd,startedAt,finishedAt,durationMs,...(processResult.exitCode!==null?{exitCode:processResult.exitCode}:{}),git,environment,log:{...log,stdoutTruncatedInResponse:out.truncated,stderrTruncatedInResponse:err.truncated,captureTruncated:processResult.outputTruncated}},output:{stdoutTail:out.value,stderrTail:err.value,stdoutTruncated:out.truncated,stderrTruncated:err.truncated}};
}
