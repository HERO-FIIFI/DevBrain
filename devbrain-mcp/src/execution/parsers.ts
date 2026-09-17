import type { ExecutionStatus, ResultStatus } from './types.js';

export interface ParsedResult {
  framework: string;
  passed?: number;
  failed?: number;
  skipped?: number;
  errors?: number;
  failingTests: Array<{ name: string; message: string }>;
  failingTestsTotal: number;
  failingTestsReturned: number;
  failingTestsTruncated: boolean;
  parseMethod: 'text_regex' | 'exit_code_only' | 'unknown';
  parseConfidence: 'medium' | 'low' | 'unknown';
}

const number = (text: string, label: string) => Number(new RegExp(`(\\d+)\\s+${label}`, 'i').exec(text)?.[1] ?? 0);
export function parseResult(framework: string | undefined, stdout: string, stderr: string, exitCode: number | null, executionStatus: ExecutionStatus): { resultStatus: ResultStatus; summary: ParsedResult } {
  const text = `${stdout}\n${stderr}`; const status: ResultStatus = executionStatus !== 'completed' ? 'unknown' : exitCode === 0 ? 'passed' : 'failed';
  if (framework === 'vitest') {
    const passed = number(text, 'passed'); const failed = number(text, 'failed'); const skipped = number(text, 'skipped');
    if (/Test Files|Tests\s+/i.test(text)) return { resultStatus: status, summary: { framework, passed, failed, skipped, errors: 0, failingTests: [], failingTestsTotal: failed, failingTestsReturned: 0, failingTestsTruncated: failed > 0, parseMethod: 'text_regex', parseConfidence: 'medium' } };
  }
  if (framework === 'jest') {
    const line = /Tests:\s*(?:(\d+) failed,?\s*)?(?:(\d+) skipped,?\s*)?(?:(\d+) passed)/i.exec(text);
    if (line) { const failed=Number(line[1]??0), skipped=Number(line[2]??0), passed=Number(line[3]??0); return { resultStatus: status, summary: { framework, passed, failed, skipped, errors: 0, failingTests: [], failingTestsTotal: failed, failingTestsReturned: 0, failingTestsTruncated: failed > 0, parseMethod:'text_regex',parseConfidence:'medium' } }; }
  }
  if (framework === 'pytest') {
    const passed=number(text,'passed'), failed=number(text,'failed'), skipped=number(text,'skipped'), errors=number(text,'errors?');
    if (/\d+\s+(?:passed|failed|error|skipped)/i.test(text)) return { resultStatus: status, summary: { framework, passed, failed, skipped, errors, failingTests: [], failingTestsTotal: failed + errors, failingTestsReturned: 0, failingTestsTruncated: failed + errors > 0, parseMethod:'text_regex',parseConfidence:'medium' } };
  }
  return { resultStatus: status, summary: { framework: framework ?? 'generic', failingTests: [], failingTestsTotal: 0, failingTestsReturned: 0, failingTestsTruncated: false, parseMethod: executionStatus === 'completed' ? 'exit_code_only' : 'unknown', parseConfidence: executionStatus === 'completed' ? 'low' : 'unknown' } };
}
