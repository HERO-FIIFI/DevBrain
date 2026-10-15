import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { safeError } from './redaction.js';

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => { /* best effort; direct kill below remains */ });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } }
  }
}

export interface ProcessOptions {
  executable: string;
  args?: string[];
  cwd: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  status: 'completed' | 'failed' | 'timeout' | 'output_limit' | 'error';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
  error?: string;
}

export async function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  const cwd = await realpath(options.cwd);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const stdoutLimit = options.maxStdoutBytes ?? 1_000_000;
  const stderrLimit = options.maxStderrBytes ?? 250_000;

  return new Promise((resolve) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let timedOut = false;
    let outputTruncated = false;
    let settled = false;
    let child;
    try {
      child = spawn(options.executable, options.args ?? [], {
        cwd, shell: false, windowsHide: true,
        detached: process.platform !== 'win32',
        env: options.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ status: 'error', exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false, error: safeError(error) });
      return;
    }

    const finish = (result: ProcessResult) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(result); }
    };
    const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>, limit: number): Buffer<ArrayBufferLike> => {
      if (current.length >= limit) return current;
      return Buffer.concat([current, chunk.subarray(0, limit - current.length)]);
    };
    const enforceLimit = () => {
      if (!outputTruncated) { outputTruncated = true; killTree(child.pid); child.kill('SIGKILL'); }
    };
    child.stdout.on('data', (chunk: Buffer) => {
      const exceeded = stdout.length + chunk.length > stdoutLimit;
      stdout = append(stdout, chunk, stdoutLimit);
      if (exceeded) enforceLimit();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const exceeded = stderr.length + chunk.length > stderrLimit;
      stderr = append(stderr, chunk, stderrLimit);
      if (exceeded) enforceLimit();
    });
    child.on('error', (error) => finish({ status: 'error', exitCode: null, signal: null, stdout: stdout.toString(), stderr: stderr.toString(), timedOut, outputTruncated, error: safeError(error) }));
    child.on('close', (exitCode, signal) => finish({
      status: timedOut ? 'timeout' : outputTruncated ? 'output_limit' : exitCode === 0 ? 'completed' : 'failed',
      exitCode, signal, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), timedOut, outputTruncated,
    }));
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); child.kill('SIGKILL'); }, timeoutMs);
  });
}
