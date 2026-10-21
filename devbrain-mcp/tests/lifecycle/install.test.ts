import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {activateProjectRuntime,commitProjectRuntime,prepareProjectRuntime,rollbackProjectRuntime} from '../../src/lifecycle/install.js';

let temp='';
afterEach(async()=>{if(temp)await rm(temp,{recursive:true,force:true});temp='';});
async function fixture(){temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-install-'));const home=path.join(temp,'home with spaces');const repo=path.join(temp,'repo with spaces');await mkdir(repo,{recursive:true});return {home,repo};}
const packageIdentity={name:'devbrain-mcp',version:'0.7.0'};
const fakeInstall=async(stage:string)=>{const root=path.join(stage,'node_modules','devbrain-mcp');await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'package.json'),JSON.stringify(packageIdentity));await writeFile(path.join(root,'dist','index.js'),'// server');};

describe('durable project runtime',()=>{
  it('stages and atomically activates a repository-scoped persistent server',async()=>{
    const {home,repo}=await fixture();const prepared=await prepareProjectRuntime({home,repositoryRoot:repo,packageIdentity,packageSpec:'local.tgz',install:fakeInstall});
    expect(prepared.status).toBe('prepared');expect(prepared.server).toContain('.stage-');
    const active=await activateProjectRuntime(prepared);expect(active.server).toContain(path.join('node_modules','devbrain-mcp','dist','index.js'));expect(await readFile(active.server,'utf8')).toBe('// server');
    await commitProjectRuntime(active);expect(active.backupRoot).toBeNull();
  });
  it('reuses an exact healthy install and supports rollback after replacement',async()=>{
    const {home,repo}=await fixture();const first=await prepareProjectRuntime({home,repositoryRoot:repo,packageIdentity,packageSpec:'local.tgz',install:fakeInstall});const active=await activateProjectRuntime(first);await commitProjectRuntime(active);
    const reused=await prepareProjectRuntime({home,repositoryRoot:repo,packageIdentity,packageSpec:'local.tgz',install:async()=>{throw new Error('must not reinstall');}});expect(reused.status).toBe('reused');
    await writeFile(path.join(reused.runtimeRoot,'marker'),'original');
    const nextIdentity={name:'devbrain-mcp',version:'0.6.0-rc.2'};const replacement=await prepareProjectRuntime({home,repositoryRoot:repo,packageIdentity:nextIdentity,packageSpec:'next.tgz',install:async stage=>{const root=path.join(stage,'node_modules','devbrain-mcp');await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'package.json'),JSON.stringify(nextIdentity));await writeFile(path.join(root,'dist','index.js'),'// next');}});const replaced=await activateProjectRuntime(replacement);await rollbackProjectRuntime(replaced);
    expect(await readFile(path.join(reused.runtimeRoot,'marker'),'utf8')).toBe('original');
  });
  it('rejects a corrupt package without replacing the current runtime',async()=>{
    const {home,repo}=await fixture();await expect(prepareProjectRuntime({home,repositoryRoot:repo,packageIdentity,packageSpec:'bad.tgz',install:async()=>{}})).rejects.toThrow('INSTALLED_PACKAGE_INVALID');
  });
});
