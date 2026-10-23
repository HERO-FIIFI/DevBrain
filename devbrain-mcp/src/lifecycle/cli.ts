import {readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {redact} from '../lib/redaction.js';
import {analyzeConfigCollisions,type ConfigDefinitionSource} from './config.js';
import {doctorDiagnostic,doctorExitCode,runDoctor,type DoctorDiagnosticCode} from './diagnostics.js';
import {discoverConfigFiles} from './discovery.js';
import {formatHumanReport,formatJsonReport} from './format.js';
import {discoverGitRoot} from './git-root.js';
import {activateProjectRuntime,commitProjectRuntime,discardPreparedRuntime,prepareProjectRuntime,projectRuntimeRoot,readPackageIdentity,rollbackProjectRuntime,type RuntimeInstallOptions} from './install.js';
import {probeMcp,type ProbeOptions,type ProbeResult} from './probe.js';
import {executeLifecyclePlan,planRepair,planSetup,planUninstall,type LifecyclePlan} from './service.js';
import {parseCodexConfig,readDevbrainDefinition} from './toml.js';

export interface LifecycleArgs{command:'setup'|'doctor'|'uninstall';repair:boolean;upgrade:boolean;validate:boolean;workspace?:string;config?:string;server?:string;packageSpec?:string;scope:'project'|'global';dryRun:boolean;json:boolean;yes:boolean}
export interface LifecycleIo{cwd:string;home?:string;write:(line:string)=>void;installPackage?:RuntimeInstallOptions['install'];probe?:(options:ProbeOptions)=>Promise<ProbeResult>}
const valueFlags=new Set(['--workspace','--config','--server','--package','--scope']);
const boolFlags=new Set(['--repair','--upgrade','--validate','--dry-run','--json','--yes']);

export function parseLifecycleArgs(args:string[]):LifecycleArgs{
  const command=args[0];if(!['setup','doctor','uninstall'].includes(command))throw new Error('UNKNOWN_COMMAND');
  const parsed:LifecycleArgs={command:command as LifecycleArgs['command'],repair:false,upgrade:false,validate:false,scope:'project',dryRun:false,json:false,yes:false};
  for(let index=1;index<args.length;index++){
    const flag=args[index];
    if(valueFlags.has(flag)){
      const value=args[++index];if(!value||value.startsWith('--'))throw new Error(`MISSING_OPTION_VALUE:${flag}`);
      if(flag==='--workspace')parsed.workspace=value;if(flag==='--config')parsed.config=value;if(flag==='--server')parsed.server=value;if(flag==='--package')parsed.packageSpec=value;
      if(flag==='--scope'){if(value!=='project'&&value!=='global')throw new Error('INVALID_SCOPE');parsed.scope=value;}
    }else if(boolFlags.has(flag)){
      if(flag==='--repair')parsed.repair=true;if(flag==='--upgrade')parsed.upgrade=true;if(flag==='--validate')parsed.validate=true;if(flag==='--dry-run')parsed.dryRun=true;if(flag==='--json')parsed.json=true;if(flag==='--yes')parsed.yes=true;
    }else throw new Error(`UNKNOWN_OPTION:${flag}`);
  }
  if(parsed.repair&&parsed.command!=='doctor')throw new Error('REPAIR_ONLY_VALID_WITH_DOCTOR');if((parsed.upgrade||parsed.validate)&&parsed.command!=='setup')throw new Error('UPGRADE_OR_VALIDATE_ONLY_VALID_WITH_SETUP');if(parsed.upgrade&&parsed.validate)throw new Error('UPGRADE_AND_VALIDATE_ARE_MUTUALLY_EXCLUSIVE');
  if((parsed.packageSpec||parsed.scope!=='project')&&parsed.command!=='setup')throw new Error('INSTALL_OPTION_ONLY_VALID_WITH_SETUP');
  if(parsed.packageSpec&&parsed.server)throw new Error('PACKAGE_AND_SERVER_ARE_MUTUALLY_EXCLUSIVE');
  return parsed;
}

async function text(file:string):Promise<string>{try{return await readFile(file,'utf8');}catch(error:any){if(error?.code==='ENOENT')return '';throw error;}}
function doctorFailure(code:DoctorDiagnosticCode,error:string){return {error:diagnosticText(error)??code,status:'NOT_READY',diagnostics:[doctorDiagnostic(code)]};}
function defaultServer():string{return path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','index.js');}
function printPlan(plan:LifecyclePlan,json:boolean,write:(line:string)=>void){const value=redact({kind:plan.kind,file:plan.config,reason:plan.reason,ready:plan.ready,backupLocation:plan.transaction.backupPath,current:plan.current,proposed:plan.proposed});write(json?JSON.stringify(value,null,2):`DevBrain ${plan.kind}\n\nFILE TO CHANGE\n${plan.config}\n\nREASON\n${plan.reason}\n\nBACKUP LOCATION\n${plan.transaction.backupPath??'(new file)'}\n\nCURRENT\n${value.current}\n\nPROPOSED\n${value.proposed}`);}
function validationError(error:unknown):boolean{return /NOT_GIT|INVALID_DIRECTORY|MALFORMED_TOML|CONFIG_NOT_FOUND|PLAN_NOT_READY|CONFIRMATION_REQUIRED|INVALID_SCOPE|GLOBAL_SCOPE_UNSUPPORTED|INSTALL_OPTION_ONLY_VALID|PACKAGE_AND_SERVER/.test(error instanceof Error?error.message:String(error));}
async function definitions(home:string,workspace:string,repositoryRoot:string,explicit:string):Promise<ConfigDefinitionSource[]>{const discovered=await discoverConfigFiles({home,workspace,repositoryRoot});const files=[...discovered];try{const canonical=await realpath(explicit);if(!files.some(item=>item.file.toLowerCase()===canonical.toLowerCase()))files.push({file:canonical,scope:'repository',root:repositoryRoot});}catch{/* absent explicit config is valid before setup */}const result:ConfigDefinitionSource[]=[];for(const item of files){const parsed=parseCodexConfig(await text(item.file));if(!parsed.ok)throw new Error(`MALFORMED_TOML:${item.file}`);const definition=readDevbrainDefinition(parsed);if(definition)result.push({file:item.file,scope:item.scope,definition});}return result;}

function diagnosticText(value:string|undefined):string|undefined{
  if(!value)return undefined;
  return redact(value).replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>]+/g,'[PATH]');
}
function installResult(input:{status:string;identity:{name:string;version:string};config:string;repositoryRoot:string;runtimeRoot:string;server:string;probe?:ProbeResult;reused?:boolean;configurationChanged?:boolean}){
  const probeFailure=input.probe&&!input.probe.ok?{
    failureStage:'staged_runtime_mcp_probe',
    failureCode:input.probe.reason,
    failureMessage:diagnosticText(input.probe.detail)??`Staged runtime MCP probe failed: ${input.probe.reason}.`,
    probeReason:input.probe.reason,
    ...(diagnosticText(input.probe.detail)?{probeDetail:diagnosticText(input.probe.detail)}:{}),
    probeExitCode:input.probe.exitCode,
  }:{};
  return redact({schemaVersion:1,status:input.status,packageName:input.identity.name,packageVersion:input.identity.version,installationScope:'project',installationRoot:input.runtimeRoot,serverPath:input.server,configurationPath:input.config,effectiveWorkspaceRoot:input.repositoryRoot,preflightStatus:input.probe?.ok?'PASS':input.probe?'FAIL':'PENDING',mcpHandshakeStatus:input.probe?.ok?'PASS':input.probe?'FAIL':'PENDING',toolCount:input.probe?.toolCount??null,reused:input.reused??false,configurationChanged:input.configurationChanged??input.status==='READY',restartRequired:input.status==='READY',nextAction:input.status==='READY'?'Restart Codex so it reconnects to the newly registered MCP server.':'No configuration was changed.',verifyCommand:`npx -y ${input.identity.name}@latest doctor --workspace ${JSON.stringify(input.repositoryRoot)} --json`,...probeFailure});
}

