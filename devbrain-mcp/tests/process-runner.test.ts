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
});
