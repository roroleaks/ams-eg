import { COMPLAINT_INDEX, PRODUCT_DB, complaintsFor } from "@/data/complaints";
import meta from "@/data/complaint-embeddings-meta.json";
import { hybridSearch, type SearchResult } from "@/lib/search";

const DIMS = meta.dims;

const STOP = new Set([
  "the","a","an","and","or","of","to","in","for","on","with","by","is","are","be",
  "as","at","from","that","this","it","its","was","were","has","have","had","but",
  "my","patient","case","her","his",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

const idxTokens = COMPLAINT_INDEX.map((c) => new Set(tokenize(`${c.matchText}`)));

// ---------- complaint embeddings ----------
let cEmb: Float32Array | null = null;
let cLoad: Promise<Float32Array> | null = null;

export function loadComplaintEmbeddings(): Promise<Float32Array> {
  if (cEmb) return Promise.resolve(cEmb);
  if (cLoad) return cLoad;
  cLoad = fetch("/complaint-embeddings.bin")
    .then((r) => {
      if (!r.ok) throw new Error("failed to load complaint embeddings");
      return r.arrayBuffer();
    })
    .then((buf) => {
      cEmb = new Float32Array(buf);
      return cEmb;
    });
  return cLoad;
}

export interface ProductMatch {
  product: string;
  /** 0..1 overall complaint-match confidence */
  score: number;
  /** Indications from the Excel DB that matched the query, best first */
  matchedIndications: string[];
  /** Remaining indications for this product */
  otherIndications: string[];
  /** All official indications */
  allIndications: string[];
  /** Supporting passages from the indexed PDFs, deduplicated */
  passages: SearchResult[];
  guidelineScore: number;
}

function keywordOverlap(qTokens: string[], i: number): number {
  if (!qTokens.length) return 0;
  const set = idxTokens[i];
  let hit = 0;
  for (const t of qTokens) if (set.has(t)) hit++;
  return hit / qTokens.length;
}

/** Complaint → product mappings explicitly removed. */
const EXCLUSIONS: { test: RegExp; products: string[] }[] = [
  {
    // Male infertility and synonyms
    test: /\b(male\s+(factor\s+)?infertil\w*|male\s+subfertil\w*|infertility\s+in\s+men|men'?s?\s+infertil\w*)\b/i,
    products: ["Breast-Well", "FibroMed"],
  },
  {
    // Low sperm quality and synonyms
    test: /\b(sperm|semen|spermatoz\w*|asthenosperm\w*|oligosperm\w*|teratosperm\w*|azoosperm\w*|necrosperm\w*|oligoasthenoteratozoosperm\w*|dfi)\b/i,
    products: ["Ova-Max"],
  },
];

/** In-memory cache of complaint → matches for the session. */
const cache = new Map<string, ProductMatch[]>();


export function matchProducts(
  query: string,
  qVec: Float32Array | null,
  opts: { withEvidence?: boolean } = {},
): ProductMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const key = `${q}|${qVec ? "v" : "k"}|${opts.withEvidence !== false ? "e" : "n"}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const qTokens = tokenize(q);

  // Score each (product, complaint) pair
  const perProduct = new Map<string, { score: number; hits: { label: string; s: number }[] }>();

  for (let i = 0; i < COMPLAINT_INDEX.length; i++) {
    const item = COMPLAINT_INDEX[i];
    const kw = keywordOverlap(qTokens, i);
    let sem = 0;
    if (qVec && cEmb) {
      let s = 0;
      const off = i * DIMS;
      for (let d = 0; d < DIMS; d++) s += qVec[d] * cEmb[off + d];
      // rescale typical cosine range 0.15..0.85
      sem = Math.max(0, (s - 0.2) / 0.6);
    }
    const exact = item.matchText.toLowerCase().includes(q) ? 0.35 : 0;
    const score = Math.min(1, 0.45 * kw + 0.55 * sem + exact);
    if (score < 0.18) continue;
    const bucket = perProduct.get(item.product) ?? { score: 0, hits: [] };
    bucket.hits.push({ label: item.label, s: score });
    perProduct.set(item.product, bucket);
  }

  // Explicit complaint → product exclusions (mapping removed by request).
  const blocked = new Set<string>();
  for (const rule of EXCLUSIONS) {
    if (rule.test.test(q)) for (const p of rule.products) blocked.add(p);
  }
  for (const p of blocked) perProduct.delete(p);

  const matches: ProductMatch[] = [];

  for (const [product, b] of perProduct) {
    b.hits.sort((x, y) => y.s - x.s);
    // best match dominates, additional matches add a small bonus
    const best = b.hits[0].s;
    const bonus = Math.min(0.15, 0.05 * (b.hits.length - 1));
    const all = complaintsFor(product);
    const matched = b.hits.filter((h) => h.s >= Math.max(0.18, best * 0.6)).map((h) => h.label);
    matches.push({
      product,
      score: Math.min(1, best + bonus),
      matchedIndications: matched,
      otherIndications: all.filter((l) => !matched.includes(l)),
      allIndications: all,
      passages: [],
      guidelineScore: 0,
    });
  }

  // Keep only products that are genuinely indicated for this complaint.
  const topScore = matches.reduce((m, x) => Math.max(m, x.score), 0);
  const kept = matches.filter((m) => m.score >= Math.max(0.35, topScore * 0.62)).slice(0, 6);
  matches.length = 0;
  matches.push(...kept);

  // Attach deduplicated PDF evidence per product
  if (opts.withEvidence !== false && matches.length) {

    const passages = hybridSearch(query, qVec, 120);
    const seen = new Set<string>();
    for (const m of matches) {
      const mine = passages.filter((p) => p.product === m.product);
      const uniq: SearchResult[] = [];
      for (const p of mine) {
        const sig = p.text.slice(0, 160).toLowerCase().replace(/\s+/g, " ");
        if (seen.has(sig)) continue;
        seen.add(sig);
        uniq.push(p);
        if (uniq.length >= 6) break;
      }
      m.passages = uniq;
      m.guidelineScore = uniq.reduce((s, p) => s + p.score, 0) / (uniq.length || 1);
    }
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      b.guidelineScore - a.guidelineScore ||
      b.passages.length - a.passages.length ||
      a.product.localeCompare(b.product),
  );

  if (cache.size > 200) cache.clear();
  cache.set(key, matches);
  return matches;
}

export const ALL_PRODUCTS = PRODUCT_DB.map((p) => p.name);
