import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {runProcess} from '../lib/process-runner.js';
import {inspectDirectory,normalizeInputPath} from './paths.js';
import type {CheckStatus} from './model.js';

export interface GitRootDiscovery{status:'found'|'invalid_directory'|'not_git'|'git_error';selectedPath:string;repositoryRoot:string|null;detail:string}
export interface WorkspaceRelation{status:CheckStatus;relation:'same'|'workspace_contains_repository'|'repository_contains_workspace'|'different';workspace:string;repositoryRoot:string}

export async function discoverGitRoot(candidate:string):Promise<GitRootDiscovery>{
  const selected=await inspectDirectory(candidate);
  if(!selected.canonicalPath)return {status:'invalid_directory',selectedPath:selected.normalizedPath,repositoryRoot:null,detail:selected.reason??'INVALID_DIRECTORY'};
  const result=await runProcess({executable:'git',args:['rev-parse','--show-toplevel'],cwd:selected.canonicalPath,timeoutMs:10_000});
  if(result.status==='completed'&&result.stdout.trim())return {status:'found',selectedPath:selected.canonicalPath,repositoryRoot:normalizeInputPath(result.stdout.trim()),detail:'Git resolved the repository root.'};
  if(result.status==='failed'){
    const nested=new Set<string>();
    try{for(const entry of (await readdir(selected.canonicalPath,{withFileTypes:true})).slice(0,100)){if(!entry.isDirectory())continue;const child=path.join(selected.canonicalPath,entry.name);const childResult=await runProcess({executable:'git',args:['rev-parse','--show-toplevel'],cwd:child,timeoutMs:3000});if(childResult.status==='completed'&&childResult.stdout.trim())nested.add(normalizeInputPath(childResult.stdout.trim()));}}catch{/* original not-git result remains authoritative */}
    if(nested.size===1)return {status:'found',selectedPath:selected.canonicalPath,repositoryRoot:[...nested][0],detail:'Git resolved one immediate nested repository.'};
    if(nested.size>1)return {status:'git_error',selectedPath:selected.canonicalPath,repositoryRoot:null,detail:'MULTIPLE_NESTED_GIT_REPOSITORIES'};
    return {status:'not_git',selectedPath:selected.canonicalPath,repositoryRoot:null,detail:result.stderr.trim()||'NOT_GIT_REPOSITORY'};
  }
  return {status:'git_error',selectedPath:selected.canonicalPath,repositoryRoot:null,detail:result.error??(result.stderr.trim()||result.status)};
}

function equal(a:string,b:string):boolean{return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;}
function contains(parent:string,child:string):boolean{const relative=path.relative(parent,child);return relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative);}
export function compareWorkspaceAndRepository(workspace:string,repositoryRoot:string):WorkspaceRelation{
  const selected=normalizeInputPath(workspace);const repository=normalizeInputPath(repositoryRoot);
  if(equal(selected,repository))return {status:'PASS',relation:'same',workspace:selected,repositoryRoot:repository};
  if(contains(selected,repository))return {status:'WARN',relation:'workspace_contains_repository',workspace:selected,repositoryRoot:repository};
  if(contains(repository,selected))return {status:'WARN',relation:'repository_contains_workspace',workspace:selected,repositoryRoot:repository};
  return {status:'FAIL',relation:'different',workspace:selected,repositoryRoot:repository};
}
