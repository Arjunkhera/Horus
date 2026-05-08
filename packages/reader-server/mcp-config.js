const ANVIL_URL = `http://${process.env.ANVIL_HOST || 'anvil'}:${process.env.ANVIL_PORT || '8100'}`;

// Tools the agent is allowed to call. Read tools are always available.
// Write tools (anvil_update_note) are included to enable agent-mediated editing.
const ALLOWED_TOOLS = [
  'anvil_search',
  'anvil_get_note',
  'anvil_get_edges',
  'anvil_get_related',
  'anvil_query_view',
  'anvil_update_note',
  'horus_search',
];

export function getMcpConfig() {
  return {
    anvil: {
      type: 'http',
      url: ANVIL_URL,
      allowedTools: ALLOWED_TOOLS,
    },
  };
}