function samePath(left:string,right:string):boolean{return (process.platform==='win32'?left.toLowerCase():left).replace(/\\/g,'/')===(process.platform==='win32'?right.toLowerCase():right).replace(/\\/g,'/');}
async function targetDefinition(config:string){try{const parsed=parseCodexConfig(await text(config));if(!parsed.ok)throw new Error(`MALFORMED_TOML:${config}`);return readDevbrainDefinition(parsed);}catch(error:any){if(error?.code==='ENOENT')return undefined;throw error;}}

async function runDistributedSetup(args:LifecycleArgs,io:LifecycleIo,workspace:string,repositoryRoot:string,config:string,node:string):Promise<number>{
  if(args.scope==='global')throw new Error('GLOBAL_SCOPE_UNSUPPORTED');
  const identity=await readPackageIdentity();const runtimeRoot=projectRuntimeRoot(io.home??os.homedir(),repositoryRoot);const server=path.join(runtimeRoot,'node_modules',...identity.name.split('/'),'dist','index.js');
  if(!args.yes||args.dryRun){const status=args.dryRun?'DRY_RUN':'CONFIRMATION_REQUIRED';const result=installResult({status,identity,config,repositoryRoot,runtimeRoot,server});io.write(args.json?JSON.stringify(result,null,2):`DevBrain setup\n\nSTATUS: ${status}\nPACKAGE: ${identity.name}@${identity.version}\nINSTALLATION: ${runtimeRoot}\nCONFIGURATION: ${config}\n\n${args.dryRun?'No files were changed.':'Run again with --yes to install and configure DevBrain.'}`);return args.dryRun?0:2;}
  const current=await targetDefinition(config);const alreadyCurrent=Boolean(current?.command==='node'&&current.args.length===1&&samePath(current.args[0],server));
  if(current&&!alreadyCurrent&&!args.upgrade&&!args.validate){io.write(JSON.stringify({...installResult({status:'NOT_READY',identity,config,repositoryRoot,runtimeRoot,server,configurationChanged:false}),failureStage:'existing_project_config',failureCode:'UPGRADE_REQUIRED',nextAction:'Run setup again with --upgrade to transactionally replace the existing DevBrain project definition.'},null,args.json?2:0));return 2;}
  const prepared=await prepareProjectRuntime({home:io.home??os.homedir(),repositoryRoot,packageIdentity:identity,packageSpec:args.packageSpec??`${identity.name}@${identity.version}`,...(io.installPackage?{install:io.installPackage}:{})});
  const probe=io.probe??probeMcp;const stagedProbe=await probe({node,server:prepared.server,cwd:repositoryRoot,workspaceRoot:repositoryRoot,timeoutMs:5000});
  if(!stagedProbe.ok){await discardPreparedRuntime(prepared);io.write(JSON.stringify(installResult({status:'NOT_READY',identity,config,repositoryRoot,runtimeRoot,server,probe:stagedProbe}),null,args.json?2:0));return 2;}
  if(args.validate){await discardPreparedRuntime(prepared);io.write(JSON.stringify(installResult({status:'VALIDATED',identity,config,repositoryRoot,runtimeRoot,server,probe:stagedProbe,reused:prepared.status==='reused',configurationChanged:false}),null,args.json?2:0));return 0;}
  const active=await activateProjectRuntime(prepared);
  try{
    const finalProbe=await probe({node,server:active.server,cwd:repositoryRoot,workspaceRoot:repositoryRoot,timeoutMs:5000});
    const plan=await planSetup({config,workspace,repositoryRoot,server:active.server,node,mcpProbe:finalProbe,existingDefinitions:[]});
    const execution=await executeLifecyclePlan(plan,{authorized:true,postCheck:async()=>Boolean((await probe({node,server:active.server,cwd:repositoryRoot,workspaceRoot:repositoryRoot,timeoutMs:5000})).ok)});
    if(!['committed','unchanged'].includes(execution.status)){await rollbackProjectRuntime(active);io.write(JSON.stringify(redact({status:'NOT_READY',execution}),null,args.json?2:0));return 2;}
    await commitProjectRuntime(active);const result=installResult({status:'READY',identity,config,repositoryRoot,runtimeRoot:active.runtimeRoot,server:active.server,probe:finalProbe,reused:prepared.status==='reused'});io.write(args.json?JSON.stringify(result,null,2):`DevBrain setup complete.\nConfiguration: ${config}\nWorkspace: ${repositoryRoot}\nMCP tools: ${finalProbe.toolCount??'unknown'}\nRestart Codex, then run:\n${result.verifyCommand}`);return 0;
  }catch(error){await rollbackProjectRuntime(active);throw error;}
}

