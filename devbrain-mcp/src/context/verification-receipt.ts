import path from 'node:path';
import { redactString } from '../lib/redaction.js';
import type { LocatedExecution } from './execution-evidence.js';

export type ReceiptResult = 'PASSED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED' | 'UNKNOWN';
export type ReceiptExecutionType = 'test' | 'targeted_test' | 'lint' | 'build';
export interface VerificationReceipt {
  receiptId: string;
  executionType: ReceiptExecutionType;
  commandCategory: ReceiptExecutionType;
  commandSummary: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  result: ReceiptResult;
  tests?: { passed?: number; failed?: number; skipped?: number; errors?: number };
  scope: 'repository' | 'targeted';
  remainingUnverifiedAreas: string[];
  evidenceReference: string;
  incomplete: boolean;
}

export interface VerificationSummary {
  categories: Record<ReceiptExecutionType, { status: ReceiptResult | 'NOT_VERIFIED'; receiptId?: string }>;
  incomplete: boolean;
}

const absolutePath = /(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>]+/g;
const safePart = (value: string) => redactString(value).replace(absolutePath, '[PATH]').slice(0, 160);

function commandSummary(item: LocatedExecution): string {
  const command = item.metadata.command ?? {};
  const executable = typeof command.executable === 'string' ? path.basename(command.executable) : 'unknown';
  const args = Array.isArray(command.args) ? command.args.filter((arg: unknown): arg is string => typeof arg === 'string').map(safePart) : [];
  return [executable, ...args].join(' ').trim().slice(0, 240);
}

function resultOf(item: LocatedExecution): ReceiptResult {
  const executionStatus = String(item.result.executionStatus ?? '');
  if (executionStatus === 'timed_out') return 'TIMEOUT';
  if (executionStatus === 'cancelled') return 'CANCELLED';
  if (item.result.resultStatus === 'passed') return 'PASSED';
  if (item.result.resultStatus === 'failed') return 'FAILED';
  return 'UNKNOWN';
}

function reliableTests(item: LocatedExecution, capability: ReceiptExecutionType) {
  const summary = item.result.summary ?? {};
  if (!['test', 'targeted_test'].includes(capability) || !['high', 'medium'].includes(summary.parseConfidence)) return undefined;
  const keys = ['passed', 'failed', 'skipped', 'errors'] as const;
  if (!keys.some((key) => typeof summary[key] === 'number')) return undefined;
  return Object.fromEntries(keys.filter((key) => typeof summary[key] === 'number').map((key) => [key, summary[key]]));
}

export function verificationReceipt(item: LocatedExecution): VerificationReceipt {
  const capability = (['test', 'targeted_test', 'lint', 'build'].includes(item.metadata.capability) ? item.metadata.capability : 'test') as ReceiptExecutionType;
  const summary = item.result.summary ?? {};
  const tests = reliableTests(item, capability);
  const remaining = capability === 'test' ? ['targeted tests', 'lint', 'build'] : capability === 'targeted_test' ? ['full test suite', 'lint', 'build'] : capability === 'lint' ? ['tests', 'build'] : ['tests', 'lint'];
  if (!tests && (capability === 'test' || capability === 'targeted_test')) remaining.unshift('test counts');
  const incomplete = Boolean(item.result.log?.captureTruncated || summary.failingTestsTruncated || summary.parseConfidence === 'unknown' || item.result.resultStatus === 'partial' || item.result.resultStatus === 'unknown');
  return {
    receiptId: String(item.metadata.executionId ?? item.result.executionId),
    executionType: capability,
    commandCategory: capability,
    commandSummary: commandSummary(item),
    ...(typeof item.result.startedAt === 'string' || typeof item.metadata.startedAt === 'string' ? { startedAt: String(item.result.startedAt ?? item.metadata.startedAt) } : {}),
    ...(typeof item.result.finishedAt === 'string' ? { finishedAt: item.result.finishedAt } : {}),
    ...(typeof item.result.durationMs === 'number' ? { durationMs: item.result.durationMs } : {}),
    ...(typeof item.result.exitCode === 'number' ? { exitCode: item.result.exitCode } : {}),
    result: resultOf(item),
    ...(tests ? { tests } : {}),
    scope: capability === 'targeted_test' ? 'targeted' : 'repository',
    remainingUnverifiedAreas: remaining,
    evidenceReference: String(item.metadata.executionId ?? item.result.executionId),
    incomplete,
  };
}

export function verificationSummary(receipts: VerificationReceipt[]): VerificationSummary {
  const categories = {} as VerificationSummary['categories'];
  for (const capability of ['test', 'targeted_test', 'lint', 'build'] as const) {
    const receipt = receipts.find((item) => item.executionType === capability);
    categories[capability] = receipt ? { status: receipt.result, receiptId: receipt.receiptId } : { status: 'NOT_VERIFIED' };
  }
  return { categories, incomplete: receipts.some((receipt) => receipt.incomplete) };
}

export function renderVerificationReceiptMarkdown(receipt: VerificationReceipt): string {
  const tests = receipt.tests ? `\n- Tests: ${receipt.tests.passed ?? '?'} passed, ${receipt.tests.failed ?? '?'} failed, ${receipt.tests.skipped ?? '?'} skipped` : '';
  const exit = receipt.exitCode === undefined ? 'not recorded' : String(receipt.exitCode);
  return ['# Verification receipt', '', `- Result: **${receipt.result}**`, `- Type: ${receipt.executionType}`, `- Command: \`${receipt.commandSummary}\``, `- Exit code: ${exit}`, `- Duration: ${receipt.durationMs === undefined ? 'not recorded' : `${receipt.durationMs} ms`}`, `- Scope: ${receipt.scope}`, `- Evidence: ${receipt.evidenceReference}`, `- Incomplete: ${receipt.incomplete ? 'yes' : 'no'}`, ...tests ? [tests.trim()] : [], `- Remaining unverified: ${receipt.remainingUnverifiedAreas.join(', ') || 'none'}`].join('\n');
}
