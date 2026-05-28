export function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

export function sseEvent(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
