export function parseCitations(text, toolCallLog) {
  // AI may output refs inline ("References: [1]...") or multi-line ("References:\n[1]...")
  const referencesMatch = text.match(/References:[ \t]*([\s\S]*?)(?=\n\nFollow-ups:|\nFollow-ups:|$)/i);
  const followupsMatch = text.match(/^Follow-ups:\n([\s\S]*)$/m);

  let references = [];
  if (referencesMatch) {
    const block = referencesMatch[1];
    // Split on [n] markers to handle both inline and multi-line ref blocks
    const segments = block.split(/(?=\[\d+\])/);
    for (const seg of segments) {
      const m = seg.trim().match(/^\[(\d+)\]\s+([\w-]+(?:-[\w]+)*)\s+—\s+(.+?)\s+\((\w[\w-]*)\)/);
      if (m) {
        references.push({ n: parseInt(m[1]), noteId: m[2], title: m[3], type: m[4] });
      }
    }
  }

  // Fallback: build from tool call log if no References block
  if (references.length === 0 && toolCallLog.length > 0) {
    const noteMetaMap = extractNoteMetadata(toolCallLog);
    const seen = new Set();
    let n = 1;
    for (const call of toolCallLog) {
      const ids = extractNoteIds(call);
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.add(id);
          const meta = noteMetaMap[id] || {};
          references.push({ n: n++, noteId: id, title: meta.title || 'Note', type: meta.type || 'note' });
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
  let answerText = text.replace(/\n?References:[ \t]*[\s\S]*$/, '').trim();

  return { references, followups, answerText };
}

function extractNoteIds(toolCall) {
  const ids = [];
  const str = JSON.stringify(toolCall?.result || '');
  const matches = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
  if (matches) ids.push(...[...new Set(matches)]);
  return ids;
}

function extractNoteMetadata(toolCallLog) {
  const metaMap = {};
  for (const call of toolCallLog) {
    let result = call?.result;
    if (!result) continue;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch { continue; }
    }
    // anvil_search returns { results: [{noteId, title, type, ...}] }
    if (Array.isArray(result.results)) {
      for (const item of result.results) {
        if (item.noteId && item.title) {
          metaMap[item.noteId] = { title: item.title, type: item.type || 'note' };
        }
      }
    }
    // anvil_get_note returns { noteId, title, type, ... } or { note: { noteId, ... } }
    const direct = result.noteId ? result : result.note;
    if (direct?.noteId && direct?.title) {
      metaMap[direct.noteId] = { title: direct.title, type: direct.type || 'note' };
    }
  }
  return metaMap;
}
