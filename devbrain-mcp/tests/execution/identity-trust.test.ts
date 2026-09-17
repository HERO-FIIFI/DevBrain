import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../src/lib/process-runner.js';
import { repositoryIdentity } from '../../src/execution/trust/repository-identity.js';
import { authorize } from '../../src/execution/authorization.js';
import { approve, revoke } from '../../src/execution/trust/store.js';
import type { ResolvedCapability } from '../../src/execution/types.js';

let roots: string[] = []; let oldHome: string | undefined;
async function repo(message: string) { const root = await mkdtemp(path.join(os.tmpdir(), 'devbrain-repo-')); roots.push(root); for (const args of [['init'], ['config','user.email','test@example.com'], ['config','user.name','Test']]) await runProcess({ executable:'git', args, cwd:root }); await writeFile(path.join(root,'file.txt'), message); await runProcess({executable:'git',args:['add','.'],cwd:root}); await runProcess({executable:'git',args:['commit','-m',message],cwd:root}); return root; }
afterEach(async () => { for (const root of roots) await rm(root,{recursive:true,force:true}); roots=[]; if (oldHome === undefined) delete process.env.DEVBRAIN_HOME; else process.env.DEVBRAIN_HOME=oldHome; });
describe('identity and capability trust', () => {
  it('is stable for a local repo and differs for a replacement', async () => { const a=await repo('a'); expect(await repositoryIdentity(a)).toEqual(await repositoryIdentity(a)); const b=await repo('b'); expect((await repositoryIdentity(a)).fingerprint).not.toBe((await repositoryIdentity(b)).fingerprint); });
  it('does not transfer identity to a different repository at the same path',async()=>{const location=await repo('original');const before=await repositoryIdentity(location);await rm(path.join(location,'.git'),{recursive:true,force:true});for(const args of [['init'],['config','user.email','test@example.com'],['config','user.name','Test']])await runProcess({executable:'git',args,cwd:location});await writeFile(path.join(location,'other.txt'),'replacement');await runProcess({executable:'git',args:['add','.'],cwd:location});await runProcess({executable:'git',args:['commit','-m','replacement'],cwd:location});expect((await repositoryIdentity(location)).fingerprint).not.toBe(before.fingerprint);});
  it('removes credentials from remote identity metadata',async()=>{const location=await repo('remote');await runProcess({executable:'git',args:['remote','add','origin','https://alice:supersecret@example.com/team/repo.git'],cwd:location});const identity=await repositoryIdentity(location);expect(identity.remote).toBe('https://example.com/team/repo.git');expect(JSON.stringify(identity)).not.toContain('supersecret');});
  it('requires exact capability and definition approval, supports revocation', async () => {
    oldHome=process.env.DEVBRAIN_HOME; const home=await mkdtemp(path.join(os.tmpdir(),'devbrain-home-')); roots.push(home); process.env.DEVBRAIN_HOME=home; const identity=await repositoryIdentity(await repo('trusted'));
    const resolved: ResolvedCapability={capability:'test',invocation:{executable:'npm',args:['test'],cwd:identity.repositoryRoot},definition:{source:'package.json',script:'vitest run',fingerprint:'sha256:one',framework:'vitest'}};
    const first=await authorize(identity,resolved); expect(first.authorizationStatus).toBe('approval_required'); await approve(first.approval!.approvalId); expect((await authorize(identity,resolved)).authorizationStatus).toBe('authorized');
    expect((await authorize(identity,{...resolved,capability:'build'})).authorizationStatus).toBe('approval_required'); expect((await authorize(identity,{...resolved,definition:{...resolved.definition,fingerprint:'sha256:changed'}})).authorizationStatus).toBe('approval_required');
    await revoke(identity,'test'); expect((await authorize(identity,resolved)).authorizationStatus).toBe('approval_required');
  });
});
