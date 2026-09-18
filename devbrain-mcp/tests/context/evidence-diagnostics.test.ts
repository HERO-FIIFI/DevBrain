import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getExecutionEvidence } from '../../src/tools/get-execution-evidence.js';
import { diagnoseLog } from '../../src/tools/diagnose-log.js';

let home:string,previous:string|undefined;
async function evidence(id:string,stdout:string,stderr='',repository='repo1'){
  const directory=path.join(home,'executions',repository,id);await mkdir(directory,{recursive:true});
  const metadata={executionId:id,capability:'test',command:{executable:'npm',args:['test']},cwd:'/repo',startedAt:'2026-01-01T00:00:00Z',git:{sha:'abc',branch:'main',dirty:true,dirtyFileCount:1},environment:{platform:'linux',arch:'x64',nodeVersion:'v22',packageManager:'npm',packageManagerVersion:'10.0.0'}};
  const result={executionId:id,executionStatus:'completed',resultStatus:'failed',exitCode:1,finishedAt:'2026-01-01T00:00:01Z',durationMs:1000,summary:{framework:'vitest',passed:1,failed:1,skipped:0,errors:0,failingTestsTotal:1,parseMethod:'text_regex',parseConfidence:'medium'},log:{stdoutSha256:'sha256:out',stderrSha256:'sha256:err'}};
  await Promise.all([writeFile(path.join(directory,'metadata.json'),JSON.stringify(metadata)),writeFile(path.join(directory,'result.json'),JSON.stringify(result)),writeFile(path.join(directory,'stdout.log'),stdout),writeFile(path.join(directory,'stderr.log'),stderr)]);
}
beforeEach(async()=>{home=await mkdtemp(path.join(os.tmpdir(),'devbrain-evidence-'));previous=process.env.DEVBRAIN_HOME;process.env.DEVBRAIN_HOME=home;});
afterEach(async()=>{if(previous===undefined)delete process.env.DEVBRAIN_HOME;else process.env.DEVBRAIN_HOME=previous;await rm(home,{recursive:true,force:true});});

describe('execution evidence retrieval',()=>{
  it('returns bounded structured evidence without raw logs',async()=>{await evidence('exec_valid_123','secret token=supersecret\nFAIL test');const result=await getExecutionEvidence({executionId:'exec_valid_123'});expect(result).toMatchObject({status:'complete',capability:'test',git:{dirty:true},test:{passed:1,failed:1},parseMethod:'text_regex',log:{stdoutBytes:expect.any(Number)}});expect(JSON.stringify(result)).not.toContain('supersecret');});
  it('rejects malformed, missing, and duplicate execution IDs',async()=>{expect(await getExecutionEvidence({executionId:'exec_missing_123'})).toMatchObject({status:'error'});await evidence('exec_duplicate_123','a','', 'one');await evidence('exec_duplicate_123','b','', 'two');expect(await getExecutionEvidence({executionId:'exec_duplicate_123'})).toMatchObject({status:'error',message:'AMBIGUOUS_EXECUTION_ID'});});
});

describe('diagnostic compression',()=>{
  it.each([
    ['vitest','FAIL tests/auth.test.ts > expired token\nAssertionError: expected 401, received 200\n at validate (src/auth/jwt.ts:117:4)','AssertionError'],
    ['jest','FAIL tests/login.test.js\nTypeError: invalid value\n at login (src/login.js:12:3)','TypeError'],
    ['pytest','FAILED tests/test_auth.py::test_expired - AssertionError: wrong status\nFile "src/auth.py", line 44, in check','AssertionError'],
    ['compiler','src/index.ts(8,12): error TS2322: Type string is not assignable','Error'],
    ['lint','src/index.ts:4:7 error Unexpected any','Error'],
  ])('extracts %s failure signal',(async(name,log,type)=>{await evidence(`exec_${name}_123`,log);const result=await diagnoseLog({executionId:`exec_${name}_123`});expect(result).toMatchObject({status:'complete',primaryFailure:{type},confidence:'medium',source:{trust:'untrusted_content'}});}));
  it('extracts chained exceptions and redacts messages',async()=>{await evidence('exec_nested_123','Caused by: TokenExpiredError: token=supersecret\nAuthError: request failed');const result=await diagnoseLog({executionId:'exec_nested_123'});expect(result).toMatchObject({primaryFailure:{type:'AuthError'},causedBy:[{type:'TokenExpiredError'}]});expect(JSON.stringify(result)).not.toContain('supersecret');});
  it('bounds large logs and labels unknown formats honestly',async()=>{await evidence('exec_large_123',`${'noise\n'.repeat(200_000)}Error: final failure`);expect(await diagnoseLog({executionId:'exec_large_123',maxFrames:2})).toMatchObject({status:'partial',truncated:true});await evidence('exec_unknown_123','plain output');expect(await diagnoseLog({executionId:'exec_unknown_123'})).toMatchObject({confidence:'low'});});
});
