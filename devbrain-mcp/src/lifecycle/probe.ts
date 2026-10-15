import {stat} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {runProcess} from '../lib/process-runner.js';
import {redactString,safeError} from '../lib/redaction.js';
import {inspectDirectory} from './paths.js';

export type ProbeReason='READY'|'RUNTIME_NOT_FOUND'|'SERVER_NOT_FOUND'|'INVALID_CWD'|'PROCESS_EXITED'|'TIMEOUT'|'LAUNCH_ERROR'|'MCP_READY'|'MCP_INITIALIZATION_FAILED';
export interface ProbeResult{ok:boolean;reason:ProbeReason;stdout:string;stderr:string;exitCode:number|null;toolCount?:number;detail?:string}
export interface ProbeOptions{node:string;server:string;cwd:string;workspaceRoot?:string;timeoutMs?:number;args?:string[]}
const failed=(reason:ProbeReason,detail='',stdout='',stderr='',exitCode:null|number=null):ProbeResult=>({ok:false,reason,stdout:redactString(stdout),stderr:redactString(stderr),exitCode,...(detail?{detail:redactString(detail)}:{})});

async function file(candidate:string):Promise<boolean>{try{return (await stat(candidate)).isFile();}catch{return false;}}
export async function probeNodeRuntime(node:string):Promise<ProbeResult>{if(!await file(node))return failed('RUNTIME_NOT_FOUND');const result=await runProcess({executable:node,args:['--version'],cwd:process.cwd(),timeoutMs:3000,maxStdoutBytes:1000,maxStderrBytes:1000});return result.status==='completed'?{ok:true,reason:'READY',stdout:redactString(result.stdout),stderr:redactString(result.stderr),exitCode:result.exitCode}:failed('RUNTIME_NOT_FOUND',result.error??result.status,result.stdout,result.stderr,result.exitCode);}

async function validate(options:ProbeOptions):Promise<ProbeResult|null>{if(!await file(options.node))return failed('RUNTIME_NOT_FOUND');if(!await file(options.server))return failed('SERVER_NOT_FOUND');if(!(await inspectDirectory(options.cwd)).isDirectory)return failed('INVALID_CWD');return null;}
export async function probeLaunch(options:ProbeOptions):Promise<ProbeResult>{const invalid=await validate(options);if(invalid)return invalid;const result=await runProcess({executable:options.node,args:[options.server,...(options.args??[])],cwd:options.cwd,timeoutMs:options.timeoutMs??3000,maxStdoutBytes:32_000,maxStderrBytes:32_000,env:{...process.env,...(options.workspaceRoot?{DEVBRAIN_WORKSPACE_ROOT:options.workspaceRoot}:{})}});if(result.status==='completed')return {ok:true,reason:'READY',stdout:redactString(result.stdout),stderr:redactString(result.stderr),exitCode:result.exitCode};if(result.status==='timeout')return failed('TIMEOUT','Process exceeded the bounded launch timeout.',result.stdout,result.stderr,result.exitCode);if(result.status==='failed')return failed('PROCESS_EXITED',`Process exited with code ${result.exitCode}.`,result.stdout,result.stderr,result.exitCode);return failed('LAUNCH_ERROR',result.error??result.status,result.stdout,result.stderr,result.exitCode);}

function environment(extra:Record<string,string>):Record<string,string>{return Object.fromEntries(Object.entries({...process.env,...extra}).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));}
export async function probeMcp(options:ProbeOptions):Promise<ProbeResult>{const invalid=await validate(options);if(invalid)return invalid;const transport=new StdioClientTransport({command:options.node,args:[options.server],cwd:options.cwd,env:environment({DEVBRAIN_WORKSPACE_ROOT:options.workspaceRoot??options.cwd}),stderr:'pipe'});const client=new Client({name:'devbrain-lifecycle-probe',version:'1.0.0'});let stderr='';transport.stderr?.on('data',chunk=>{if(Buffer.byteLength(stderr)<32_000)stderr+=String(chunk).slice(0,32_000-Buffer.byteLength(stderr));});let timer:NodeJS.Timeout|undefined;
  try{
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('MCP_PROBE_TIMEOUT')),options.timeoutMs??5000);});
    const tools=await Promise.race([(async()=>{await client.connect(transport);return client.listTools();})(),timeout]);
    return {ok:true,reason:'MCP_READY',stdout:'',stderr:redactString(stderr),exitCode:null,toolCount:tools.tools.length};
  }catch(error){return failed('MCP_INITIALIZATION_FAILED',safeError(error),'',stderr,null);}
  finally{if(timer)clearTimeout(timer);try{await client.close();}catch{try{await transport.close();}catch{/* already closed */}}}
}
