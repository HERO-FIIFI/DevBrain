import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {check,LIFECYCLE_CHECK_IDS} from '../../src/lifecycle/model.js';
import {duplicateSegments,inspectDirectory,normalizeInputPath,sameCanonicalPath} from '../../src/lifecycle/paths.js';

let temp='';
afterEach(async()=>{if(temp)await rm(temp,{recursive:true,force:true});temp='';});

describe('lifecycle diagnostic model',()=>{
  it('exposes the stable DB001-DB011 identifiers and structured check fields',()=>{
    expect(LIFECYCLE_CHECK_IDS).toEqual(['DB001','DB002','DB003','DB004','DB005','DB006','DB007','DB008','DB009','DB010','DB011']);
    expect(check('DB002','FAIL','Configured cwd','missing','directory exists','The configured cwd does not exist.','Select the verified Git root.',true)).toEqual({id:'DB002',status:'FAIL',title:'Configured cwd',detected:'missing',expected:'directory exists',explanation:'The configured cwd does not exist.',remediation:'Select the verified Git root.',repairable:true});
  });
});

describe('path safety',()=>{
  it('normalizes Windows forward, backward, mixed separators, spaces and drive case lexically',()=>{
    expect(normalizeInputPath('c:/Users/Test User/project\\src/..','C:\\base')).toBe('C:\\Users\\Test User\\project');
    expect(normalizeInputPath('C:\\repo\\.\\src\\..\\test','C:\\base')).toBe('C:\\repo\\test');
  });

  it('resolves relative dot segments against the supplied base',()=>{
    expect(normalizeInputPath('../repo/./src',path.join('C:','workspace','child'))).toBe(path.resolve(path.join('C:','workspace','repo','src')));
  });

  it('detects duplicate path segments without changing the path',()=>{
    const incident='C:\\Users\\Administrator\\Documents\\Documents\\Automations 2026\\IA PROJECTS\\Aura-main';
    expect(duplicateSegments(incident)).toEqual([{segment:'Documents',firstIndex:3,secondIndex:4}]);
    expect(normalizeInputPath(incident)).toContain('Documents\\Documents');
  });

  it('distinguishes directories, files, missing paths and unicode paths',async()=>{
    temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-path-'));
    const unicode=path.join(temp,'r?pertoire ??');await mkdir(unicode);const file=path.join(temp,'file.txt');await writeFile(file,'x');
    expect(await inspectDirectory(unicode)).toMatchObject({status:'PASS',exists:true,isDirectory:true,canonicalPath:expect.any(String)});
    expect(await inspectDirectory(file)).toMatchObject({status:'FAIL',exists:true,isDirectory:false,reason:'NOT_DIRECTORY'});
    expect(await inspectDirectory(path.join(temp,'missing'))).toMatchObject({status:'FAIL',exists:false,isDirectory:false,reason:'NOT_FOUND'});
  });

  it('compares canonical paths and resolves a symlink when the host permits it',async()=>{
    temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-realpath-'));const target=path.join(temp,'target');const link=path.join(temp,'link');await mkdir(target);
    try{await symlink(target,link,'junction');expect(await sameCanonicalPath(target,link)).toBe(true);}catch(error:any){if(!['EPERM','EACCES'].includes(error?.code))throw error;}
  });
});
