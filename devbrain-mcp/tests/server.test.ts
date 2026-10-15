import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/index.js';

describe('MCP contracts', () => it('registers twenty-six tools and returns validated structured content', async () => {
  const client = new Client({ name: 'test-client', version: '1.0.0' }); const server = createServer(); const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const listed = await client.listTools(); expect(listed.tools.map((tool) => tool.name).sort()).toEqual(['devbrain_api_inventory','devbrain_architecture_map','devbrain_change_impact','devbrain_context_pack','devbrain_database_schema','devbrain_dependency_audit','devbrain_dependency_graph','devbrain_diagnose_log','devbrain_find_references','devbrain_find_todos','devbrain_get_diff','devbrain_get_execution_evidence','devbrain_git_history','devbrain_inspect_docker','devbrain_migration_status','devbrain_project_health','devbrain_read_file_slice','devbrain_read_symbol','devbrain_repo_map','devbrain_route_inventory','devbrain_run_build','devbrain_run_lint','devbrain_run_targeted_tests','devbrain_run_tests','devbrain_search_symbols','devbrain_search_text']);
  for (const tool of listed.tools) expect(tool.outputSchema).toBeDefined();
  for(const tool of listed.tools.filter((tool)=>!tool.name.startsWith('devbrain_run_')&&tool.name!=='devbrain_context_pack'))expect(tool.annotations?.readOnlyHint).toBe(true);
  const executionTools=listed.tools.filter((tool)=>tool.name.startsWith('devbrain_run_'));for(const tool of executionTools){expect(tool.annotations).toMatchObject({readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true});}
  expect(listed.tools.find((tool)=>tool.name==='devbrain_context_pack')?.annotations).toMatchObject({readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false});
  expect(listed.tools.some((tool)=>/approve|trust/i.test(tool.name))).toBe(false);
  const called = await client.callTool({ name: 'devbrain_repo_map', arguments: { path: path.join(process.cwd(), 'fixtures/npm-react') } });
  expect(called.structuredContent).toMatchObject({ status: 'complete', frameworks: ['React'] }); await client.close(); await server.close();
}));
import path from 'node:path';
