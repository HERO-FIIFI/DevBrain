#!/usr/bin/env node
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {approve,approvalPath,listApprovals,loadRegistry,revoke} from './execution/trust/store.js';
import {readJson} from './execution/home.js';
import {repositoryIdentity} from './execution/trust/repository-identity.js';
import type {ApprovalRequest,Capability} from './execution/types.js';

const usage='Usage: devbrain approve <approval-id> | trust list | trust inspect <repo> | trust revoke <repo> [capability] | approval list | approval inspect <approval-id>';
export async function main(args:string[],write:(line:string)=>void=console.log):Promise<number>{
  try{
    const [command,action,value,capability]=args;
    if(command==='approve'&&action){const request=await approve(action);write(JSON.stringify({approvalId:request.approvalId,status:request.status,repositoryId:request.repository.repositoryId,capability:request.capability}));return 0;}
    if(command==='trust'&&action==='list'){const registry=await loadRegistry();write(JSON.stringify(Object.values(registry.repositories).map((entry)=>({repositoryId:entry.repository.repositoryId,repositoryRoot:entry.repository.repositoryRoot,capabilities:Object.keys(entry.capabilities)})),null,2));return 0;}
    if(command==='trust'&&action==='inspect'&&value){const identity=await repositoryIdentity(value);write(JSON.stringify((await loadRegistry()).repositories[identity.repositoryId]??{repository:identity,capabilities:{}},null,2));return 0;}
    if(command==='trust'&&action==='revoke'&&value){const identity=await repositoryIdentity(value);write(JSON.stringify({revoked:await revoke(identity,capability as Capability|undefined),repositoryId:identity.repositoryId,...(capability?{capability}:{})}));return 0;}
    if(command==='approval'&&action==='list'){write(JSON.stringify(await listApprovals(),null,2));return 0;}
    if(command==='approval'&&action==='inspect'&&value){if(!/^apr_[0-9a-f-]+$/i.test(value))throw new Error('INVALID_APPROVAL_ID');const item=await readJson<ApprovalRequest|null>(approvalPath(value),null);if(!item)throw new Error('APPROVAL_NOT_FOUND');write(JSON.stringify(item,null,2));return 0;}
    write(usage);return 2;
  }catch(error){write(JSON.stringify({error:error instanceof Error?error.message:String(error)}));return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main(process.argv.slice(2));
