import { describe, expect, it } from 'vitest';
import { parseResult } from '../../src/execution/parsers.js';

describe('execution parsers', () => {
  it('uses the Vitest Tests summary rather than Test Files counts', () => {
    const output = 'Test Files  2 passed (2)\nTests  17 passed | 3 skipped (20)';
    expect(parseResult('vitest', output, '', 0, 'completed').summary).toMatchObject({ passed: 17, failed: 0, skipped: 3, parseMethod: 'text_regex', parseConfidence: 'medium' });
  });

  it('parses mixed Vitest results and skipped tests', () => {
    const output = 'Test Files  1 failed | 3 passed (4)\nTests  2 failed | 21 passed | 4 skipped (27)';
    expect(parseResult('vitest', output, '', 1, 'completed').summary).toMatchObject({ passed: 21, failed: 2, skipped: 4, failingTestsTotal: 2 });
  });

  it('parses Jest and pytest text with medium confidence', () => {
    expect(parseResult('jest', 'Tests: 1 failed, 2 skipped, 3 passed, 6 total', '', 1, 'completed').summary).toMatchObject({ passed: 3, failed: 1, skipped: 2, parseMethod: 'text_regex' });
    expect(parseResult('pytest', '====== 2 passed, 1 failed, 1 skipped in 0.2s ======', '', 1, 'completed').summary).toMatchObject({ passed: 2, failed: 1, skipped: 1, parseConfidence: 'medium' });
  });

  it('prefers actual JSON reporter output over text parsing', () => {
    const output = JSON.stringify({ numPassedTests: 8, numFailedTests: 1, numPendingTests: 2, numRuntimeErrorTestSuites: 0 });
    expect(parseResult('jest', output, '', 1, 'completed').summary).toMatchObject({ passed: 8, failed: 1, skipped: 2, parseMethod: 'json_reporter', parseConfidence: 'high' });
  });

  it('uses actual JUnit XML before text parsing', () => {
    const output = '<?xml version="1.0"?><testsuites><testsuite tests="7" failures="1" errors="1" skipped="2"></testsuite></testsuites>';
    expect(parseResult('pytest', output, '', 1, 'completed').summary).toMatchObject({ passed: 3, failed: 1, errors: 1, skipped: 2, parseMethod: 'junit_xml', parseConfidence: 'high' });
  });

  it('degrades honestly for unrecognized and incomplete output', () => {
    expect(parseResult('vitest', 'Test Files  2 passed (2)', '', 0, 'completed').summary).toMatchObject({ parseMethod: 'exit_code_only', parseConfidence: 'low' });
    expect(parseResult('generic', '', '', null, 'timed_out')).toMatchObject({ resultStatus: 'unknown', summary: { parseMethod: 'unknown', parseConfidence: 'unknown' } });
  });
});
