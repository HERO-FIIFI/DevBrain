import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { contextRoot, repositoryFiles } from './repository.js';
import { executionsDirectory, readJson } from '../execution/home.js';
import { gitProvenance } from '../execution/evidence.js';
import { repositoryIdentity } from '../execution/trust/repository-identity.js';
import { locateExecution } from './execution-evidence.js';
import { verificationReceipt, type VerificationReceipt } from './verification-receipt.js';
import { byteSlice } from './repository.js';
import { findTodos } from '../tools/find-todos.js';
import { git } from '../lib/git.js';
import { redactString } from '../lib/redaction.js';

export const sessionHandoffOptions = z.object({
  mode: z.enum(['compact', 'detailed']).default('compact'),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
  recentCommits: z.number().int().min(0).max(20).default(5),
});

export const sessionHandoffOutput = z.object({
  status: z.enum(['complete', 'partial', 'error']),
  mode: z.enum(['compact', 'detailed']).optional(),
  markdown: z.string().optional(),
  estimatedTokens: z.number().int().optional(),
  estimationMethod: z.string().optional(),
  truncated: z.boolean().optional(),
  omissions: z.array(z.string()).optional(),
  errorCode: z.string().optional(),
  message: z.string().optional(),
});

export type SessionHandoffOptions = z.input<typeof sessionHandoffOptions> & { path?: string };
type Change = { path: string; staged: boolean; unstaged: boolean; kind: 'added' | 'modified' | 'deleted' | 'untracked' };
type Evidence = { receipt: VerificationReceipt; freshness: 'CURRENT' | 'STALE' | 'UNKNOWN' };

const estimateTokens = (value: string) => Math.ceil(Buffer.byteLength(value, 'utf8') / 4);
const safe = (value: string) => redactString(value).replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'<>]+/g, '[PATH]');
const rel = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '');

function parseStatus(stdout: string): Change[] {
  const changes: Change[] = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const code = line.slice(0, 2);
    const raw = line.slice(3).split('\t').at(-1) ?? line.slice(3);
    const file = safe(rel(raw));
    if (!file) continue;
    const untracked = code === '??';
    const staged = !untracked && code[0] !== ' ';
    const unstaged = !untracked && code[1] !== ' ';
    const kind = untracked || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified';
    changes.push({ path: file, staged, unstaged, kind: untracked ? 'untracked' : kind });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function shortStat(value: string): string {
  const line = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  return line ? safe(line) : 'none';
}

async function recentCommits(root: string, limit: number): Promise<string[]> {
  if (!limit) return [];
  const result = await git(root, ['log', `-${limit}`, '--format=%h%x1f%aI%x1f%s']);
  if (result.status !== 'completed') return [];
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, date, message] = line.split('\x1f');
    return `${sha} ${date} ${safe(message ?? '')}`.trim();
  });
}

async function taskReferences(root: string): Promise<string[]> {
  const listing = await repositoryFiles(root, true);
  return listing.files.filter((file) => {
    const lower = file.toLowerCase();
    return lower.startsWith('tasks/') || lower.includes('/plans/') || lower.endsWith('/plan.md') || lower.endsWith('/todo.md') || lower === 'plan.md' || lower === 'todo.md';
  }).sort();
}

async function latestEvidence(root: string, current: Awaited<ReturnType<typeof gitProvenance>>): Promise<Evidence[]> {
  let identity: Awaited<ReturnType<typeof repositoryIdentity>>;
  try { identity = await repositoryIdentity(root); } catch { return []; }
  let ids: string[];
  try { ids = await readdir(path.join(executionsDirectory(), identity.repositoryId)); } catch { return []; }
  const records: Array<{ id: string; capability: string; timestamp: string }> = [];
  for (const id of ids.filter((value) => /^exec_[A-Za-z0-9_-]{8,200}$/.test(value))) {
    const metadata = await readJson<Record<string, any> | null>(path.join(executionsDirectory(), identity.repositoryId, id, 'metadata.json'), null);
    const result = await readJson<Record<string, any> | null>(path.join(executionsDirectory(), identity.repositoryId, id, 'result.json'), null);
    if (!metadata || !result) continue;
    records.push({ id, capability: String(metadata.capability ?? ''), timestamp: String(result.finishedAt ?? metadata.startedAt ?? '') });
  }
  const selected = (['test', 'targeted_test', 'lint', 'build'] as const).map((capability) => records.filter((item) => item.capability === capability).sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))[0]).filter(Boolean);
  const output: Evidence[] = [];
  for (const item of selected) {
    try {
      const located = await locateExecution(item.id);
      const receipt = verificationReceipt(located);
      const source = located.metadata.git;
      const sameDirtySnapshot = source?.dirty === current.dirty
        && (typeof source?.dirtyFileCount !== 'number' || source.dirtyFileCount === current.dirtyFileCount);
      const freshness = typeof source?.sha === 'string' && current.sha
        ? source.sha !== current.sha ? 'STALE' : (sameDirtySnapshot ? 'CURRENT' : 'STALE')
        : 'UNKNOWN';
      output.push({ receipt, freshness });
    } catch { /* evidence is optional and may be incomplete */ }
  }
  return output;
}

