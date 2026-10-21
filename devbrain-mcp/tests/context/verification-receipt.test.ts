import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getExecutionEvidence } from '../../src/tools/get-execution-evidence.js';
import { renderVerificationReceiptMarkdown } from '../../src/context/verification-receipt.js';

let home = '';
let previousHome: string | undefined;

async function record(id: string, capability: string, overrides: Record<string, any> = {}) {
  const directory = path.join(home, 'executions', 'repo1', id);
  await mkdir(directory, { recursive: true });
  const metadata = {
    executionId: id,
    capability,
    command: { executable: 'node', args: ['-e', 'token=super-secret-value'], },
    cwd: 'C:\\private\\consumer',
    startedAt: '2026-01-01T00:00:00.000Z',
    repository: { repositoryRoot: 'C:\\private\\consumer', repositoryId: 'repo1' },
    environment: { platform: 'win32', arch: 'x64', nodeVersion: 'v24.0.0' },
  };
  const result = {
    executionId: id,
    executionStatus: 'completed',
    resultStatus: capability === 'build' ? 'failed' : 'passed',
    exitCode: capability === 'build' ? 1 : 0,
    startedAt: metadata.startedAt,
    finishedAt: '2026-01-01T00:00:01.250Z',
    durationMs: 1250,
    summary: { framework: capability === 'lint' ? 'eslint' : 'vitest', passed: 4, failed: 0, skipped: 1, errors: 0, failingTestsTotal: 0, parseMethod: 'text_regex', parseConfidence: 'medium' },
    log: { stdoutSha256: 'sha256:out', stderrSha256: 'sha256:err', captureTruncated: false },
    ...overrides,
  };
  await Promise.all([
    writeFile(path.join(directory, 'metadata.json'), JSON.stringify(metadata)),
    writeFile(path.join(directory, 'result.json'), JSON.stringify(result)),
    writeFile(path.join(directory, 'stdout.log'), 'Tests 4 passed, 1 skipped\ntoken=super-secret-value'),
    writeFile(path.join(directory, 'stderr.log'), ''),
  ]);
}

beforeEach(async () => { home = await mkdtemp(path.join(os.tmpdir(), 'devbrain-receipt-')); previousHome = process.env.DEVBRAIN_HOME; process.env.DEVBRAIN_HOME = home; });
afterEach(async () => { if (previousHome === undefined) delete process.env.DEVBRAIN_HOME; else process.env.DEVBRAIN_HOME = previousHome; await rm(home, { recursive: true, force: true }); });

