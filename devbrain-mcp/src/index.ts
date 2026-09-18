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
import {searchText,searchTextInput,searchTextOutput} from './tools/search-text.js';
import {searchSymbols,searchSymbolsInput,searchSymbolsOutput} from './tools/search-symbols.js';
import {findReferences,findReferencesInput,findReferencesOutput} from './tools/find-references.js';
import {readFileSlice,readFileSliceInput,readFileSliceOutput} from './tools/read-file-slice.js';
import {readSymbol,readSymbolInput,readSymbolOutput} from './tools/read-symbol.js';
import {getDiff,getDiffInput,getDiffOutput} from './tools/get-diff.js';
import {getExecutionEvidence,getExecutionEvidenceInput,getExecutionEvidenceOutput} from './tools/get-execution-evidence.js';
import {diagnoseLog,diagnoseLogInput,diagnoseLogOutput} from './tools/diagnose-log.js';
import {contextPack,contextPackInput,contextPackOutput,contextPackAnnotations} from './tools/context-pack.js';
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
  server.registerTool('devbrain_search_text',{description:'Search repository text deterministically with bounded, redacted, untrusted-content results.',inputSchema:searchTextInput,outputSchema:searchTextOutput,annotations:readOnly},async(input)=>response(await searchText(input)));
  server.registerTool('devbrain_search_symbols',{description:'Locate bounded TypeScript, JavaScript, and Python symbol definitions with explicit resolution confidence.',inputSchema:searchSymbolsInput,outputSchema:searchSymbolsOutput,annotations:readOnly},async(input)=>response(await searchSymbols(input)));
  server.registerTool('devbrain_find_references',{description:'Find bounded textual symbol references without claiming semantic precision.',inputSchema:findReferencesInput,outputSchema:findReferencesOutput,annotations:readOnly},async(input)=>response(await findReferences(input)));
  server.registerTool('devbrain_read_file_slice',{description:'Read a bounded, line-numbered, redacted repository file slice.',inputSchema:readFileSliceInput,outputSchema:readFileSliceOutput,annotations:readOnly},async(input)=>response(await readFileSlice(input)));
  server.registerTool('devbrain_read_symbol',{description:'Read one bounded symbol definition or return explicit ambiguity.',inputSchema:readSymbolInput,outputSchema:readSymbolOutput,annotations:readOnly},async(input)=>response(await readSymbol(input)));
  server.registerTool('devbrain_get_diff',{description:'Return bounded structured Git diff evidence for a fixed mode.',inputSchema:getDiffInput,outputSchema:getDiffOutput,annotations:readOnly},async(input)=>response(await getDiff(input)));
  server.registerTool('devbrain_get_execution_evidence',{description:'Retrieve bounded Phase 2 execution evidence by execution ID.',inputSchema:getExecutionEvidenceInput,outputSchema:getExecutionEvidenceOutput,annotations:readOnly},async(input)=>response(await getExecutionEvidence(input)));
  server.registerTool('devbrain_diagnose_log',{description:'Extract bounded diagnostic signal from stored execution logs by execution ID.',inputSchema:diagnoseLogInput,outputSchema:diagnoseLogOutput,annotations:readOnly},async(input)=>response(await diagnoseLog(input)));
  server.registerTool('devbrain_context_pack',{description:'Persist and return a deterministic budgeted context manifest with explicit selection reasons.',inputSchema:contextPackInput,outputSchema:contextPackOutput,annotations:contextPackAnnotations},async(input)=>response(await contextPack(input)));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
