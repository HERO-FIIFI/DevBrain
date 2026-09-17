import path from 'node:path';import {describe,expect,it} from 'vitest';import {discoverCapability} from '../../src/execution/discovery.js';
const fixture=(name:string)=>path.join(process.cwd(),'fixtures','execution',name);
describe('execution fixtures',()=>{
  it.each([['vitest-pass','test','vitest'],['vitest-fail','test','vitest'],['jest-pass','test','jest'],['pytest-pass','test','pytest'],['pytest-fail','test','pytest'],['lint-pass','lint','generic'],['lint-fail','lint','generic'],['build-pass','build','generic'],['build-fail','build','generic']] as const)('discovers %s',async(name,capability,framework)=>expect(await discoverCapability(fixture(name),capability)).toMatchObject({capability,definition:{framework}}));
});
