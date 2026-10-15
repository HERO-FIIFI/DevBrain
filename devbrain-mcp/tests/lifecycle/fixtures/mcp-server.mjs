import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
const server=new McpServer({name:'phase5-probe-fixture',version:'1.0.0'});
server.registerTool('probe_ping',{description:'Probe fixture',inputSchema:{}},async()=>({content:[{type:'text',text:'pong'}]}));
await server.connect(new StdioServerTransport());
