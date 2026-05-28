import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const ANVIL_URL = `http://${process.env.ANVIL_HOST || 'anvil'}:${process.env.ANVIL_PORT || '8100'}`;

// Tools the agent is allowed to call. Read tools are always available; the one
// write tool (anvil_update_note) enables agent-mediated editing. For the alpha
// the agent talks to the LOCAL Anvil MCP only — Vault/Forge MCP routing is a
// separate design pass.
export const ALLOWED_TOOLS = [
  'anvil_search',
  'anvil_get_note',
  'anvil_get_edges',
  'anvil_get_related',
  'anvil_query_view',
  'anvil_update_note',
  'horus_search',
];

/**
 * Convert an MCP tool definition (from tools/list) to an Anthropic tool
 * definition. Pure — no I/O.
 */
export function mcpToolToAnthropic(tool) {
  return {
    name: tool.name,
    description: tool.description || '',
    input_schema: tool.inputSchema || { type: 'object', properties: {} },
  };
}

let _clientPromise = null;

/**
 * Lazily connect a singleton MCP client to the local Anvil over Streamable
 * HTTP. The MCP SDK owns the initialize handshake and session management.
 */
function getAnvilClient() {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const transport = new StreamableHTTPClientTransport(new URL(`${ANVIL_URL}/mcp`));
      const client = new Client({ name: 'horus-ui', version: '1.0.0' }, { capabilities: {} });
      await client.connect(transport);
      return client;
    })().catch((err) => {
      _clientPromise = null; // allow retry on next call
      throw err;
    });
  }
  return _clientPromise;
}

/** List the allow-listed Anvil MCP tools as Anthropic tool definitions. */
export async function listAnvilTools() {
  const client = await getAnvilClient();
  const { tools } = await client.listTools();
  return (tools || []).filter((t) => ALLOWED_TOOLS.includes(t.name)).map(mcpToolToAnthropic);
}

/** Call an Anvil MCP tool and return its text content. */
export async function callAnvilTool(name, args) {
  const client = await getAnvilClient();
  const result = await client.callTool({ name, arguments: args || {} });
  const text = (result?.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return text || JSON.stringify(result?.structuredContent ?? {});
}
