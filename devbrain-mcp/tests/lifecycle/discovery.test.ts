import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {runProcess} from '../../src/lib/process-runner.js';
import {compareWorkspaceAndRepository,discoverGitRoot} from '../../src/lifecycle/git-root.js';
import {discoverConfigFiles} from '../../src/lifecycle/discovery.js';
import {sameCanonicalPath} from '../../src/lifecycle/paths.js';

let temp='';afterEach(async()=>{if(temp)await rm(temp,{recursive:true,force:true});temp='';});
async function gitRepo(root:string){await mkdir(root,{recursive:true});expect((await runProcess({executable:'git',args:['init'],cwd:root})).status).toBe('completed');}
async function config(root:string){const file=path.join(root,'.codex','config.toml');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'[mcp_servers.devbrain]\ncommand="node"\n');return file;}

describe('Git root discovery',()=>{
  it('uses Git to find an exact repository root',async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-git-'));const repo=path.join(temp,'repo');await gitRepo(repo);const child=path.join(repo,'src');await mkdir(child);const result=await discoverGitRoot(child);expect(result).toMatchObject({status:'found',repositoryRoot:expect.any(String)});expect(await sameCanonicalPath(result.repositoryRoot!,repo)).toBe(true);});
  it('reports and independently discovers a parent workspace containing one nested repository',async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-nested-'));const workspace=path.join(temp,'Aura-main');const repo=path.join(workspace,'Aura-main');await gitRepo(repo);expect(compareWorkspaceAndRepository(workspace,repo)).toMatchObject({relation:'workspace_contains_repository',status:'WARN'});const discovered=await discoverGitRoot(workspace);expect(discovered).toMatchObject({status:'found',selectedPath:expect.any(String),repositoryRoot:expect.any(String),detail:expect.stringContaining('nested')});expect(await sameCanonicalPath(discovered.repositoryRoot!,repo)).toBe(true);});
  it('reports a non-Git directory instead of inferring from names',async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-nogit-'));expect(await discoverGitRoot(temp)).toMatchObject({status:'not_git',repositoryRoot:null});});
});

describe('bounded Codex config discovery',()=>{
  it('finds only global, applicable parent, workspace and repository configs',async()=>{
    temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-config-discovery-'));const home=path.join(temp,'home');const workspace=path.join(temp,'projects','Aura-main');const repo=path.join(workspace,'Aura-main');await Promise.all([mkdir(home,{recursive:true}),gitRepo(repo)]);
    const [global,parent,workspaceFile,repoFile]=await Promise.all([config(home),config(path.join(temp,'projects')),config(workspace),config(repo)]);
    await config(path.join(temp,'unrelated'));
    const found=await discoverConfigFiles({home,workspace,repositoryRoot:repo});
    expect(found.map(x=>x.file)).toEqual(expect.arrayContaining([global,parent,workspaceFile,repoFile]));
    expect(found.map(x=>x.file).some(x=>x.includes('unrelated'))).toBe(false);
    expect(found.find(x=>x.file===global)?.scope).toBe('global');expect(found.find(x=>x.file===repoFile)?.scope).toBe('repository');
  });
});
