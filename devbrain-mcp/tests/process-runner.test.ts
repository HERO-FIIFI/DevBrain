import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runProcess } from '../src/lib/process-runner.js';

const cwd = process.cwd();
describe('process runner', () => {
  it('captures success and arguments literally', async () => {
    const result = await runProcess({ executable: process.execPath, args: ['-e', 'console.log(process.argv[1])', '$(echo unsafe)'], cwd });
    expect(result.status).toBe('completed');
    expect(result.stdout.trim()).toBe('$(echo unsafe)');
  });
  it('reports nonzero exit', async () => expect((await runProcess({ executable: process.execPath, args: ['-e', 'process.exit(7)'], cwd })).exitCode).toBe(7));
  it('enforces timeout', async () => expect((await runProcess({ executable: process.execPath, args: ['-e', 'setTimeout(()=>{}, 5000)'], cwd, timeoutMs: 50 })).status).toBe('timeout'));
  it('enforces output bounds', async () => {
    const result = await runProcess({ executable: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(10000))'], cwd, maxStdoutBytes: 100 });
    expect(result.status).toBe('output_limit'); expect(Buffer.byteLength(result.stdout)).toBe(100);
  });
  it('terminates spawned workers on timeout', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-tree-')); const marker = path.join(temp, 'orphan.txt');
    const childCode = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan'),500)`;
    const parentCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}]);setTimeout(()=>{},5000)`;
    const result = await runProcess({ executable: process.execPath, args: ['-e', parentCode], cwd: temp, timeoutMs: 100 }); expect(result.status).toBe('timeout');
    await new Promise((resolve) => setTimeout(resolve, 700)); await expect(readFile(marker, 'utf8')).rejects.toThrow(); await rm(temp, { recursive: true, force: true });
  });
});
