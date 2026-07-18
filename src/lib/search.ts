import chunksData from "@/data/chunks.json";
import meta from "@/data/embeddings-meta.json";

export interface Chunk {
  page: number | null;
  product: string | null;
  section: string | null;
  text: string;
}

export interface SearchResult extends Chunk {
  score: number;
  matchedTerms: string[];
  keywordScore: number;
  semanticScore: number;
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
export const DIMS = meta.dims;

// ---------- BM25 ----------
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

function bm25(qTokens: string[]): { score: number; matched: string[] }[] {
  const out: { score: number; matched: string[] }[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const toks = docTokens[i];
    const len = toks.length;
    if (len === 0) {
      out[i] = { score: 0, matched: [] };
      continue;
    }
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
    out[i] = { score, matched };
  }
  return out;
}

// ---------- Embeddings ----------
let embeddings: Float32Array | null = null;
let loadPromise: Promise<Float32Array> | null = null;

export function loadEmbeddings(): Promise<Float32Array> {
  if (embeddings) return Promise.resolve(embeddings);
  if (loadPromise) return loadPromise;
  loadPromise = fetch("/embeddings.bin")
    .then((r) => {
      if (!r.ok) throw new Error("failed to load embeddings");
      return r.arrayBuffer();
    })
    .then((buf) => {
      embeddings = new Float32Array(buf);
      return embeddings;
    });
  return loadPromise;
}

function cosineAgainst(qVec: Float32Array, emb: Float32Array): Float32Array {
  const scores = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    const off = i * DIMS;
    for (let d = 0; d < DIMS; d++) s += qVec[d] * emb[off + d];
    scores[i] = s;
  }
  return scores;
}

// ---------- Hybrid search ----------
export function hybridSearch(
  query: string,
  qVec: Float32Array | null,
  limit = 50
): SearchResult[] {
  const qTokens = tokenize(query);
  const lowerQuery = query.toLowerCase().trim();

  const bm = bm25(qTokens);
  // normalize BM25 to 0..1
  let maxBM = 0;
  for (let i = 0; i < N; i++) if (bm[i].score > maxBM) maxBM = bm[i].score;

  let sem: Float32Array | null = null;
  let maxSem = 0;
  let minSem = 1;
  if (qVec && embeddings) {
    sem = cosineAgainst(qVec, embeddings);
    for (let i = 0; i < N; i++) {
      if (sem[i] > maxSem) maxSem = sem[i];
      if (sem[i] < minSem) minSem = sem[i];
    }
  }

  const results: SearchResult[] = [];
  for (let i = 0; i < N; i++) {
    const kw = maxBM > 0 ? bm[i].score / maxBM : 0;
    const rawSem = sem ? sem[i] : 0;
    // rescale semantic (typical range ~0.1..0.7); normalize by max
    const smNorm = sem && maxSem > 0 ? Math.max(0, (rawSem - 0.15) / (maxSem - 0.15 + 1e-6)) : 0;

    // Weighted combination. Semantic contributes even without keyword match.
    let score = 0.55 * kw + 0.45 * smNorm;
    if (!sem) score = kw;

    // Boosts
    if (score > 0) {
      const lowerText = chunks[i].text.toLowerCase();
      if (lowerQuery && lowerText.includes(lowerQuery)) score *= 1.4;
      if (qTokens.length > 0 && bm[i].matched.length === qTokens.length) score *= 1.15;
      const sectionLower = (chunks[i].section ?? "").toLowerCase();
      if (qTokens.some((q) => sectionLower.includes(q))) score *= 1.1;
    }

    // Threshold: require some signal
    const minSignal = sem ? 0.12 : 0.001;
    if (score < minSignal) continue;

    results.push({
      ...chunks[i],
      score,
      matchedTerms: bm[i].matched,
      keywordScore: kw,
      semanticScore: smNorm,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// Legacy keyword-only fallback
export function search(query: string, limit = 50): SearchResult[] {
  return hybridSearch(query, null, limit);
}

export function getAllProducts(): string[] {
  const set = new Set<string>();
  chunks.forEach((c) => c.product && set.add(c.product));
  return [...set].sort();
}

export function totalChunks() {
  return chunks.length;
}
