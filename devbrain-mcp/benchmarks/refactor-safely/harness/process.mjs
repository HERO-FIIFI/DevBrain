// Run layout, hidden-evaluator isolation, and the agent process runner. The agent's cwd is the materialized
// repository alone; everything else (artifacts, codex home, DevBrain home, canary) lives beside it, never inside.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';

export const EVALUATOR_ROOT = fileURLToPath(new URL('../evaluators/', import.meta.url)).replace(/[\\/]$/, '');
const EVALUATOR_HINTS = ['refactor-safely/evaluators', 'refactor-safely\\evaluators', 'hidden-evaluation'];

export async function createRunLayout(root) {
  const layout = { root, repository: path.join(root, 'repository'), codexHome: path.join(root, 'codex-home'), devbrainHome: path.join(root, 'devbrain-home'), artifacts: path.join(root, 'artifacts'), hidden: path.join(root, 'hidden') };
  for (const dir of Object.values(layout)) await mkdir(dir, { recursive: true });
  return layout;
}

/** The visible prompt must not point at evaluators or the canary; the agent learns the task, not the grader. */
export function assertPromptIsolation(prompt) {
  const text = String(prompt);
  if (text.includes(EVALUATOR_ROOT) || text.includes(EVALUATOR_ROOT.replaceAll('\\', '/')) || EVALUATOR_HINTS.some((hint) => text.includes(hint))) throw new Error('PROMPT_REFERENCES_EVALUATOR');
  if (/hidden[\\/]canary/.test(text)) throw new Error('PROMPT_REFERENCES_CANARY');
  return { status: 'clean' };
}

/** Random content beside the repository: any agent event that echoes it proves the agent looked outside its cwd. */
export async function plantCanary(layout) {
  const token = randomBytes(16).toString('hex'), file = path.join(layout.hidden, `canary-${token.slice(0, 8)}.txt`);
  await writeFile(file, `benchmark canary ${token}\n`, { flag: 'wx' });
  return { path: file, token };
}

/** Scans raw events and stderr for the canary token/path, evaluator paths, and the hidden directory. */
export function auditIsolation({ rawEvents, stderr = '', canary, layout }) {
  const findings = [];
  const evaluatorForms = [EVALUATOR_ROOT, EVALUATOR_ROOT.replaceAll('\\', '/'), ...EVALUATOR_HINTS];
  const canaryPathForms = canary ? [canary.path, canary.path.replaceAll('\\', '/'), canary.path.replaceAll('\\', '\\\\')] : [];
  const hiddenForms = layout ? [layout.hidden, layout.hidden.replaceAll('\\', '/'), layout.hidden.replaceAll('\\', '\\\\'), '../hidden', '..\\hidden', '..\\\\hidden'] : ['../hidden'];
  const scan = (text, where) => text.split('\n').forEach((line, index) => {
    if (!line) return;
    const record = (kind, needle) => findings.push({ kind, where, lineNumber: index + 1, needle });
    if (canary && line.includes(canary.token)) record('canary_token', canary.token);
    else if (canaryPathForms.some((form) => line.includes(form))) record('canary_path', canary.path);
    else if (evaluatorForms.some((form) => line.includes(form))) record('evaluator_path', 'evaluators');
    else if (hiddenForms.some((form) => line.includes(form))) record('hidden_directory', 'hidden');
  });
  scan(rawEvents ?? '', 'events'); scan(stderr, 'stderr');
  return findings.length ? { status: 'ISOLATION_VIOLATION', findings } : { status: 'clean', findings: [] };
}

function killTree(child) {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    const fallback = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 1_000);
    killer.on('error', () => { clearTimeout(fallback); child.kill('SIGKILL'); });
    killer.on('close', (code) => { if (code === 0) clearTimeout(fallback); else { clearTimeout(fallback); child.kill('SIGKILL'); } });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

/**
 * Spawns the agent without a shell, streams stdout/stderr into the given raw sinks, and enforces a hard timeout by
 * terminating the whole process tree. Partial output already written to the sinks is retained on timeout.
 */
export function spawnCodex(invocation, sinks) {
  const executable = invocation.executable === 'node' ? process.execPath : invocation.executable;
  return new Promise((resolve, reject) => {
    const startedAt = new Date(), started = Date.now();
    let child;
    try { child = spawn(executable, invocation.args, { cwd: invocation.cwd, env: invocation.env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { reject(new Error(`SPAWN_FAILED: ${error.message}`, { cause: error })); return; }
    let timedOut = false, stdoutBytes = 0, stderrBytes = 0;
    const pending = [];
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, invocation.timeoutMs);
    child.stdout.on('data', (chunk) => { stdoutBytes += chunk.length; pending.push(sinks.stdout.write(chunk)); });
    child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; pending.push(sinks.stderr.write(chunk)); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`SPAWN_FAILED: ${error.message}`, { cause: error })); });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      await Promise.allSettled(pending);
      const endedAt = new Date();
      resolve({ pid: child.pid ?? null, exitCode: code, signal, timedOut, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationMs: Date.now() - started, stdoutBytes, stderrBytes });
    });
  });
}
