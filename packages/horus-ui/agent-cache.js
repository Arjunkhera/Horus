// In-memory per-session conversation history. Keyed by agentId (the client's
// resumable session id). Stores the Anthropic `messages` array so follow-up
// turns can resume context without a server-side agent object.
const historyCache = new Map();

export function getCachedHistory(agentId) {
  return (agentId && historyCache.get(agentId)) || null;
}

export function setCachedHistory(agentId, messages) {
  if (agentId) historyCache.set(agentId, messages);
}
