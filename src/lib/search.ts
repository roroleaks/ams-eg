import chunksData from "@/data/chunks.json";
import meta from "@/data/embeddings-meta.json";

export interface Chunk {
  page: number | null;
  product: string | null;
  section: string | null;
  text: string;
  sourceId?: string;
  sourceName?: string;
  sourceFile?: string;
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
// The inverted index is built lazily on the first search (and cached), so
// importing this module never blocks first paint. Term frequencies are
// precomputed once instead of being rebuilt on every query.
const N = chunks.length;
const k1 = 1.5;
const b = 0.75;

interface Index {
  tf: Map<string, number>[];
  len: Int32Array;
  df: Map<string, number>;
  avgLen: number;
}

let index: Index | null = null;

function getIndex(): Index {
  if (index) return index;
  const tf: Map<string, number>[] = new Array(N);
  const len = new Int32Array(N);
  const df = new Map<string, number>();
  let total = 0;
  for (let i = 0; i < N; i++) {
    const c = chunks[i];
    const toks = tokenize(`${c.text} ${c.section ?? ""} ${c.product ?? ""}`);
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf[i] = m;
    len[i] = toks.length;
    total += toks.length;
  }
  index = { tf, len, df, avgLen: total / (N || 1) };
  return index;
}

function bm25(qTokens: string[]): { score: number; matched: string[] }[] {
  const { tf, len, df, avgLen } = getIndex();
  const out: { score: number; matched: string[] }[] = new Array(N);
  // Precompute IDF per unique query term once, not per document.
  const idf = new Map<string, number>();
  for (const q of qTokens) {
    if (idf.has(q)) continue;
    const n = df.get(q) ?? 0;
    idf.set(q, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  }
  for (let i = 0; i < N; i++) {
    const l = len[i];
    if (l === 0) {
      out[i] = { score: 0, matched: [] };
      continue;
    }
    const map = tf[i];
    const norm = k1 * (1 - b + b * (l / avgLen));
    let score = 0;
    const matched: string[] = [];
    for (const q of qTokens) {
      const f = map.get(q) ?? 0;
      if (f === 0) continue;
      matched.push(q);
      score += idf.get(q)! * ((f * (k1 + 1)) / (f + norm));
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
  loadPromise = fetch("/embeddings.bin", { signal: AbortSignal.timeout(20000) })
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
