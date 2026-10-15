import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../src/lib/process-runner.js';
import { searchText } from '../../src/tools/search-text.js';
import { searchSymbols } from '../../src/tools/search-symbols.js';
import { findReferences } from '../../src/tools/find-references.js';
import { readFileSlice } from '../../src/tools/read-file-slice.js';
import { readSymbol, readSymbolOutput } from '../../src/tools/read-symbol.js';
import { getDiff } from '../../src/tools/get-diff.js';

let temp:string,repo:string,previous:string|undefined;
beforeEach(async()=>{
  temp=await mkdtemp(path.join(os.tmpdir(),'devbrain-context-'));repo=path.join(temp,'repo');await mkdir(path.join(repo,'src'),{recursive:true});await mkdir(path.join(repo,'node_modules'),{recursive:true});
  previous=process.env.DEVBRAIN_WORKSPACE_ROOT;process.env.DEVBRAIN_WORKSPACE_ROOT=temp;
  await writeFile(path.join(repo,'.gitignore'),'ignored.txt\n');
  await writeFile(path.join(repo,'src','users.ts'),`export class UserService {\n  validateToken(value: string) { return value; }\n}\nexport function validateToken(value: string) {\n  return value;\n}\nconst api_key=supersecretvalue;\n`);
  await writeFile(path.join(repo,'src','use.js'),`export function helper() {\n  return new UserService();\n}\n`);
  await writeFile(path.join(repo,'app.py'),`class PythonService:\n    def parse_token(self, value):\n        return value\n\ndef validateToken(value):\n    return value\n`);
  await writeFile(path.join(repo,'ignored.txt'),'UserService ignored');await writeFile(path.join(repo,'node_modules','dependency.js'),'UserService ignored');await writeFile(path.join(repo,'binary.dat'),Buffer.from([0,1,2,3]));
  for(const args of [['init'],['config','user.email','test@example.com'],['config','user.name','Test']])await runProcess({executable:'git',args,cwd:repo});await runProcess({executable:'git',args:['add','.'],cwd:repo});await runProcess({executable:'git',args:['commit','-m','initial'],cwd:repo});
});
afterEach(async()=>{if(previous===undefined)delete process.env.DEVBRAIN_WORKSPACE_ROOT;else process.env.DEVBRAIN_WORKSPACE_ROOT=previous;await rm(temp,{recursive:true,force:true});});

describe('bounded context retrieval',()=>{
  it('searches exact text, respects ignores and limits, and marks untrusted provenance',async()=>{const result=await searchText({path:repo,query:'UserService',maxResults:1});expect(result).toMatchObject({status:'partial',totalMatches:2,returnedMatches:1,truncated:true,matches:[{source:{trust:'untrusted_content'}}]});expect('matches'in result&&result.matches?.some((match)=>match.file==='ignored.txt'||match.file.includes('node_modules'))).toBe(false);});
  it('redacts secret-like search previews and rejects binary reads',async()=>{expect(await searchText({path:repo,query:'supersecretvalue'})).toMatchObject({matches:[{preview:expect.stringContaining('[REDACTED]'),redacted:true}],redactionCount:1});expect(await readFileSlice({path:repo,file:'binary.dat',startLine:1,endLine:2})).toMatchObject({status:'error'});});
  it('finds TypeScript, JavaScript, and Python definitions with honest confidence',async()=>{expect(await searchSymbols({path:repo,query:'UserService'})).toMatchObject({symbols:[{kind:'class',language:'typescript',resolutionMethod:'heuristic',confidence:'medium'}]});expect(await searchSymbols({path:repo,query:'helper'})).toMatchObject({symbols:[{language:'javascript'}]});expect(await searchSymbols({path:repo,query:'PythonService'})).toMatchObject({symbols:[{kind:'class',language:'python'}]});});
  it('returns ambiguity instead of silently choosing a symbol',async()=>{const result=await readSymbol({path:repo,symbol:'validateToken'});expect(result).toMatchObject({status:'ambiguous'});expect('candidates'in result&&result.candidates).toHaveLength(2);expect(await readSymbol({path:repo,symbol:'missing'})).toMatchObject({status:'not_found'});});
  it('reads one symbol and redacts bounded file slices',async()=>{const symbol=await readSymbol({path:repo,file:'src/users.ts',symbol:'UserService'});expect(symbol).toMatchObject({status:'complete',startLine:1,source:{trust:'untrusted_content'}});expect(()=>readSymbolOutput.strict().parse(symbol)).not.toThrow();const slice=await readFileSlice({path:repo,file:'src/users.ts',startLine:1,endLine:9,maxBytes:100});expect(slice).toMatchObject({status:'partial',truncated:true,content:expect.any(String)});expect(JSON.stringify(slice)).not.toContain('supersecretvalue');});
  it('labels textual references low confidence and enforces result limits',async()=>{const result=await findReferences({path:repo,symbol:'UserService',maxResults:1});expect(result).toMatchObject({status:'partial',resolutionMethod:'textual',confidence:'low',totalReferences:2,returnedReferences:1});});
  it('rejects traversal and symlink escape',async()=>{await expect(readFileSlice({path:repo,file:'../outside.txt',startLine:1,endLine:1})).resolves.toMatchObject({status:'error'});const outside=path.join(temp,'outside');await mkdir(outside);await writeFile(path.join(outside,'value.txt'),'secret');await symlink(outside,path.join(repo,'escape'),'junction');await expect(readFileSlice({path:repo,file:'escape/value.txt',startLine:1,endLine:1})).resolves.toMatchObject({status:'error'});});
  it('returns structured working, staged, commit, and range diffs with redaction',async()=>{await writeFile(path.join(repo,'src','users.ts'),'const token=changedsecret\n');const result=await getDiff({path:repo,mode:'working_tree',maxBytes:80});expect(result).toMatchObject({status:'partial',mode:'working_tree',summary:{filesChanged:1},redacted:true});expect(JSON.stringify(result)).not.toContain('changedsecret');await runProcess({executable:'git',args:['add','src/users.ts'],cwd:repo});expect(await getDiff({path:repo,mode:'staged'})).toMatchObject({status:'complete',summary:{filesChanged:1}});const head=(await runProcess({executable:'git',args:['rev-parse','HEAD'],cwd:repo})).stdout.trim();expect(await getDiff({path:repo,mode:'commit',commit:head})).toMatchObject({status:'complete',mode:'commit'});expect(await getDiff({path:repo,mode:'range',from:head,to:'HEAD'})).toMatchObject({status:'complete',summary:{filesChanged:0}});});
});
