import { runProcess } from '../process-runner.js';
import type { CheckResult } from './types.js';

export async function jsonCommandCheck(root: string, executable: string, args: string[], source: string, parse: (value: any) => unknown[]): Promise<CheckResult> {
  const result = await runProcess({ executable, args, cwd: root, timeoutMs: 30_000, maxStdoutBytes: 2_000_000 });
  if (result.status === 'timeout') return { status: 'offline', networkUsed: true, networkAvailable: false, source, reason: 'Command timed out' };
  if (result.status === 'error') return { status: 'unsupported', networkUsed: false, networkAvailable: null, source, reason: result.error };
  try {
    const value = JSON.parse(result.stdout || '{}');
    return { status: result.status === 'completed' || result.exitCode === 1 ? 'complete' : 'partial', networkUsed: true, networkAvailable: true, source, findings: parse(value) };
  } catch {
    const offline = /network|enotfound|econn|timed?\s*out|registry/i.test(result.stderr);
    const unavailable = /not recognized|not found|no module named|enoent/i.test(result.stderr);
    return { status: unavailable ? 'unsupported' : offline ? 'offline' : 'error', networkUsed: !unavailable, networkAvailable: unavailable ? null : !offline, source, reason: unavailable ? 'Required executable is unavailable' : offline ? 'Registry unavailable' : 'Invalid command output' };
  }
}
