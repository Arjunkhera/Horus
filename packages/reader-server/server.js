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
const READER_STATIC = process.env.READER_STATIC || path.join(__dirname, '../reader');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.send('ok'));

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
  console.log(`Horus reader-server listening on port ${PORT}`);
});
