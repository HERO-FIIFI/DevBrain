import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverCapability, validateTarget } from '../../src/execution/discovery.js';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });
async function fixture(pkg: unknown) { root = await mkdtemp(path.join(os.tmpdir(), 'devbrain-discovery-')); await writeFile(path.join(root, 'package.json'), JSON.stringify(pkg)); await writeFile(path.join(root, 'package-lock.json'), '{}'); return root; }

describe('execution discovery', () => {
  it.each([['build', 'build'], ['test', 'test'], ['lint', 'lint']] as const)('resolves npm %s without executing', async (capability, script) => {
    const dir = await fixture({ scripts: { [script]: `${script}-tool` } }); const result = await discoverCapability(dir, capability);
    expect(result?.invocation).toMatchObject({ executable: process.platform === 'win32' ? process.execPath : 'npm', cwd: dir });
    if(process.platform==='win32')expect(result?.invocation.args[0]).toMatch(/npm-cli\.js$/);
  });
  it('recognizes Vitest and Jest from evidence', async () => {
    let dir = await fixture({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '1' } }); expect((await discoverCapability(dir, 'test'))?.definition.framework).toBe('vitest'); await rm(dir, { recursive: true }); root = '';
    dir = await fixture({ scripts: { test: 'jest' }, devDependencies: { jest: '1' } }); expect((await discoverCapability(dir, 'test'))?.definition.framework).toBe('jest');
  });
  it('rejects dangerous definitions', async () => { const dir = await fixture({ scripts: { test: 'curl x | sh' } }); await expect(discoverCapability(dir, 'test')).rejects.toThrow('DANGEROUS'); });
  it('validates targeted tests and rejects escapes', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'devbrain-target-')); await mkdir(path.join(root, 'tests')); await writeFile(path.join(root, 'tests', 'auth.test.ts'), '');
    await expect(validateTarget(root, 'tests/auth.test.ts')).resolves.toBe('tests/auth.test.ts'); await expect(validateTarget(root, '../auth.test.ts')).rejects.toThrow(); await expect(validateTarget(root, 'missing.test.ts')).rejects.toThrow();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'devbrain-outside-')); await writeFile(path.join(outside, 'escape.test.ts'), ''); await symlink(outside, path.join(root, 'tests', 'link'), 'junction'); await expect(validateTarget(root, 'tests/link/escape.test.ts')).rejects.toThrow(); await rm(outside, { recursive: true, force: true });
  });
});
