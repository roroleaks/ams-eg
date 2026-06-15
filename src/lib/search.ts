import chunksData from "@/data/chunks.json";

export interface Chunk {
  page: number | null;
  product: string | null;
  section: string | null;
  text: string;
}

export interface SearchResult extends Chunk {
  score: number;
  matchedTerms: string[];
}

const STOP = new Set([
  "the","a","an","and","or","of","to","in","for","on","with","by","is","are","be",
  "as","at","from","that","this","it","its","was","were","has","have","had","but",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\-]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

const chunks = chunksData as Chunk[];

// Precompute tokens + doc frequency for BM25
const docTokens: string[][] = chunks.map((c) =>
  tokenize(`${c.text} ${c.section ?? ""} ${c.product ?? ""}`)
);
const df = new Map<string, number>();
docTokens.forEach((toks) => {
  new Set(toks).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
});
const N = chunks.length;
const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N;
const k1 = 1.5;
const b = 0.75;

export function search(query: string, limit = 50): SearchResult[] {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase().trim();

  for (let i = 0; i < chunks.length; i++) {
    const toks = docTokens[i];
    if (toks.length === 0) continue;
    const len = toks.length;
    const tf = new Map<string, number>();
    toks.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));

    let score = 0;
    const matched: string[] = [];
    for (const q of qTokens) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      matched.push(q);
      const n = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (len / avgLen))));
    }
    if (matched.length === 0) continue;

    // Boosts
    const lowerText = chunks[i].text.toLowerCase();
    if (lowerText.includes(lowerQuery)) score *= 1.6; // exact phrase
    if (matched.length === qTokens.length) score *= 1.3; // all terms present
    const sectionLower = (chunks[i].section ?? "").toLowerCase();
    if (qTokens.some((q) => sectionLower.includes(q))) score *= 1.15;

    results.push({ ...chunks[i], score, matchedTerms: matched });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function getAllProducts(): string[] {
  const set = new Set<string>();
  chunks.forEach((c) => c.product && set.add(c.product));
  return [...set].sort();
}

export function totalChunks() {
  return chunks.length;
}
