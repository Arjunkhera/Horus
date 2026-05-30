import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatEnabled, describeToolCall, agentModel, runAgentTurn } from './agent-service.js';
import { mcpToolToAnthropic } from './mcp-config.js';

test('chatEnabled reflects the Anthropic key env var', () => {
  const prev = process.env.HORUS_ANTHROPIC_API_KEY;
  delete process.env.HORUS_ANTHROPIC_API_KEY;
  assert.equal(chatEnabled(), false);
  process.env.HORUS_ANTHROPIC_API_KEY = 'sk-ant-x';
  assert.equal(chatEnabled(), true);
  if (prev === undefined) delete process.env.HORUS_ANTHROPIC_API_KEY;
  else process.env.HORUS_ANTHROPIC_API_KEY = prev;
});

test('agentModel defaults to a current Claude model', () => {
  const prev = process.env.HORUS_AGENT_MODEL;
  delete process.env.HORUS_AGENT_MODEL;
  assert.equal(agentModel(), 'claude-sonnet-4-6');
  process.env.HORUS_AGENT_MODEL = 'claude-opus-4-7';
  assert.equal(agentModel(), 'claude-opus-4-7');
  if (prev === undefined) delete process.env.HORUS_AGENT_MODEL;
  else process.env.HORUS_AGENT_MODEL = prev;
});

test('describeToolCall maps Anvil tools to status strings', () => {
  assert.equal(describeToolCall('anvil_search'), 'searching notes…');
  assert.equal(describeToolCall('horus_search'), 'searching across Horus…');
  assert.equal(describeToolCall('unknown_tool'), 'thinking…');
});

test('mcpToolToAnthropic converts MCP tool defs to Anthropic shape', () => {
  const out = mcpToolToAnthropic({
    name: 'anvil_search',
    description: 'Search notes',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  });
  assert.deepEqual(out, {
    name: 'anvil_search',
    description: 'Search notes',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } },
  });
  // Falls back to an empty object schema when none provided.
  assert.deepEqual(mcpToolToAnthropic({ name: 'x' }).input_schema, { type: 'object', properties: {} });
});

// ── Fake Anthropic stream/client for the tool loop ───────────────────────────
function fakeStream({ textDeltas = [], finalMessage }) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of textDeltas) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
      }
    },
    async finalMessage() {
      return finalMessage;
    },
  };
}

function fakeClient(streamSpecs) {
  let i = 0;
  return {
    messages: {
      stream() {
        return fakeStream(streamSpecs[i++]);
      },
    },
  };
}

test('runAgentTurn streams tokens, runs the tool loop, and feeds results back', async () => {
  const client = fakeClient([
    {
      textDeltas: ['Let me search. '],
      finalMessage: {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me search. ' },
          { type: 'tool_use', id: 't1', name: 'anvil_search', input: { query: 'auth' } },
        ],
      },
    },
    {
      textDeltas: ['Found 2 notes.'],
      finalMessage: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Found 2 notes.' }] },
    },
  ]);

  const toolCalls = [];
  const callTool = async (name, input) => {
    toolCalls.push({ name, input });
    return 'note-1, note-2';
  };

  const messages = [{ role: 'user', content: 'what about auth?' }];
  const events = [];
  for await (const ev of runAgentTurn({ client, model: 'm', system: 's', messages, tools: [], callTool })) {
    events.push(ev);
  }

  assert.deepEqual(events, [
    { type: 'token', text: 'Let me search. ' },
    { type: 'tool_call', name: 'anvil_search' },
    { type: 'tool_result', name: 'anvil_search', text: 'note-1, note-2' },
    { type: 'token', text: 'Found 2 notes.' },
  ]);
  assert.deepEqual(toolCalls, [{ name: 'anvil_search', input: { query: 'auth' } }]);
  // messages accumulates: user, assistant(tool_use), user(tool_result), assistant(final)
  assert.equal(messages.length, 4);
  assert.equal(messages[2].content[0].type, 'tool_result');
  assert.equal(messages[2].content[0].tool_use_id, 't1');
});

test('runAgentTurn ends without tool calls when the model just answers', async () => {
  const client = fakeClient([
    { textDeltas: ['Hello.'], finalMessage: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello.' }] } },
  ]);
  const messages = [{ role: 'user', content: 'hi' }];
  const events = [];
  for await (const ev of runAgentTurn({ client, model: 'm', system: 's', messages, tools: [], callTool: async () => '' })) {
    events.push(ev);
  }
  assert.deepEqual(events, [{ type: 'token', text: 'Hello.' }]);
  assert.equal(messages.length, 2);
});
