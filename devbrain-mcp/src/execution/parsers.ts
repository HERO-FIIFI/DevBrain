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
  parseMethod: 'json_reporter' | 'junit_xml' | 'text_regex' | 'exit_code_only' | 'unknown';
  parseConfidence: 'high' | 'medium' | 'low' | 'unknown';
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const count = (text: string, label: string) => Number(new RegExp(`(\\d+)\\s+${label}\\b`, 'i').exec(text)?.[1] ?? 0);
const base = (framework: string, method: ParsedResult['parseMethod'], confidence: ParsedResult['parseConfidence']) => ({
  framework, failingTests: [], failingTestsTotal: 0, failingTestsReturned: 0, failingTestsTruncated: false, parseMethod: method, parseConfidence: confidence,
});

function parseJson(framework: string, stdout: string, stderr: string): ParsedResult | null {
  for (const candidate of [stdout.trim(), stderr.trim()]) {
    if (!candidate.startsWith('{')) continue;
    try {
      const report = JSON.parse(candidate) as Record<string, unknown>;
      const values = [report.numPassedTests, report.numFailedTests, report.numPendingTests];
      if (!values.some((value) => typeof value === 'number')) continue;
      const passed = typeof values[0] === 'number' ? values[0] : 0;
      const failed = typeof values[1] === 'number' ? values[1] : 0;
      const skipped = typeof values[2] === 'number' ? values[2] : 0;
      return { ...base(framework, 'json_reporter', 'high'), passed, failed, skipped, errors: typeof report.numRuntimeErrorTestSuites === 'number' ? report.numRuntimeErrorTestSuites : 0, failingTestsTotal: failed, failingTestsTruncated: failed > 0 };
    } catch { /* Not machine-readable JSON; continue down the parsing hierarchy. */ }
  }
  return null;
}

const attribute = (tag: string, name: string) => Number(new RegExp(`\\b${name}=["'](\\d+)["']`, 'i').exec(tag)?.[1] ?? 0);
function parseJunit(framework: string, stdout: string, stderr: string): ParsedResult | null {
  const text = `${stdout}\n${stderr}`.trim();
  if (!/^<\?xml\b|^<testsuites?\b/i.test(text)) return null;
  const suites = [...text.matchAll(/<testsuite\b[^>]*>/gi)].map((match) => match[0]);
  const tags = suites.length ? suites : [/<testsuites\b[^>]*>/i.exec(text)?.[0] ?? ''];
  if (!tags[0]) return null;
  const total = tags.reduce((sum, tag) => sum + attribute(tag, 'tests'), 0);
  const failed = tags.reduce((sum, tag) => sum + attribute(tag, 'failures'), 0);
  const errors = tags.reduce((sum, tag) => sum + attribute(tag, 'errors'), 0);
  const skipped = tags.reduce((sum, tag) => sum + attribute(tag, 'skipped'), 0);
  if (!total && !failed && !errors && !skipped) return null;
  return { ...base(framework, 'junit_xml', 'high'), passed: Math.max(0, total - failed - errors - skipped), failed, skipped, errors, failingTestsTotal: failed + errors, failingTestsTruncated: failed + errors > 0 };
}

function parseText(framework: string, stdout: string, stderr: string): ParsedResult | null {
  const lines = `${stdout}\n${stderr}`.replace(ansi, '').split(/\r?\n/).map((line) => line.trim());
  if (framework === 'vitest') {
    const line = lines.find((value) => /^Tests\s+/i.test(value));
    if (line) {
      const passed = count(line, 'passed'), failed = count(line, 'failed'), skipped = count(line, 'skipped');
      return { ...base(framework, 'text_regex', 'medium'), passed, failed, skipped, errors: 0, failingTestsTotal: failed, failingTestsTruncated: failed > 0 };
    }
  }
  if (framework === 'jest') {
    const line = lines.find((value) => /^Tests:\s*/i.test(value));
    if (line) {
      const passed = count(line, 'passed'), failed = count(line, 'failed'), skipped = count(line, 'skipped');
      return { ...base(framework, 'text_regex', 'medium'), passed, failed, skipped, errors: 0, failingTestsTotal: failed, failingTestsTruncated: failed > 0 };
    }
  }
  if (framework === 'pytest') {
    const line = [...lines].reverse().find((value) => /\d+\s+(?:passed|failed|errors?|skipped)\b/i.test(value));
    if (line) {
      const passed = count(line, 'passed'), failed = count(line, 'failed'), skipped = count(line, 'skipped'), errors = count(line, 'errors?');
      return { ...base(framework, 'text_regex', 'medium'), passed, failed, skipped, errors, failingTestsTotal: failed + errors, failingTestsTruncated: failed + errors > 0 };
    }
  }
  return null;
}

export function parseResult(framework: string | undefined, stdout: string, stderr: string, exitCode: number | null, executionStatus: ExecutionStatus): { resultStatus: ResultStatus; summary: ParsedResult } {
  const name = framework ?? 'generic';
  const resultStatus: ResultStatus = executionStatus !== 'completed' ? 'unknown' : exitCode === 0 ? 'passed' : 'failed';
  const summary = parseJson(name, stdout, stderr) ?? parseJunit(name, stdout, stderr) ?? parseText(name, stdout, stderr);
  if (summary) return { resultStatus, summary };
  return { resultStatus, summary: base(name, executionStatus === 'completed' ? 'exit_code_only' : 'unknown', executionStatus === 'completed' ? 'low' : 'unknown') };
}