function changesSection(changes: Change[], detailed: boolean): string {
  const groups = ['added', 'modified', 'deleted', 'untracked'] as const;
  const lines = ['## Changes'];
  const staged = changes.filter((item) => item.staged).map((item) => item.path);
  const unstaged = changes.filter((item) => item.unstaged).map((item) => item.path);
  const untracked = changes.filter((item) => item.kind === 'untracked').map((item) => item.path);
  if (staged.length) lines.push(`- Staged: ${staged.join(', ')}`);
  if (unstaged.length) lines.push(`- Unstaged: ${unstaged.join(', ')}`);
  if (untracked.length) lines.push(`- Untracked: ${untracked.join(', ')}`);
  for (const group of groups) {
    const entries = changes.filter((item) => item.kind === group);
    if (!entries.length) continue;
    lines.push(`- ${group[0].toUpperCase()}${group.slice(1)}: ${entries.map((item) => `${item.path}${item.staged ? ' [staged]' : ''}${item.unstaged ? ' [unstaged]' : ''}`).join(', ')}`);
  }
  if (!changes.length) lines.push('- None');
  return detailed ? lines.join('\n') : lines.slice(0, 3).join('\n');
}

function evidenceSection(evidence: Evidence[]): string {
  const lines = ['## Verification evidence'];
  if (!evidence.length) return `${lines.join('\n')}\n- No recorded test, lint, or build evidence found; freshness UNKNOWN.`;
  for (const item of evidence.sort((a, b) => a.receipt.executionType.localeCompare(b.receipt.executionType))) {
    const receipt = item.receipt;
    lines.push(`- ${receipt.executionType}: **${receipt.result}** (${item.freshness}), evidence ${safe(receipt.evidenceReference)}, timestamp ${safe(receipt.finishedAt ?? receipt.startedAt ?? 'UNKNOWN')}${receipt.incomplete ? ', incomplete' : ''}${receipt.exitCode === undefined ? '' : `, exit ${receipt.exitCode}`}`);
  }
  return lines.join('\n');
}

