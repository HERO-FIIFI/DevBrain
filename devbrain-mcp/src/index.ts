#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dependencyAudit, dependencyAuditInput, dependencyAuditOutput } from './tools/dependency-audit.js';
import { findTodos, findTodosInput, findTodosOutput } from './tools/find-todos.js';
import { gitHistory, gitHistoryInput, gitHistoryOutput } from './tools/git-history.js';
import { projectHealth, projectHealthInput, projectHealthOutput } from './tools/project-health.js';
import { repoMap, repoMapInput, repoMapOutput } from './tools/repo-map.js';
import {inspectDocker,inspectDockerInput,inspectDockerOutput} from './tools/inspect-docker.js';
import {runBuild,runBuildInput} from './tools/run-build.js';
import {runTests,runTestsInput} from './tools/run-tests.js';
import {runTargetedTests,runTargetedTestsInput} from './tools/run-targeted-tests.js';
import {runLint,runLintInput} from './tools/run-lint.js';
import {executionAnnotations,executionOutputSchema} from './tools/run-common.js';
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
  server.registerTool('devbrain_run_build',{description:'Discover, authorize, and run the pinned build capability in a trusted Git repository.',inputSchema:runBuildInput,outputSchema:executionOutputSchema,annotations:executionAnnotations},async(input)=>response(await runBuild(input)));
  server.registerTool('devbrain_run_tests',{description:'Discover, authorize, and run the pinned full test capability in a trusted Git repository.',inputSchema:runTestsInput,outputSchema:executionOutputSchema,annotations:executionAnnotations},async(input)=>response(await runTests(input)));
  server.registerTool('devbrain_run_targeted_tests',{description:'Run one validated repository-contained test file through an authorized pinned test capability.',inputSchema:runTargetedTestsInput,outputSchema:executionOutputSchema,annotations:executionAnnotations},async(input)=>response(await runTargetedTests(input)));
  server.registerTool('devbrain_run_lint',{description:'Discover, authorize, and run the pinned lint capability in a trusted Git repository.',inputSchema:runLintInput,outputSchema:executionOutputSchema,annotations:executionAnnotations},async(input)=>response(await runLint(input)));
  server.registerTool('devbrain_inspect_docker',{description:'Observationally inspect Docker availability, containers, images, health, ports, and sanitized mounts.',inputSchema:inspectDockerInput,outputSchema:inspectDockerOutput,annotations:readOnly},async(input)=>response(await inspectDocker(input)));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
