const agentCache = new Map();

export function getCachedAgent(agentId) {
  return agentId ? agentCache.get(agentId) : null;
}

export function setCachedAgent(agentId, agent) {
  agentCache.set(agentId, agent);
}
