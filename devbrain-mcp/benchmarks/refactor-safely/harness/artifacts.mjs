// Write-once, hash-addressed run evidence. Raw artifacts are created exclusively (O_EXCL), fsynced, hashed into a
// sidecar, and made read-only. Derived artifacts must cite the raw hashes and parser version they came from.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { chmod, mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX64 = /^[0-9a-f]{64}$/;

// Flat basenames only: no separators, no traversal, no drive letters.
function assertName(name) {
  if (typeof name !== 'string' || name.length === 0 || name === '.' || name === '..' || /[\\/:]/.test(name)) throw new Error(`INVALID_ARTIFACT_NAME: ${JSON.stringify(name)}`);
}

async function writeExclusive(file, bytes) {
  let handle;
  try { handle = await open(file, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw new Error(`ARTIFACT_ALREADY_EXISTS: ${path.basename(file)}`, { cause: error }); throw error; }
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  // ponytail: read-only mode is defence in depth; exclusive create + hash verification are the portable controls.
  await chmod(file, 0o444).catch(() => {});
}

export class ArtifactStore {
  /** @param {string} root run directory that receives `raw/` and `derived/` */
  constructor(root) { this.root = root; this.raw = path.join(root, 'raw'); this.derived = path.join(root, 'derived'); }

  static async open(root) { const store = new ArtifactStore(root); await mkdir(store.raw, { recursive: true }); await mkdir(store.derived, { recursive: true }); return store; }

  rawPath(name) { assertName(name); return path.join(this.raw, name); }

  async createRaw(name, content) {
    const file = this.rawPath(name), bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'), hash = sha256(bytes);
    await writeExclusive(file, bytes);
    await writeExclusive(`${file}.sha256`, Buffer.from(`${hash}\n`, 'utf8'));
    return { name, path: file, bytes: bytes.length, sha256: hash };
  }

  /** Exclusive streaming sink for process output; `finalize()` flushes, hashes, writes the sidecar, and seals it. */
  async openRawSink(name) {
    const file = this.rawPath(name);
    let handle;
    try { handle = await open(file, 'wx'); } catch (error) { if (error.code === 'EEXIST') throw new Error(`ARTIFACT_ALREADY_EXISTS: ${name}`, { cause: error }); throw error; }
    const stream = handle.createWriteStream({ flush: true });
    let bytes = 0;
    const write = (chunk) => new Promise((resolve, reject) => { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'); bytes += buffer.length; stream.write(buffer, (error) => (error ? reject(error) : resolve())); });
    let finalized = null;
    const finalize = async () => {
      if (finalized) return finalized;
      finalized = (async () => {
        await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));
        const hash = sha256(await readFile(file));
        await writeExclusive(`${file}.sha256`, Buffer.from(`${hash}\n`, 'utf8'));
        await chmod(file, 0o444).catch(() => {});
        return { name, path: file, bytes, sha256: hash };
      })();
      return finalized;
    };
    return { name, path: file, write, finalize, get bytes() { return bytes; } };
  }

  /** Recomputes the hash of the raw bytes and compares it with the sidecar written at creation. */
  async verify(name) {
    const file = this.rawPath(name);
    const [bytes, sidecar] = await Promise.all([readFile(file), readFile(`${file}.sha256`, 'utf8')]);
    const actual = sha256(bytes), expected = sidecar.trim();
    return { valid: actual === expected && HEX64.test(expected), bytes: bytes.length, sha256: actual };
  }

  /** Sorted hash manifest of every raw artifact; suitable for `raw/artifact-hashes.json`. */
  async manifest() {
    const names = (await readdir(this.raw)).filter((name) => !name.endsWith('.sha256')).sort();
    return Promise.all(names.map(async (name) => { const { bytes, sha256: hash } = await this.verify(name); return { name, bytes, sha256: hash }; }));
  }

  async createDerived(name, value, provenance) {
    assertName(name);
    if (!provenance || typeof provenance.parserVersion !== 'string' || !provenance.parserVersion) throw new Error('DERIVED_REQUIRES_PARSER_VERSION');
    if (!Array.isArray(provenance.raw)) throw new Error('DERIVED_REQUIRES_RAW_CITATIONS');
    for (const cited of provenance.raw) {
      const verified = await this.verify(cited.name).catch((error) => { if (error.code === 'ENOENT') throw new Error(`RAW_ARTIFACT_MISSING: ${cited.name}`); throw error; });
      if (!verified.valid || verified.sha256 !== cited.sha256) throw new Error(`RAW_HASH_MISMATCH: ${cited.name}`);
    }
    const file = path.join(this.derived, name), bytes = Buffer.from(`${JSON.stringify({ provenance, value }, null, 2)}\n`, 'utf8');
    await writeExclusive(file, bytes);
    return { name, path: file, bytes: bytes.length, sha256: sha256(bytes) };
  }
}
