// Treatment execution approvals prepared through DevBrain's own public surfaces: the built MCP server returns
// `approval_required`, and the separate `devbrain approve` administrative CLI grants it. The store is never edited.
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';
import { runCommand } from './fixtures.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const DEVBRAIN_SERVER_ENTRY = path.join(PACKAGE_ROOT, 'dist', 'index.js');
export const DEVBRAIN_ADMIN_ENTRY = path.join(PACKAGE_ROOT, 'dist', 'admin.js');

/** The four Phase 2 capabilities the treatment may exercise; the targeted test target comes from the manifest. */
export function treatmentCapabilities(task) {
  const target = task.targetedCommand.args.find((arg) => !arg.startsWith('-'));
  return [
    { capability: 'test', tool: 'devbrain_run_tests', args: {} },
    { capability: 'targeted_test', tool: 'devbrain_run_targeted_tests', args: { target } },
    { capability: 'lint', tool: 'devbrain_run_lint', args: {} },
    { capability: 'build', tool: 'devbrain_run_build', args: {} },
  ];
}

const devbrainEnv = ({ devbrainHome, workspaceRoot }) => ({ ...process.env, DEVBRAIN_HOME: devbrainHome, DEVBRAIN_WORKSPACE_ROOT: workspaceRoot });

/** Minimal newline-delimited JSON-RPC client for one `tools/call` against the built stdio server. */
export function callDevBrainTool({ serverEntry = DEVBRAIN_SERVER_ENTRY, devbrainHome, workspaceRoot, tool, args, timeoutMs = 120_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], { env: devbrainEnv({ devbrainHome, workspaceRoot }), cwd: workspaceRoot, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); fn(value); };
    const timer = setTimeout(() => finish(reject, new Error(`DEVBRAIN_CALL_TIMEOUT: ${tool}`)), timeoutMs);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => finish(reject, error));
    child.on('close', (code) => finish(reject, new Error(`DEVBRAIN_SERVER_EXITED: code ${code} ${stderr.trim()}`)));
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args } }); }
        else if (message.id === 2) { if (message.error) finish(reject, new Error(`DEVBRAIN_TOOL_ERROR: ${JSON.stringify(message.error)}`)); else finish(resolve, { tool, args, structured: message.result?.structuredContent ?? null, isError: message.result?.isError ?? false, result: message.result }); }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'devbrain-refactor-benchmark', version: '0.1.0' } } });
  });
}

/** Requests each capability (expecting `approval_required`) and approves it with the administrative CLI. */
export async function prepareDevBrainApprovals({ task, repositoryRoot, workspaceRoot, devbrainHome, serverEntry = DEVBRAIN_SERVER_ENTRY, adminEntry = DEVBRAIN_ADMIN_ENTRY, capabilities = treatmentCapabilities(task) }) {
  const approvals = [];
  for (const entry of capabilities) {
    const requested = await callDevBrainTool({ serverEntry, devbrainHome, workspaceRoot, tool: entry.tool, args: { path: repositoryRoot, ...entry.args } });
    const structured = requested.structured ?? {};
    if (structured.status !== 'approval_required' || !structured.approvalId) throw new Error(`APPROVAL_NOT_REQUIRED: ${entry.capability} returned ${structured.status ?? 'no status'}`);
    const approved = await runCommand({ executable: 'node', args: [adminEntry, 'approve', structured.approvalId] }, workspaceRoot, { env: devbrainEnv({ devbrainHome, workspaceRoot }) });
    if (approved.exitCode !== 0) throw new Error(`APPROVAL_FAILED: ${entry.capability}: ${approved.stderr.trim() || approved.stdout.trim()}`);
    const record = JSON.parse(approved.stdout.trim().split('\n').at(-1));
    approvals.push({ capability: entry.capability, tool: entry.tool, approvalId: structured.approvalId, status: record.status, repositoryId: record.repositoryId, requested: { status: structured.status, approvalId: structured.approvalId, reason: structured.reason ?? null, definition: structured.definition ?? null } });
  }
  return { approvals, method: { request: 'mcp stdio tools/call against dist/index.js', approve: 'node dist/admin.js approve <approval-id>', storeEdited: false } };
}
