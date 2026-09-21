import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVBRAIN_ADMIN_ENTRY, DEVBRAIN_SERVER_ENTRY, callDevBrainTool, prepareDevBrainApprovals, treatmentCapabilities } from '../../benchmarks/refactor-safely/harness/approvals.mjs';
import { loadTask, materializeTask } from '../../benchmarks/refactor-safely/harness/fixtures.mjs';
import { createRunLayout } from '../../benchmarks/refactor-safely/harness/process.mjs';

let temp = '';
let layout: any;
let task: any;
beforeAll(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'devbrain-bench-approvals-')); layout = await createRunLayout(path.join(temp, 'run')); task = await loadTask('task-a'); await materializeTask(task, layout.repository); }, 60_000);
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

describe('treatment execution approvals through public DevBrain behavior', () => {
  it('derives the four capabilities from the task manifest', () => {
    expect(treatmentCapabilities(task)).toEqual([
      { capability: 'test', tool: 'devbrain_run_tests', args: {} },
      { capability: 'targeted_test', tool: 'devbrain_run_targeted_tests', args: { target: 'tests/visible/auth-service.test.js' } },
      { capability: 'lint', tool: 'devbrain_run_lint', args: {} },
      { capability: 'build', tool: 'devbrain_run_build', args: {} },
    ]);
    expect(path.basename(DEVBRAIN_SERVER_ENTRY)).toBe('index.js');
    expect(path.basename(DEVBRAIN_ADMIN_ENTRY)).toBe('admin.js');
  });
  it('requests approval_required from the built server, approves through the admin CLI, and never edits the store', async () => {
    const prepared = await prepareDevBrainApprovals({ task, repositoryRoot: layout.repository, workspaceRoot: layout.root, devbrainHome: layout.devbrainHome });
    expect(prepared.approvals.map((entry: any) => [entry.capability, entry.status])).toEqual([['test', 'approved'], ['targeted_test', 'approved'], ['lint', 'approved'], ['build', 'approved']]);
    for (const entry of prepared.approvals) { expect(entry.approvalId).toMatch(/^[A-Za-z0-9_-]+$/); expect(entry.requested.status).toBe('approval_required'); expect(entry.requested.approvalId).toBe(entry.approvalId); expect(entry.repositoryId).toBe(prepared.approvals[0].repositoryId); }
    expect(prepared.method).toEqual({ request: 'mcp stdio tools/call against dist/index.js', approve: 'node dist/admin.js approve <approval-id>', storeEdited: false });
    // The DevBrain home is run-private and now holds the registry and approval records written by DevBrain itself.
    expect((await readdir(layout.devbrainHome)).length).toBeGreaterThan(0);
    // A subsequent call is authorized and executes the fixture's own targeted test through the trusted path.
    const executed = await callDevBrainTool({ serverEntry: DEVBRAIN_SERVER_ENTRY, devbrainHome: layout.devbrainHome, workspaceRoot: layout.root, tool: 'devbrain_run_targeted_tests', args: { path: layout.repository, target: 'tests/visible/auth-service.test.js' } });
    expect(executed.structured).toMatchObject({ status: 'complete', authorizationStatus: 'authorized', executionStatus: 'completed', resultStatus: 'passed' });
  }, 120_000);
  it('fails loudly when a capability does not require approval as expected', async () => {
    await expect(prepareDevBrainApprovals({ task, repositoryRoot: layout.repository, workspaceRoot: layout.root, devbrainHome: layout.devbrainHome, capabilities: [{ capability: 'test', tool: 'devbrain_run_tests', args: {} }] })).rejects.toThrow('APPROVAL_NOT_REQUIRED: test');
  }, 60_000);
});
