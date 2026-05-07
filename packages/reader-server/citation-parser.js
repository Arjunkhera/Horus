export function parseCitations(text, toolCallLog) {
  const referencesMatch = text.match(/^References:\n([\s\S]*?)(?:\n\nFollow-ups:|$)/m);
  const followupsMatch = text.match(/^Follow-ups:\n([\s\S]*)$/m);

  let references = [];
  if (referencesMatch) {
    const lines = referencesMatch[1].trim().split('\n');
    for (const line of lines) {
      const m = line.match(/^\[(\d+)\]\s+([\w-]+(?:-[\w]+)*)\s+—\s+(.+?)\s+\((\w[\w-]*)\)$/);
      if (m) {
        references.push({ n: parseInt(m[1]), noteId: m[2], title: m[3], type: m[4] });
      }
    }
  }

  // Fallback: build from tool call log if no References block
  if (references.length === 0 && toolCallLog.length > 0) {
    const seen = new Set();
    let n = 1;
    for (const call of toolCallLog) {
      const ids = extractNoteIds(call);
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          references.push({ n: n++, noteId: id, title: 'Note', type: 'note' });
        }
      }
    }
  }

  const followups = [];
  if (followupsMatch) {
    const lines = followupsMatch[1].trim().split('\n');
    for (const line of lines) {
      const cleaned = line.replace(/^[-*]\s*/, '').trim();
      if (cleaned) followups.push(cleaned);
    }
  }

  // Strip references and followups from answer text
  let answerText = text;
  if (referencesMatch) answerText = answerText.replace(/\n\nReferences:[\s\S]*$/, '');
  answerText = answerText.trim();

  return { references, followups, answerText };
}

function extractNoteIds(toolCall) {
  const ids = [];
  const str = JSON.stringify(toolCall?.result || '');
  const matches = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  if (matches) ids.push(...[...new Set(matches)]);
  return ids;
}
