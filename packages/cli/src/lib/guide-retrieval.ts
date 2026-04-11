// packages/cli/src/lib/guide-retrieval.ts
//
// Pure retrieval logic for the `horus help` command. Reads a pre-built index
// produced by scripts/build-guides.mjs and scores candidate guides against a
// query using BM25.
//
// This module is explicitly side-effect-free so that a future `horus ask` REPL
// can wrap it without modification. Never add console I/O, file I/O, or
// network calls here — they belong in the command layer (commands/help.ts).

export interface GuideEntry {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  related_commands: string[];
  file: string;
  tokens: string[];
}

export interface GuideIndex {
  schema_version: number;
  built_at: string;
  guide_count: number;
  guides: GuideEntry[];
}

export interface RetrievalResult {
  primary: GuideEntry | null;
  alternates: GuideEntry[];
}

// ── Tokenizer (must match scripts/build-guides.mjs) ─────────────────────────
export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

// ── BM25 ────────────────────────────────────────────────────────────────────
const K1 = 1.5;
const B = 0.75;

function termFreq(token: string, tokens: string[]): number {
  let n = 0;
  for (const t of tokens) if (t === token) n++;
  return n;
}

function docFreq(token: string, guides: GuideEntry[]): number {
  let n = 0;
  for (const g of guides) {
    if (g.tokens.includes(token)) n++;
  }
  return n;
}

function bm25Score(
  queryTokens: string[],
  doc: GuideEntry,
  avgDocLen: number,
  n: number,
  guides: GuideEntry[],
): number {
  let score = 0;
  const docLen = doc.tokens.length;
  for (const q of queryTokens) {
    const f = termFreq(q, doc.tokens);
    if (f === 0) continue;
    const df = docFreq(q, guides);
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
    const norm = (f * (K1 + 1)) / (f + K1 * (1 - B + (B * docLen) / avgDocLen));
    score += idf * norm;
  }
  return score;
}

// ── Public retrieval API ────────────────────────────────────────────────────
/**
 * Score all guides against the query and return the primary hit plus up to
 * `maxAlternates` "see also" entries. If the query has no tokens in common
 * with any guide, `primary` is null and `alternates` is empty.
 *
 * This is a pure function. Given the same input it always returns equal
 * output, and it has no side effects.
 */
export function retrieve(
  query: string,
  index: GuideIndex,
  maxAlternates: number = 3,
): RetrievalResult {
  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length === 0 || index.guides.length === 0) {
    return { primary: null, alternates: [] };
  }

  const n = index.guides.length;
  const totalLen = index.guides.reduce((s, g) => s + g.tokens.length, 0);
  const avgDocLen = totalLen / n;

  const scored = index.guides
    .map((g) => ({ guide: g, score: bm25Score(queryTokens, g, avgDocLen, n, index.guides) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { primary: null, alternates: [] };
  }

  const primary = scored[0].guide;
  const alternates = scored.slice(1, 1 + maxAlternates).map((s) => s.guide);
  return { primary, alternates };
}

/**
 * Return the top-N guides by BM25 score, without separating primary from
 * alternates. Useful for diagnostics and the retrieval quality fixture test.
 * Same purity guarantees as `retrieve`.
 */
export function topN(query: string, index: GuideIndex, limit: number = 5): GuideEntry[] {
  const queryTokens = tokenizeQuery(query);
  if (queryTokens.length === 0 || index.guides.length === 0) return [];

  const n = index.guides.length;
  const totalLen = index.guides.reduce((s, g) => s + g.tokens.length, 0);
  const avgDocLen = totalLen / n;

  return index.guides
    .map((g) => ({ guide: g, score: bm25Score(queryTokens, g, avgDocLen, n, index.guides) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.guide);
}
