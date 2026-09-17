import { describe,expect,it } from 'vitest';
import { parseResult } from '../../src/execution/parsers.js';
describe('execution parsers',()=>{
  it('parses Vitest, Jest, and pytest text with medium confidence',()=>{
    expect(parseResult('vitest','Tests  2 passed | 1 failed','',1,'completed').summary).toMatchObject({passed:2,failed:1,parseMethod:'text_regex',parseConfidence:'medium'});
    expect(parseResult('jest','Tests: 1 failed, 2 skipped, 3 passed','',1,'completed').summary).toMatchObject({passed:3,failed:1,skipped:2});
    expect(parseResult('pytest','2 passed, 1 failed, 1 skipped','',1,'completed').summary).toMatchObject({passed:2,failed:1,skipped:1});
  });
  it('keeps timeout unknown and fallback explicit',()=>{expect(parseResult('generic','','',null,'timed_out')).toMatchObject({resultStatus:'unknown',summary:{parseMethod:'unknown',parseConfidence:'unknown'}});expect(parseResult('generic','','',1,'completed').summary.parseMethod).toBe('exit_code_only');});
});
