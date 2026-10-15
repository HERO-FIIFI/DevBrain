import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {executeLifecyclePlan,planRepair,planSetup,planUninstall} from '../../src/lifecycle/service.js';
import {parseCodexConfig,readDevbrainDefinition} from '../../src/lifecycle/toml.js';

let temp='';
afterEach(async()=>{if(temp)await rm(temp,{recursive:true,force:true});temp='';});
async function fixture(){
  temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-service-'));
  const repo=path.join(temp,'Aura-main','Aura-main');await mkdir(repo,{recursive:true});
  const server=path.join(temp,'dist','index.js');await mkdir(path.dirname(server));await writeFile(server,'');
  const config=path.join(temp,'.codex','config.toml');await mkdir(path.dirname(config));
  const unrelated='model = "gpt"\n\n[mcp_servers.other]\ncommand = "other"\n';await writeFile(config,unrelated);
  return {repo,server,config,unrelated};
}
const portable=(value:string)=>value.replaceAll('\\','/');

describe('lifecycle services',()=>{
  it('plans before writing and requires explicit authorization',async()=>{
    const f=await fixture();const plan=await planSetup({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'}});
    expect(await readFile(f.config,'utf8')).toBe(f.unrelated);expect(plan).toMatchObject({kind:'setup',ready:true,proposed:expect.stringContaining('required = true')});
    expect((await executeLifecyclePlan(plan,{authorized:false})).status).toBe('refused');expect(await readFile(f.config,'utf8')).toBe(f.unrelated);
  });
  it('blocks required=true when preflight fails and allows it after success',async()=>{
    const f=await fixture();const blocked=await planSetup({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:false,reason:'MCP_INITIALIZATION_FAILED'}});
    expect(blocked.ready).toBe(false);expect(blocked.proposed).not.toContain('required = true');expect((await executeLifecyclePlan(blocked,{authorized:true})).status).toBe('blocked');
    const ready=await planSetup({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'}});expect((await executeLifecyclePlan(ready,{authorized:true})).status).toBe('committed');
    expect(readDevbrainDefinition(parseCodexConfig(await readFile(f.config,'utf8')))).toMatchObject({required:true,cwd:portable(f.repo),workspaceRoot:portable(f.repo)});expect(await readFile(f.config,'utf8')).toContain('[mcp_servers.other]');
  });
  it('dry-run changes nothing and a setup transaction failure preserves original',async()=>{
    const f=await fixture();const plan=await planSetup({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'}});
    expect((await executeLifecyclePlan(plan,{authorized:true,dryRun:true})).status).toBe('dry_run');expect(await readFile(f.config,'utf8')).toBe(f.unrelated);
    expect((await executeLifecyclePlan(plan,{authorized:true,fault:'before_rename'})).status).toBe('failed');expect(await readFile(f.config,'utf8')).toBe(f.unrelated);
  });
  it('repairs both malformed path fields only from the independently verified Git root',async()=>{
    const f=await fixture();const malformed='C:\\Users\\Administrator\\Documents\\Documents\\Automations 2026\\IA PROJECTS\\Aura-main';
    const current=`${f.unrelated}\n[mcp_servers.devbrain]\ncommand = "node"\nargs = [${JSON.stringify(portable(f.server))}]\ncwd = ${JSON.stringify(malformed)}\nrequired = true\n\n[mcp_servers.devbrain.env]\nDEVBRAIN_WORKSPACE_ROOT = ${JSON.stringify(malformed)}\n`;await writeFile(f.config,current);
    const plan=await planRepair({config:f.config,workspace:path.dirname(f.repo),repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'}});
    expect(plan).toMatchObject({kind:'repair',ready:true,reason:expect.stringContaining('verified Git root')});expect(plan.proposed).toContain(portable(f.repo));
    expect((await executeLifecyclePlan(plan,{authorized:true})).status).toBe('committed');expect(readDevbrainDefinition(parseCodexConfig(await readFile(f.config,'utf8')))).toMatchObject({cwd:portable(f.repo),workspaceRoot:portable(f.repo)});expect(await readFile(f.config,'utf8')).toContain('[mcp_servers.other]');
  });
  it('refuses ambiguous repair and removes only DevBrain-owned sections on uninstall',async()=>{
    const f=await fixture();const setup=await planSetup({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'}});await executeLifecyclePlan(setup,{authorized:true});
    await expect(planRepair({config:f.config,workspace:f.repo,repositoryRoot:f.repo,server:f.server,node:process.execPath,mcpProbe:{ok:true,reason:'MCP_READY'},conflictingDefinitions:true})).rejects.toThrow('AMBIGUOUS_CONFIG_REPAIR');
    const uninstall=await planUninstall({config:f.config});expect((await executeLifecyclePlan(uninstall,{authorized:true})).status).toBe('committed');const text=await readFile(f.config,'utf8');expect(text).toContain('[mcp_servers.other]');expect(text).not.toContain('mcp_servers.devbrain');
  });
});
