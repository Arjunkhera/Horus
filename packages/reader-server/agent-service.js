import { Agent } from '@cursor/sdk';
import { getMcpConfig } from './mcp-config.js';
import { getCachedAgent, setCachedAgent } from './agent-cache.js';
import { SYSTEM_PROMPT } from './prompt.js';

export async function getOrCreateAgent(agentId, sessionMessages) {
  // 1. Check in-memory cache
  const cached = getCachedAgent(agentId);
  if (cached) return { agent: cached, isNew: false };

  // 2. Try resume from Cursor
  if (agentId) {
    try {
      const agent = await Agent.resume(agentId, {
        apiKey: process.env.CURSOR_API_KEY,
        mcpServers: getMcpConfig(),
      });
      setCachedAgent(agent.agentId, agent);
      return { agent, isNew: false };
    } catch {
      // Fall through to create new agent with history context
    }
  }

  // 3. Create new agent
  const agent = await Agent.create({
    apiKey: process.env.CURSOR_API_KEY,
    model: { id: process.env.HORUS_AGENT_MODEL || 'composer-2' },
    local: { cwd: process.cwd() },
    mcpServers: getMcpConfig(),
  });
  setCachedAgent(agent.agentId, agent);
  return { agent, isNew: true };
}

export function buildFirstMessage(question) {
  return `${SYSTEM_PROMPT}\n\n---\n\n${question}`;
}

export function buildResumeMessage(question, sessionMessages) {
  const history = sessionMessages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  return `${SYSTEM_PROMPT}\n\n[Prior conversation context]\n${history}\n[End prior context]\n\n${question}`;
}

export function describeToolCall(event) {
  // SDK wraps MCP calls as name:"mcp" with actual tool name at event.args.toolName
  const name = event?.args?.toolName || event?.name || event?.tool || '';
  if (name === 'anvil_search') return 'searching notes…';
  if (name === 'anvil_get_note') return 'reading note…';
  if (name === 'anvil_get_edges') return 'following connections…';
  if (name === 'anvil_get_related') return 'exploring relationships…';
  if (name === 'anvil_query_view') return 'querying notes…';
  if (name === 'horus_search') return 'searching across Horus…';
  if (name === 'anvil_query_view') return 'querying notes…';
  return 'thinking…';
}