export async function runLifecycleCli(rawArgs:string[],io:LifecycleIo):Promise<number>{
  try{
    const args=parseLifecycleArgs(rawArgs);const requestedWorkspace=path.resolve(args.workspace??io.cwd);const git=await discoverGitRoot(requestedWorkspace);
     if(git.status!=='found'||!git.repositoryRoot){io.write(JSON.stringify(git.status==='not_git'?doctorFailure('NOT_GIT_REPOSITORY',git.detail):{error:diagnosticText(git.detail)??git.status,status:'NOT_READY'}));return 2;}
    const workspace=git.selectedPath;const repositoryRoot=git.repositoryRoot;const requestedConfig=path.resolve(args.config??path.join(repositoryRoot,'.codex','config.toml'));const config=await realpath(requestedConfig).catch(()=>requestedConfig);const node=process.execPath;
    if(args.command==='uninstall'){const plan=await planUninstall({config});printPlan(plan,args.json,io.write);const result=await executeLifecyclePlan(plan,{authorized:args.yes,dryRun:args.dryRun});io.write(JSON.stringify(redact(result),null,args.json?2:0));return ['committed','unchanged','dry_run'].includes(result.status)?0:2;}
    if(args.command==='setup'&&!args.server)return await runDistributedSetup(args,io,workspace,repositoryRoot,config,node);
    const existingDefinitions=await definitions(io.home??os.homedir(),workspace,repositoryRoot,config);let server=path.resolve(args.server??defaultServer());
    if(!args.server&&args.command==='doctor'){const parsed=parseCodexConfig(await text(config));const installed=readDevbrainDefinition(parsed);if(installed?.command==='node'&&installed.args.length===1)server=path.resolve(installed.args[0]);}
    const probe=(io.probe??probeMcp);const probeResult=await probe({node,server,cwd:repositoryRoot,workspaceRoot:repositoryRoot,timeoutMs:5000});
    if(args.command==='setup'){const plan=await planSetup({config,workspace,repositoryRoot,server,node,mcpProbe:probeResult,existingDefinitions});printPlan(plan,args.json,io.write);const result=await executeLifecyclePlan(plan,{authorized:args.yes,dryRun:args.dryRun});io.write(JSON.stringify(redact(result),null,args.json?2:0));return ['committed','unchanged','dry_run'].includes(result.status)?0:2;}
    const current=await text(config);const parsed=parseCodexConfig(current);if(!parsed.ok){io.write(JSON.stringify({...doctorFailure('INVALID_TOML','MALFORMED_TOML'),details:parsed.errors}));return 2;}const definition=readDevbrainDefinition(parsed);
    if(args.repair){const plan=await planRepair({config,workspace,repositoryRoot,server,node,mcpProbe:probeResult,existingDefinitions,conflictingDefinitions:analyzeConfigCollisions(existingDefinitions).kind==='conflict'});printPlan(plan,args.json,io.write);const result=await executeLifecyclePlan(plan,{authorized:args.yes,dryRun:args.dryRun});io.write(JSON.stringify(redact(result),null,args.json?2:0));return ['committed','unchanged','dry_run'].includes(result.status)?0:2;}
    const report=await runDoctor({selectedWorkspace:workspace,repositoryRoot,server,node,nodeVersion:process.versions.node,definitions:existingDefinitions.length?existingDefinitions:(definition?[{file:config,scope:'repository',definition}]:[]),tomlValid:true,unrelatedPreserved:true,mcpProbe:probeResult});io.write(args.json?formatJsonReport(report):formatHumanReport(report));return doctorExitCode(report);
  }catch(error){const message=error instanceof Error?error.message:String(error);if(rawArgs[0]==='doctor'&&/MALFORMED_TOML/.test(message)){io.write(JSON.stringify(doctorFailure('INVALID_TOML',message)));return 2;}io.write(JSON.stringify({error:message}));return validationError(error)?2:3;}
}