function render(input: { root: string; current: Awaited<ReturnType<typeof gitProvenance>>; changes: Change[]; todos: Awaited<ReturnType<typeof findTodos>>; tasks: string[]; commits: string[]; evidence: Evidence[]; mode: 'compact' | 'detailed'; diff: string; maxTokens?: number }): { markdown: string; estimatedTokens: number; truncated: boolean; omissions: string[] } {
  const branch = input.current.branch ?? 'detached HEAD';
  const rootName = path.basename(input.root);
  const dirtyWarning = input.current.dirty ? 'Working tree: DIRTY — review changes before continuing.' : 'Working tree: clean';
  const workspaceRoot = process.env.DEVBRAIN_WORKSPACE_ROOT;
  const relativeRoot = workspaceRoot ? path.relative(workspaceRoot, input.root) : rootName;
  const rootIdentifier = !relativeRoot || relativeRoot.startsWith('..') ? rootName : relativeRoot;
  const identity = ['# Session handoff', '', '## Repository', `- Name: ${safe(rootName)}`, `- Branch: ${safe(branch)}`, `- HEAD: ${safe(input.current.sha?.slice(0, 12) ?? 'UNKNOWN')}`, `- Root: ${safe(rel(rootIdentifier))}`, `- ${dirtyWarning}`, `- Snapshot: ${new Date().toISOString()}`].join('\n');
  const todoCount = 'totalCount' in input.todos ? input.todos.totalCount : undefined;
  const todoFindings = todoCount === undefined ? 'TODO scan: UNKNOWN' : todoCount ? `TODO/FIXME markers: ${todoCount}${input.mode === 'detailed' ? ` (${(('findings' in input.todos ? input.todos.findings : []) ?? []).map((item: Record<string, unknown>) => `${String(item.file)}:${String(item.line)} ${String(item.tag)}`).join(', ')})` : ''}` : 'TODO/FIXME markers: none';
  const work = ['## Work in progress', `- ${todoFindings}`, `- Task/plan references: ${input.tasks.length ? input.tasks.join(', ') : 'none found; task state UNKNOWN'}`, `- Uncommitted implementation areas: ${input.changes.length ? input.changes.map((item) => item.path).join(', ') : 'none'}`, `- Recent history: ${input.commits.length ? 'available' : 'No history available'}`].join('\n');
  const changes = `${changesSection(input.changes, input.mode === 'detailed')}\n- Diff summary: ${input.diff}`;
  const commits = input.commits.length ? `## Recent commits\n${input.commits.map((item) => `- ${item}`).join('\n')}` : '## Recent commits\n- No history available.';
  const guidance = ['## Resume guidance', ...(input.current.dirty ? ['- Review uncommitted changes and staged boundaries before editing.'] : []), ...(input.evidence.some((item) => item.receipt.result === 'FAILED') ? ['- Investigate failed verification evidence before claiming readiness.'] : []), ...(input.evidence.length < 3 ? ['- Run missing verification checks (tests, lint, or build).'] : []), ...(input.tasks.length ? ['- Continue the referenced task or plan documents.'] : []), ...(todoCount ? ['- Review outstanding TODO/FIXME markers.'] : [])];
  const sections = [identity, changes, work, evidenceSection(input.evidence), ...(input.mode === 'detailed' ? [commits] : []), guidance.join('\n')];
  const omissions: string[] = [];
  let markdown = sections.join('\n\n');
  if (input.maxTokens !== undefined && estimateTokens(markdown) > input.maxTokens) {
    omissions.push('recent commits');
    markdown = [identity, evidenceSection(input.evidence), work, guidance.join('\n'), '## Omissions', '- Recent commit details and lower-priority change details were omitted by the size budget.'].join('\n\n');
    if (estimateTokens(markdown) > input.maxTokens) {
      omissions.push('detailed work-in-progress references');
      markdown = [identity, evidenceSection(input.evidence), '## Omissions', '- Work-in-progress details were omitted by the size budget.'].join('\n\n');
    }
    if (estimateTokens(markdown) > input.maxTokens) {
      omissions.push('additional handoff details');
      const bounded = byteSlice(markdown, Math.max(160, input.maxTokens * 4));
      markdown = `${bounded.value}\n\n## Omissions\n- Additional handoff details were truncated by the size budget.`;
    }
  }
  return { markdown, estimatedTokens: estimateTokens(markdown), truncated: omissions.length > 0, omissions };
}

export async function sessionHandoff(input: SessionHandoffOptions) {
  try {
    const options = sessionHandoffOptions.parse(input);
    const root = await contextRoot(input.path);
    if (!root.gitRepository) throw new Error('SESSION_HANDOFF_REQUIRES_GIT_REPOSITORY');
    const [current, status, diff, commits, tasks, todos] = await Promise.all([
      gitProvenance(root.repositoryRoot),
      git(root.repositoryRoot, ['status', '--porcelain=v1']),
      git(root.repositoryRoot, ['diff', '--shortstat', 'HEAD', '--']),
      recentCommits(root.repositoryRoot, options.recentCommits),
      taskReferences(root.repositoryRoot),
      findTodos({ path: root.repositoryRoot, limit: options.mode === 'detailed' ? 100 : 20 }),
    ]);
    const actualEvidence = await latestEvidence(root.repositoryRoot, current);
    const changes = status.status === 'completed' ? parseStatus(status.stdout) : [];
    const rendered = render({ root: root.repositoryRoot, current, changes, todos, tasks, commits, evidence: actualEvidence, mode: options.mode, diff: diff.status === 'completed' ? shortStat(diff.stdout) : 'UNKNOWN', maxTokens: options.maxTokens });
    return { status: rendered.truncated ? 'partial' as const : 'complete' as const, mode: options.mode, ...rendered, estimationMethod: 'utf8_bytes_div_4' };
  } catch (error) {
    return { status: 'error' as const, errorCode: 'SESSION_HANDOFF_FAILED', message: safe(String(error)) };
  }
}
