import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { executionsDirectory, readJson } from '../execution/home.js';
import { redactString } from '../lib/redaction.js';

export interface LocatedExecution { directory:string; repositoryId:string; metadata:Record<string,any>; result:Record<string,any>; stdoutPath:string; stderrPath:string }

export async function locateExecution(executionId:string):Promise<LocatedExecution>{
  if(!/^exec_[A-Za-z0-9_-]{8,200}$/.test(executionId))throw new Error('INVALID_EXECUTION_ID');
  const root=executionsDirectory(),matches:LocatedExecution[]=[];
  let repositories:string[];try{repositories=await readdir(root);}catch{throw new Error('EXECUTION_NOT_FOUND');}
  for(const repositoryId of repositories){if(!/^[A-Za-z0-9_-]+$/.test(repositoryId))continue;const directory=path.join(root,repositoryId,executionId);const metadata=await readJson<Record<string,any>|null>(path.join(directory,'metadata.json'),null),result=await readJson<Record<string,any>|null>(path.join(directory,'result.json'),null);if(metadata&&result)matches.push({directory,repositoryId,metadata,result,stdoutPath:path.join(directory,'stdout.log'),stderrPath:path.join(directory,'stderr.log')});}
  if(matches.length===0)throw new Error('EXECUTION_NOT_FOUND');if(matches.length>1)throw new Error('AMBIGUOUS_EXECUTION_ID');return matches[0];
}

export async function executionEvidence(executionId:string){
  const item=await locateExecution(executionId),[stdout,stderr]=await Promise.all([stat(item.stdoutPath),stat(item.stderrPath)]),summary=item.result.summary??{},git=item.metadata.git??{},environment=item.metadata.environment??{};
  return{executionId,repositoryId:item.repositoryId,capability:item.metadata.capability,executionStatus:item.result.executionStatus,resultStatus:item.result.resultStatus,exitCode:item.result.exitCode,startedAt:item.result.startedAt??item.metadata.startedAt,finishedAt:item.result.finishedAt,durationMs:item.result.durationMs,command:item.metadata.command,cwd:item.metadata.cwd,git:{sha:git.sha,branch:git.branch,dirty:git.dirty,dirtyFileCount:git.dirtyFileCount},environment:{platform:environment.platform,arch:environment.arch,nodeVersion:environment.nodeVersion,packageManager:environment.packageManager,packageManagerVersion:environment.packageManagerVersion},test:{framework:summary.framework,passed:summary.passed,failed:summary.failed,skipped:summary.skipped,errors:summary.errors,failingTestsTotal:summary.failingTestsTotal},parseMethod:summary.parseMethod,parseConfidence:summary.parseConfidence,log:{available:true,stdoutBytes:stdout.size,stderrBytes:stderr.size,stdoutSha256:item.result.log?.stdoutSha256,stderrSha256:item.result.log?.stderrSha256}};
}

export async function readExecutionLogs(executionId:string,maxBytes=1_000_000){const item=await locateExecution(executionId);const [stdout,stderr]=await Promise.all([readFile(item.stdoutPath),readFile(item.stderrPath)]);return{item,stdout:redactString(stdout.subarray(Math.max(0,stdout.length-maxBytes)).toString('utf8')),stderr:redactString(stderr.subarray(Math.max(0,stderr.length-maxBytes)).toString('utf8')),truncated:stdout.length>maxBytes||stderr.length>maxBytes};}
