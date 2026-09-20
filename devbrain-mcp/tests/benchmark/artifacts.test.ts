import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../benchmarks/refactor-safely/harness/artifacts.mjs';

let temp = '';
let store: any;
beforeEach(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-artifacts-')); store = await ArtifactStore.open(path.join(temp, 'run')); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

describe('immutable artifact store', () => {
  it('creates a raw artifact once and refuses replacement', async () => {
    const created = await store.createRaw('codex-events.jsonl', '{"type":"thread.started"}\n');
    expect(created).toMatchObject({ name: 'codex-events.jsonl', bytes: 26, sha256: createHash('sha256').update('{"type":"thread.started"}\n').digest('hex') });
    await expect(store.createRaw('codex-events.jsonl', 'replacement')).rejects.toThrow('ARTIFACT_ALREADY_EXISTS');
    expect(await readFile(path.join(temp, 'run', 'raw', 'codex-events.jsonl'), 'utf8')).toBe('{"type":"thread.started"}\n');
  });
  it('writes a sha256 sidecar matching the literal bytes and verifies it', async () => {
    await store.createRaw('codex-events.jsonl', '{"type":"thread.started"}\n');
    const sidecar = (await readFile(path.join(temp, 'run', 'raw', 'codex-events.jsonl.sha256'), 'utf8')).trim();
    expect(sidecar).toBe(createHash('sha256').update('{"type":"thread.started"}\n').digest('hex'));
    expect(await store.verify('codex-events.jsonl')).toEqual({ valid: true, bytes: 26, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
  it('detects tampering with raw bytes', async () => {
    await store.createRaw('codex-stderr.log', 'original\n');
    const file = path.join(temp, 'run', 'raw', 'codex-stderr.log');
    await import('node:fs/promises').then(({ chmod, writeFile }) => chmod(file, 0o644).then(() => writeFile(file, 'tampered\n')));
    expect(await store.verify('codex-stderr.log')).toMatchObject({ valid: false });
  });
  it('rejects names that leave the raw directory', async () => {
    for (const name of ['../escape.json', 'nested/child.json', '', 'C:\\abs.json']) await expect(store.createRaw(name, 'x')).rejects.toThrow('INVALID_ARTIFACT_NAME');
  });
  it('makes raw artifacts read-only where the platform supports it', async () => {
    await store.createRaw('invocation.json', '{}');
    const mode = (await stat(path.join(temp, 'run', 'raw', 'invocation.json'))).mode & 0o222;
    expect(mode).toBe(0);
  });
  it('derived records must name raw hashes and a parser version', async () => {
    const raw = await store.createRaw('codex-events.jsonl', '{"type":"thread.started"}\n');
    const derived = await store.createDerived('run-record.json', { calls: 1 }, { parserVersion: 'events@1', raw: [{ name: 'codex-events.jsonl', sha256: raw.sha256 }], rule: 'count thread.started' });
    const written = JSON.parse(await readFile(path.join(temp, 'run', 'derived', 'run-record.json'), 'utf8'));
    expect(written).toEqual({ provenance: { parserVersion: 'events@1', raw: [{ name: 'codex-events.jsonl', sha256: raw.sha256 }], rule: 'count thread.started' }, value: { calls: 1 } });
    expect(derived.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(store.createDerived('run-record.json', {}, { parserVersion: 'events@2', raw: [] })).rejects.toThrow('ARTIFACT_ALREADY_EXISTS');
  });
  it('refuses derived provenance that cites a missing or mismatched raw hash', async () => {
    await store.createRaw('codex-events.jsonl', 'a\n');
    await expect(store.createDerived('bad.json', {}, { raw: [{ name: 'codex-events.jsonl', sha256: 'f'.repeat(64) }] })).rejects.toThrow('DERIVED_REQUIRES_PARSER_VERSION');
    await expect(store.createDerived('bad.json', {}, { parserVersion: 'x@1', raw: [{ name: 'codex-events.jsonl', sha256: 'f'.repeat(64) }] })).rejects.toThrow('RAW_HASH_MISMATCH');
    await expect(store.createDerived('bad.json', {}, { parserVersion: 'x@1', raw: [{ name: 'missing.jsonl', sha256: 'f'.repeat(64) }] })).rejects.toThrow('RAW_ARTIFACT_MISSING');
  });
  it('lists a hash manifest of every raw artifact', async () => {
    await store.createRaw('b.json', '2');
    await store.createRaw('a.json', '1');
    expect(await store.manifest()).toEqual([{ name: 'a.json', bytes: 1, sha256: createHash('sha256').update('1').digest('hex') }, { name: 'b.json', bytes: 1, sha256: createHash('sha256').update('2').digest('hex') }]);
  });
});
