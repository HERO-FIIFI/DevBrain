import {createHash,randomUUID} from 'node:crypto';
import {access,mkdir,readFile,realpath,rename,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runProcess} from '../lib/process-runner.js';

export interface PackageIdentity{name:string;version:string}
export interface RuntimeInstallOptions{home:string;repositoryRoot:string;packageIdentity:PackageIdentity;packageSpec:string;install?:(stageRoot:string,packageSpec:string)=>Promise<void>}
export interface PreparedRuntime{status:'prepared'|'reused';runtimeRoot:string;stageRoot:string|null;server:string;packageIdentity:PackageIdentity}
export interface ActiveRuntime extends PreparedRuntime{backupRoot:string|null}

const markerName='devbrain-install.json';
const packagePath=(root:string,name:string)=>path.join(root,'node_modules',...name.split('/'));
async function isFile(file:string):Promise<boolean>{try{return (await stat(file)).isFile();}catch{return false;}}
function installationKey(repositoryRoot:string):string{return createHash('sha256').update(process.platform==='win32'?repositoryRoot.toLowerCase():repositoryRoot).digest('hex').slice(0,24);}
export function projectRuntimeRoot(home:string,repositoryRoot:string):string{return path.join(home,'.devbrain','installations',installationKey(repositoryRoot));}

export async function readPackageIdentity():Promise<PackageIdentity>{
  const manifest=JSON.parse(await readFile(fileURLToPath(new URL('../../package.json',import.meta.url)),'utf8'));
  if(typeof manifest.name!=='string'||typeof manifest.version!=='string')throw new Error('PACKAGE_IDENTITY_INVALID');
  return {name:manifest.name,version:manifest.version};
}

async function defaultInstall(stageRoot:string,packageSpec:string):Promise<void>{
  const npmCli=process.env.npm_execpath;
  let executable='npm',args:string[]=[];
  if(npmCli&&await isFile(npmCli)){executable=process.execPath;args=[npmCli];}
  else if(process.platform==='win32'){
    const bundled=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
    if(!await isFile(bundled))throw new Error('NPM_RUNTIME_NOT_FOUND');
    executable=process.execPath;args=[bundled];
  }
  const result=await runProcess({executable,args:[...args,'install','--prefix',stageRoot,'--omit=dev','--ignore-scripts','--no-audit','--no-fund','--save-exact',packageSpec],cwd:stageRoot,timeoutMs:180_000,maxStdoutBytes:250_000,maxStderrBytes:250_000});
  if(result.status!=='completed')throw new Error(`PACKAGE_INSTALL_FAILED:${(result.error??result.stderr.trim())||result.status}`);
}

async function validRuntime(root:string,identity:PackageIdentity):Promise<boolean>{
  try{
    const installed=JSON.parse(await readFile(path.join(packagePath(root,identity.name),'package.json'),'utf8'));
    const marker=JSON.parse(await readFile(path.join(root,markerName),'utf8'));
    return installed.name===identity.name&&installed.version===identity.version&&marker.packageName===identity.name&&marker.packageVersion===identity.version&&await isFile(path.join(packagePath(root,identity.name),'dist','index.js'));
  }catch{return false;}
}

export async function prepareProjectRuntime(options:RuntimeInstallOptions):Promise<PreparedRuntime>{
  const repositoryRoot=await realpath(options.repositoryRoot);const runtimeRoot=projectRuntimeRoot(options.home,repositoryRoot);
  if(await validRuntime(runtimeRoot,options.packageIdentity))return {status:'reused',runtimeRoot,stageRoot:null,server:path.join(packagePath(runtimeRoot,options.packageIdentity.name),'dist','index.js'),packageIdentity:options.packageIdentity};
  const parent=path.dirname(runtimeRoot);await mkdir(parent,{recursive:true});const stageRoot=`${runtimeRoot}.stage-${randomUUID()}`;await mkdir(stageRoot);
  try{
    await (options.install??defaultInstall)(stageRoot,options.packageSpec);
    const installedRoot=packagePath(stageRoot,options.packageIdentity.name);let manifest:PackageIdentity;
    try{manifest=JSON.parse(await readFile(path.join(installedRoot,'package.json'),'utf8'));}catch{throw new Error('INSTALLED_PACKAGE_INVALID');}
    const server=path.join(installedRoot,'dist','index.js');
    if(manifest.name!==options.packageIdentity.name||manifest.version!==options.packageIdentity.version||!await isFile(server))throw new Error('INSTALLED_PACKAGE_INVALID');
    await import('node:fs/promises').then(({writeFile})=>writeFile(path.join(stageRoot,markerName),JSON.stringify({schemaVersion:1,repositoryRoot,packageName:manifest.name,packageVersion:manifest.version},null,2),'utf8'));
    return {status:'prepared',runtimeRoot,stageRoot,server,packageIdentity:options.packageIdentity};
  }catch(error){await rm(stageRoot,{recursive:true,force:true});throw error;}
}

export async function activateProjectRuntime(prepared:PreparedRuntime):Promise<ActiveRuntime>{
  if(prepared.status==='reused')return {...prepared,backupRoot:null};
  if(!prepared.stageRoot)throw new Error('RUNTIME_STAGE_MISSING');
  const backupRoot=await access(prepared.runtimeRoot).then(()=>`${prepared.runtimeRoot}.backup-${randomUUID()}`).catch(()=>null);
  if(backupRoot)await rename(prepared.runtimeRoot,backupRoot);
  try{await rename(prepared.stageRoot,prepared.runtimeRoot);}catch(error){if(backupRoot)await rename(backupRoot,prepared.runtimeRoot);throw error;}
  return {...prepared,stageRoot:null,server:path.join(packagePath(prepared.runtimeRoot,prepared.packageIdentity.name),'dist','index.js'),backupRoot};
}

export async function rollbackProjectRuntime(active:ActiveRuntime):Promise<void>{
  if(active.status==='reused')return;
  await rm(active.runtimeRoot,{recursive:true,force:true});
  if(active.backupRoot)await rename(active.backupRoot,active.runtimeRoot);
}
export async function commitProjectRuntime(active:ActiveRuntime):Promise<void>{if(active.backupRoot)await rm(active.backupRoot,{recursive:true,force:true});}
export async function discardPreparedRuntime(prepared:PreparedRuntime):Promise<void>{if(prepared.stageRoot)await rm(prepared.stageRoot,{recursive:true,force:true});}
