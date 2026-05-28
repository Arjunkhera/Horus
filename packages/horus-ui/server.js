import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import { sseHeaders, sseEvent } from './sse.js';
import { getOrCreateAgent, buildFirstMessage, buildResumeMessage, describeToolCall } from './agent-service.js';
import { parseCitations } from './citation-parser.js';

if (!process.env.CURSOR_API_KEY) {
  console.error('FATAL: CURSOR_API_KEY environment variable is required');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8400;
const ANVIL_HOST = process.env.ANVIL_HOST || 'anvil';
const ANVIL_PORT = process.env.ANVIL_PORT || '8100';
const READER_STATIC = process.env.READER_STATIC || path.join(__dirname, '../horus-ui-client');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.send('ok'));

// DELETE /api/notes/:id — must be registered before the proxy
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`[delete] DELETE /api/notes/${id}`);
  try {
    const anvilRes = await fetch(
      `http://${ANVIL_HOST}:${ANVIL_PORT}/api/notes/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    if (anvilRes.status === 404) {
      console.log(`[delete] NOT FOUND: ${id}`);
      return res.status(404).json({ error: 'Note not found' });
    }
    if (!anvilRes.ok) {
      const body = await anvilRes.text();
      console.error(`[delete] Anvil error ${anvilRes.status}: ${body}`);
      return res.status(500).json({ error: 'Delete failed' });
    }
    console.log(`[delete] OK: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[delete] Error: ${err.message}`);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// PATCH /api/notes/:id — update note body; must be registered before the proxy
app.patch('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  const body = req.body?.body;
  if (typeof body !== 'string') {
    return res.status(400).json({ error: 'body field is required' });
  }
  if (Buffer.byteLength(body, 'utf8') > 1_048_576) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.log(`[patch] PATCH /api/notes/${id} body_length=${body.length}`);
  try {
    const anvilRes = await fetch(
      `http://${ANVIL_HOST}:${ANVIL_PORT}/api/notes/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }
    );
    if (anvilRes.status === 404) {
      console.log(`[patch] NOT FOUND: ${id}`);
      return res.status(404).json({ error: 'Note not found' });
    }
    if (!anvilRes.ok) {
      const text = await anvilRes.text();
      console.error(`[patch] Anvil error ${anvilRes.status}: ${text}`);
      return res.status(500).json({ error: 'Update failed' });
    }
    console.log(`[patch] OK: ${id}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[patch] Error: ${err.message}`);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Proxy /api/* → Anvil (except /api/ai/ask which we handle ourselves)
app.use('/api', (req, res, next) => {
  if (req.path === '/ai/ask') return next();
  createProxyMiddleware({
    target: `http://${ANVIL_HOST}:${ANVIL_PORT}`,
    changeOrigin: true,
  })(req, res, next);
});

// POST /api/ai/ask — NLP agent search with SSE streaming
app.post('/api/ai/ask', async (req, res) => {
  const { question, sessionId, agentId, sessionMessages = [] } = req.body;

  if (!question) {
    return res.status(400).json({ error: 'question is required' });
  }

  res.writeHead(200, sseHeaders());

  const toolCallLog = [];
  const TIMEOUT_MS = 90000;
  let timedOut = false;
  let run;
  let accumulatedText = '';

  try {
    const { agent, isNew } = await getOrCreateAgent(agentId, sessionMessages);

    // Build message: first turn gets system prompt, follow-ups just get the question
    let message;
    if (isNew && !agentId) {
      message = buildFirstMessage(question);
    } else if (isNew && agentId) {
      // Resume failed — new agent with history context
      message = buildResumeMessage(question, sessionMessages);
    } else {
      message = question;
    }

    run = await agent.send(message);

    const timeout = setTimeout(async () => {
      timedOut = true;
      try { await run.cancel(); } catch {}
      res.write(sseEvent({ type: 'error', text: 'Search took too long. Please try again.' }));
      res.end();
    }, TIMEOUT_MS);

    for await (const event of run.stream()) {
      if (timedOut) break;
      if (event.type === 'status') {
        res.write(sseEvent({ type: 'status', text: event.status }));
      } else if (event.type === 'tool_call') {
        toolCallLog.push(event);
        res.write(sseEvent({ type: 'status', text: describeToolCall(event) }));
      } else if (event.type === 'assistant') {
        // SDK emits text at event.message.content[0].text, not event.content
        const text = event.message?.content?.[0]?.text ?? '';
        if (text) {
          accumulatedText += text;
          res.write(sseEvent({ type: 'token', text }));
        }
      }
      // suppress 'thinking' events
    }

    clearTimeout(timeout);

    if (!timedOut) {
      // Use accumulated stream text for citations; fall back to run.wait() result
      let finalText = accumulatedText;
      if (!finalText) {
        try {
          const result = await run.wait();
          finalText = result.result || '';
        } catch {}
      }
      const parsed = parseCitations(finalText, toolCallLog);
      res.write(sseEvent({ type: 'references', items: parsed.references }));
      res.write(sseEvent({ type: 'followups', items: parsed.followups }));
      res.write(sseEvent({ type: 'done', agentId: agent.agentId, answerText: parsed.answerText }));
    }
  } catch (err) {
    const msg = err?.message || 'Agent temporarily unavailable.';
    res.write(sseEvent({ type: 'error', text: msg }));
  }

  if (!timedOut) res.end();
});

// Serve static reader files
app.use(express.static(READER_STATIC, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.jsx')) res.setHeader('Content-Type', 'application/javascript');
  },
}));

// SPA fallback — all non-API, non-static routes serve index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(READER_STATIC, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Horus horus-ui listening on port ${PORT}`);
});
