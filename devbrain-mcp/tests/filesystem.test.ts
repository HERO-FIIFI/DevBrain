import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalPath, resolveSafePath } from '../src/lib/filesystem.js';

describe('filesystem boundary', () => {
  it('accepts children and rejects traversal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devbrain-boundary-'));
    const child = path.join(root, 'child'); await mkdir(child);
    await expect(resolveSafePath(child, root)).resolves.toBe(await canonicalPath(child));
    await expect(resolveSafePath(path.dirname(root), root)).rejects.toThrow('outside permitted workspace');
  });
  it('rejects symlink escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devbrain-link-'));
    const link = path.join(root, 'escape'); await symlink(os.tmpdir(), link, 'junction');
    await expect(resolveSafePath(link, root)).rejects.toThrow('outside permitted workspace');
  });
});
