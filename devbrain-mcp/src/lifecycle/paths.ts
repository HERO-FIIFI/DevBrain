import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import type {CheckStatus} from './model.js';

export interface DuplicateSegment{segment:string;firstIndex:number;secondIndex:number}
export interface DirectoryInspection{
  input:string;
  normalizedPath:string;
  canonicalPath:null|string;
  status:CheckStatus;
  exists:boolean;
  isDirectory:boolean;
  reason?:'NOT_FOUND'|'NOT_DIRECTORY'|'INACCESSIBLE';
  duplicates:DuplicateSegment[];
}

function isWindowsPath(value:string):boolean{return /^[A-Za-z]:[\\/]/.test(value)||value.includes('\\');}

export function normalizeInputPath(candidate:string,base=process.cwd()):string{
  const windows=isWindowsPath(candidate)||isWindowsPath(base);
  const api=windows?path.win32:path;
  const normalized=api.isAbsolute(candidate)?api.normalize(candidate):api.resolve(base,candidate);
  return windows&&/^[a-z]:/.test(normalized)?`${normalized[0].toUpperCase()}${normalized.slice(1)}`:normalized;
}

export function duplicateSegments(candidate:string):DuplicateSegment[]{
  const pieces=candidate.replace(/\\/g,'/').split('/').filter(Boolean);
  const found:DuplicateSegment[]=[];
  for(let index=1;index<pieces.length;index++)if(pieces[index-1].localeCompare(pieces[index],undefined,{sensitivity:'accent'})===0)found.push({segment:pieces[index],firstIndex:index-1,secondIndex:index});
  return found;
}

export async function inspectDirectory(candidate:string,base=process.cwd()):Promise<DirectoryInspection>{
  const normalizedPath=normalizeInputPath(candidate,base);
  const common={input:candidate,normalizedPath,duplicates:duplicateSegments(normalizedPath)};
  try{
    const canonicalPath=await realpath(normalizedPath);const information=await stat(canonicalPath);
    if(!information.isDirectory())return {...common,canonicalPath,status:'FAIL',exists:true,isDirectory:false,reason:'NOT_DIRECTORY'};
    return {...common,canonicalPath,status:common.duplicates.length?'WARN':'PASS',exists:true,isDirectory:true};
  }catch(error:any){
    const notFound=error?.code==='ENOENT';
    return {...common,canonicalPath:null,status:'FAIL',exists:false,isDirectory:false,reason:notFound?'NOT_FOUND':'INACCESSIBLE'};
  }
}

export async function sameCanonicalPath(left:string,right:string):Promise<boolean>{
  try{
    const [a,b]=await Promise.all([realpath(normalizeInputPath(left)),realpath(normalizeInputPath(right))]);
    return process.platform==='win32'?a.localeCompare(b,undefined,{sensitivity:'accent'})===0:a===b;
  }catch{return false;}
}
