import { SYSTEM_PROMPT } from './prompt.js';

export const SYSTEM = SYSTEM_PROMPT;

/** Chat surface is enabled only when an Anthropic key is configured. */
export function chatEnabled() {
  return !!(process.env.HORUS_ANTHROPIC_API_KEY || '').trim();
}

/** Agent model id, defaulting to a current Claude model. */
export function agentModel() {
  return process.env.HORUS_AGENT_MODEL || 'claude-sonnet-4-6';
}

let _anthropicPromise = null;

/**
 * Lazily construct the Anthropic client. The SDK is imported dynamically so
 * this module loads (and its pure helpers stay testable) even when the SDK is
 * not installed in the local dev environment.
 */
export function getAnthropicClient() {
  if (!_anthropicPromise) {
    _anthropicPromise = import('@anthropic-ai/sdk').then(
      ({ default: Anthropic }) => new Anthropic({ apiKey: process.env.HORUS_ANTHROPIC_API_KEY }),
    );
  }
  return _anthropicPromise;
}

/** Map an Anvil tool name to a short human-readable status string. */
export function describeToolCall(name) {
  if (name === 'anvil_search') return 'searching notes…';
  if (name === 'anvil_get_note') return 'reading note…';
  if (name === 'anvil_get_edges') return 'following connections…';
  if (name === 'anvil_get_related') return 'exploring relationships…';
  if (name === 'anvil_query_view') return 'querying notes…';
  if (name === 'anvil_update_note') return 'updating note…';
  if (name === 'horus_search') return 'searching across Horus…';
  return 'thinking…';
}

/**
 * Run one agentic turn against the Anthropic Messages API with a client-side
 * tool loop over the local Anvil MCP. Yields normalized events:
 *   { type: 'token', text }      — streamed assistant text
 *   { type: 'tool_call', name }  — a tool the model invoked
 *
 * `client` (Anthropic) and `callTool(name, input)` are injected so the loop is
 * unit-testable with fakes. `messages` is mutated in place to accumulate the
 * assistant/tool-result turns (so the caller can cache it for resume).
 */
export async function* runAgentTurn({ client, model, system, messages, tools, callTool, maxIterations = 8 }) {
  let iterations = 0;
  while (iterations++ < maxIterations) {
    const stream = client.messages.stream({ model, max_tokens: 4096, system, messages, tools });

    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        yield { type: 'token', text: ev.delta.text };
      }
    }

    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });

    const toolUses = (final.content || []).filter((b) => b.type === 'tool_use');
    if (final.stop_reason === 'tool_use' && toolUses.length > 0) {
      const toolResults = [];
      for (const tu of toolUses) {
        yield { type: 'tool_call', name: tu.name };
        let text;
        try {
          text = await callTool(tu.name, tu.input);
        } catch (e) {
          text = `Error calling ${tu.name}: ${e?.message || e}`;
        }
        yield { type: 'tool_result', name: tu.name, text };
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // No tool use → the turn is complete.
    return;
  }
}
