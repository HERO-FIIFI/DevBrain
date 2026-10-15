// Deterministic task fixtures: load a manifest, materialize its repository byte-for-byte (LF), commit it with a fixed
// identity and timestamp, and hash the result so two conditions can prove they started from the same bytes.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';

export const TASKS_ROOT = fileURLToPath(new URL('../tasks/', import.meta.url));
const TASK_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.devbrain']);
const REQUIRED_FIELDS = ['taskId', 'visiblePrompt', 'allowedChangedFiles', 'requiredChangedFiles', 'targetedCommand', 'lintCommand', 'buildCommand', 'fullRegressionCommand'];
const FIXED_GIT = { GIT_AUTHOR_NAME: 'DevBrain Benchmark', GIT_AUTHOR_EMAIL: 'benchmark@devbrain.invalid', GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_NAME: 'DevBrain Benchmark', GIT_COMMITTER_EMAIL: 'benchmark@devbrain.invalid', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z' };

/** @param {string} taskId a task identifier under `tasks/`, or an absolute path to a task directory */
export async function loadTask(taskId) {
  let root;
  if (path.isAbsolute(taskId)) root = taskId;
  else { if (!TASK_ID.test(taskId)) throw new Error(`INVALID_TASK_ID: ${JSON.stringify(taskId)}`); root = path.join(TASKS_ROOT, taskId); }
  const manifestFile = path.join(root, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw new Error(`TASK_NOT_FOUND: ${taskId}`, { cause: error }); throw error; }
  for (const field of REQUIRED_FIELDS) if (!(field in manifest)) throw new Error(`MANIFEST_MISSING_FIELD: ${field}`);
  return { ...manifest, root, repositoryRoot: path.join(root, 'repository') };
}

/** Sorted POSIX-relative file paths, excluding VCS/dependency/benchmark directories. */
export async function listFiles(root) {
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!EXCLUDED_DIRS.has(entry.name)) await walk(relative); } else if (entry.isFile()) files.push(relative);
    }
  };
  await walk('');
  return files.sort();
}

/** SHA-256 over `path NUL length NUL bytes` for every file in sorted order. */
export async function canonicalRepositoryHash(root) {
  const files = await listFiles(root), hash = createHash('sha256');
  for (const file of files) { const bytes = await readFile(path.join(root, file)); hash.update(file, 'utf8').update('\0').update(String(bytes.length)).update('\0').update(bytes); }
  return { contentSha256: hash.digest('hex'), files };
}

const EMPTY_GITCONFIG = path.join(os.tmpdir(), 'devbrain-benchmark-empty.gitconfig');

// Fixed identity/dates plus isolation from user/system Git configuration so the initial commit hashes identically anywhere.
async function git(cwd, args) {
  await writeFile(EMPTY_GITCONFIG, '', { flag: 'a' });
  const env = { ...process.env, ...FIXED_GIT, GIT_CONFIG_GLOBAL: EMPTY_GITCONFIG, GIT_CONFIG_NOSYSTEM: '1' };
  const result = await runCommand({ executable: 'git', args }, cwd, { env });
  if (result.exitCode !== 0) throw new Error(`GIT_FAILED: git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout;
}

/** Copies the task repository with LF bytes, commits it once, and returns the baseline snapshot. */
export async function materializeTask(task, destination) {
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length > 0) throw new Error(`DESTINATION_NOT_EMPTY: ${destination}`);
  for (const file of await listFiles(task.repositoryRoot)) {
    const target = path.join(destination, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    // ponytail: fixtures are text-only; CRLF from an autocrlf checkout is normalized so hashes do not depend on the host.
    await writeFile(target, Buffer.from((await readFile(path.join(task.repositoryRoot, file), 'utf8')).replace(/\r\n/g, '\n'), 'utf8'));
  }
  for (const args of [['init', '-q', '-b', 'main', '--template='], ['config', 'core.autocrlf', 'false'], ['config', 'core.filemode', 'false'], ['config', 'commit.gpgsign', 'false'], ['add', '-A'], ['commit', '-q', '--no-verify', '-m', `benchmark baseline: ${task.taskId}`]]) await git(destination, args);
  return snapshotRepository(destination);
}

export async function snapshotRepository(root) {
  const { contentSha256, files } = await canonicalRepositoryHash(root);
  const repositorySha = (await git(root, ['rev-parse', 'HEAD'])).trim();
  const status = (await git(root, ['status', '--porcelain'])).trim() === '' ? 'clean' : 'dirty';
  return { repositorySha, contentSha256, files, status };
}

/** Files whose text carries the identifier as a whole word; `validateTokenFormat` does not match `validateToken`. */
export async function scopedReferenceFiles(root, identifier) {
  const pattern = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const matches = [];
  for (const file of await listFiles(root)) if (pattern.test(await readFile(path.join(root, file), 'utf8'))) matches.push(file);
  return matches;
}

/** Runs one command without a shell; `node` resolves to the current executable. Never throws on a non-zero exit. */
export function runCommand({ executable, args }, cwd, { env = process.env, timeoutMs = 120_000 } = {}) {
  const file = executable === 'node' ? process.execPath : executable;
  return new Promise((resolve, reject) => {
    const started = Date.now(), child = spawn(file, args, { cwd, env, shell: false, windowsHide: true });
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ executable: file, args, cwd, exitCode: code, signal, stdout, stderr, timedOut, durationMs: Date.now() - started }); });
  });
}

export const runManifestCommand = (task, commandKey, cwd, options) => runCommand(task[commandKey], cwd, options);
