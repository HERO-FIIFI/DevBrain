import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/index.js';

describe('MCP contracts', () => it('registers ten tools and returns validated structured content', async () => {
  const client = new Client({ name: 'test-client', version: '1.0.0' }); const server = createServer(); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools(); expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['devbrain_dependency_audit', 'devbrain_find_todos', 'devbrain_git_history', 'devbrain_inspect_docker', 'devbrain_project_health', 'devbrain_repo_map', 'devbrain_run_build', 'devbrain_run_lint', 'devbrain_run_targeted_tests', 'devbrain_run_tests']);
  for (const tool of listed.tools) expect(tool.outputSchema).toBeDefined();
  for(const tool of listed.tools.filter((tool)=>!tool.name.startsWith('devbrain_run_')))expect(tool.annotations?.readOnlyHint).toBe(true);
  const executionTools=listed.tools.filter((tool)=>tool.name.startsWith('devbrain_run_'));for(const tool of executionTools){expect(tool.annotations).toMatchObject({readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true});}
  expect(listed.tools.some((tool)=>/approve|trust/i.test(tool.name))).toBe(false);
  const called = await client.callTool({ name: 'devbrain_repo_map', arguments: { path: path.join(process.cwd(), 'fixtures/npm-react') } });
  expect(called.structuredContent).toMatchObject({ status: 'complete', frameworks: ['React'] }); await client.close(); await server.close();
}));
import path from 'node:path';
