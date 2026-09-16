#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dependencyAudit, dependencyAuditInput, dependencyAuditOutput } from './tools/dependency-audit.js';
import { findTodos, findTodosInput, findTodosOutput } from './tools/find-todos.js';
import { gitHistory, gitHistoryInput, gitHistoryOutput } from './tools/git-history.js';
import { projectHealth, projectHealthInput, projectHealthOutput } from './tools/project-health.js';
import { repoMap, repoMapInput, repoMapOutput } from './tools/repo-map.js';
import { redact } from './lib/redaction.js';
import { summary } from './tools/common.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const response = (raw: Record<string, unknown>) => {
  const result = redact(raw);
  return { content: [{ type: 'text' as const, text: summary(result) }], structuredContent: result, isError: result.status === 'error' };
};

export function createServer(): McpServer {
  const server = new McpServer({ name: 'devbrain-mcp', version: '0.1.0' });
  server.registerTool('devbrain_repo_map', { description: 'Return a bounded, evidence-backed structural map of a repository.', inputSchema: repoMapInput, outputSchema: repoMapOutput, annotations: readOnly }, async (input) => response(await repoMap(input)));
  server.registerTool('devbrain_project_health', { description: 'Return a fast read-only Git and repository-hygiene snapshot.', inputSchema: projectHealthInput, outputSchema: projectHealthOutput, annotations: readOnly }, async (input) => response(await projectHealth(input)));
  server.registerTool('devbrain_git_history', { description: 'Return bounded commit metadata without patch contents.', inputSchema: gitHistoryInput, outputSchema: gitHistoryOutput, annotations: readOnly }, async (input) => response(await gitHistory(input)));
  server.registerTool('devbrain_dependency_audit', { description: 'Inventory direct dependencies and attempt update and vulnerability checks with explicit degraded states.', inputSchema: dependencyAuditInput, outputSchema: dependencyAuditOutput, annotations: { ...readOnly, openWorldHint: true } }, async (input) => response(await dependencyAudit(input)));
  server.registerTool('devbrain_find_todos', { description: 'Find bounded technical-debt markers in repository-owned files.', inputSchema: findTodosInput, outputSchema: findTodosOutput, annotations: readOnly }, async (input) => response(await findTodos(input)));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