describe('verification receipts', () => {
  it('projects a successful test execution into a compact receipt', async () => {
    await record('exec_receipt_success', 'test');
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_success', view: 'receipt' });
    expect(result).toMatchObject({ status: 'complete', receipt: { receiptId: 'exec_receipt_success', executionType: 'test', result: 'PASSED', exitCode: 0, durationMs: 1250, tests: { passed: 4, skipped: 1 }, evidenceReference: 'exec_receipt_success', incomplete: false } });
  });

  it('reports failed builds without confusing command success with verification success', async () => {
    await record('exec_receipt_build', 'build');
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_build', view: 'receipt' });
    expect(result).toMatchObject({ receipt: { executionType: 'build', result: 'FAILED', exitCode: 1 } });
    expect((result as any).receipt.tests).toBeUndefined();
  });

  it('preserves failed test counts in a failed test receipt', async () => {
    await record('exec_receipt_failed_tests', 'test', { resultStatus: 'failed', exitCode: 1, summary: { framework: 'vitest', passed: 2, failed: 3, skipped: 1, errors: 0, parseMethod: 'text_regex', parseConfidence: 'medium' } });
    expect(await getExecutionEvidence({ executionId: 'exec_receipt_failed_tests', view: 'receipt' })).toMatchObject({ receipt: { result: 'FAILED', tests: { passed: 2, failed: 3, skipped: 1 } } });
  });

  it('represents lint and targeted-test execution types', async () => {
    await record('exec_receipt_lint', 'lint');
    await record('exec_receipt_target', 'targeted_test');
    expect(await getExecutionEvidence({ executionId: 'exec_receipt_lint', view: 'receipt' })).toMatchObject({ receipt: { executionType: 'lint', scope: 'repository' } });
    expect(await getExecutionEvidence({ executionId: 'exec_receipt_target', view: 'receipt' })).toMatchObject({ receipt: { executionType: 'targeted_test' } });
  });

  it('reports timeout and interrupted executions as incomplete', async () => {
    await record('exec_receipt_timeout', 'test', { executionStatus: 'timed_out', resultStatus: 'unknown', exitCode: undefined, summary: { framework: 'vitest', parseMethod: 'unknown', parseConfidence: 'unknown' }, log: { captureTruncated: true } });
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_timeout', view: 'receipt' });
    expect(result).toMatchObject({ receipt: { result: 'TIMEOUT', incomplete: true } });
    expect((result as any).receipt.exitCode).toBeUndefined();
    await record('exec_receipt_cancelled', 'test', { executionStatus: 'cancelled', resultStatus: 'unknown', exitCode: undefined });
    expect(await getExecutionEvidence({ executionId: 'exec_receipt_cancelled', view: 'receipt' })).toMatchObject({ receipt: { result: 'CANCELLED', incomplete: true } });
  });

  it('does not infer a pass from missing or low-confidence evidence', async () => {
    await record('exec_receipt_missing_counts', 'test', { resultStatus: 'passed', summary: { framework: 'generic', parseMethod: 'unknown', parseConfidence: 'unknown' } });
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_missing_counts', view: 'receipt' });
    expect(result).toMatchObject({ receipt: { result: 'PASSED', incomplete: true, remainingUnverifiedAreas: expect.arrayContaining(['test counts']) } });
    expect((result as any).receipt.tests).toBeUndefined();
    expect(await getExecutionEvidence({ executionId: 'exec_receipt_absent', view: 'receipt' })).toMatchObject({ status: 'error', errorCode: 'GET_EXECUTION_EVIDENCE_FAILED' });
  });

  it('marks capture truncation and keeps secrets and absolute paths out of the receipt', async () => {
    await record('exec_receipt_redacted', 'test', { log: { captureTruncated: true } });
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_redacted', view: 'receipt' });
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(JSON.stringify(result)).not.toContain('C:\\private\\consumer');
    expect(result).toMatchObject({ receipt: { incomplete: true, commandSummary: expect.stringContaining('[REDACTED]') } });
  });

  it('returns a combined summary with independently classified categories', async () => {
    await record('exec_receipt_test_summary', 'test');
    await record('exec_receipt_lint_summary', 'lint', { resultStatus: 'failed', exitCode: 2 });
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_test_summary', executionIds: ['exec_receipt_test_summary', 'exec_receipt_lint_summary'], view: 'summary' });
    expect(result).toMatchObject({ status: 'complete', summary: { categories: { test: { status: 'PASSED' }, lint: { status: 'FAILED' }, build: { status: 'NOT_VERIFIED' }, targeted_test: { status: 'NOT_VERIFIED' } } } });
  });

  it('keeps the existing full evidence response backward compatible and adds a receipt', async () => {
    await record('exec_receipt_full', 'test');
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_full' });
    expect(result).toMatchObject({ status: 'complete', executionId: 'exec_receipt_full', capability: 'test', log: { available: true }, receipt: { receiptId: 'exec_receipt_full' } });
  });

  it('renders the receipt model as compact Markdown without raw logs', async () => {
    await record('exec_receipt_markdown', 'test');
    const result = await getExecutionEvidence({ executionId: 'exec_receipt_markdown', view: 'receipt' });
    const markdown = renderVerificationReceiptMarkdown((result as any).receipt);
    expect(markdown).toContain('# Verification receipt');
    expect(markdown).toContain('PASSED');
    expect(markdown).not.toContain('super-secret-value');
  });
});
