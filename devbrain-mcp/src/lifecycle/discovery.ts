import {access} from 'node:fs/promises';
import path from 'node:path';
import {normalizeInputPath} from './paths.js';

export type ConfigScope='global'|'parent'|'workspace'|'repository';
export interface DiscoveredConfig{file:string;scope:ConfigScope;root:string}
export interface ConfigDiscoveryOptions{home:string;workspace:string;repositoryRoot:string}

async function exists(file:string):Promise<boolean>{try{await access(file);return true;}catch{return false;}}
function key(value:string):string{return process.platform==='win32'?value.toLowerCase():value;}

export async function discoverConfigFiles(options:ConfigDiscoveryOptions):Promise<DiscoveredConfig[]>{
  const home=normalizeInputPath(options.home);const workspace=normalizeInputPath(options.workspace);const repository=normalizeInputPath(options.repositoryRoot);
  const roots:string[]=[];let current=repository;roots.push(current);
  while(key(current)!==key(workspace)){const parent=path.dirname(current);if(parent===current||!key(repository).startsWith(`${key(workspace)}${path.sep}`))break;roots.push(parent);current=parent;}
  if(!roots.some(root=>key(root)===key(workspace)))roots.push(workspace);
  if(key(workspace).startsWith(`${key(home)}${path.sep}`)){for(let parent=path.dirname(workspace);key(parent)!==key(home)&&path.dirname(parent)!==parent;parent=path.dirname(parent))roots.push(parent);}else roots.push(path.dirname(workspace));
  const candidates:DiscoveredConfig[]=[{file:path.join(home,'.codex','config.toml'),scope:'global',root:home}];
  for(const root of roots){const normalized=normalizeInputPath(root);const scope:ConfigScope=key(normalized)===key(repository)?'repository':key(normalized)===key(workspace)?'workspace':'parent';candidates.push({file:path.join(normalized,'.codex','config.toml'),scope,root:normalized});}
  const unique=new Map<string,DiscoveredConfig>();
  for(const item of candidates){const id=key(item.file);const existing=unique.get(id);if(!existing||item.scope==='global'||item.scope==='repository'||(item.scope==='workspace'&&existing.scope==='parent'))unique.set(id,item);}
  const found:DiscoveredConfig[]=[];for(const item of unique.values())if(await exists(item.file))found.push(item);
  const rank:Record<ConfigScope,number>={global:0,parent:1,workspace:2,repository:3};
  return found.sort((a,b)=>rank[a.scope]-rank[b.scope]||a.file.localeCompare(b.file));
}
