import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import chunksData from "@/data/chunks.json";

type Chunk = {
  page: number | null;
  product: string | null;
  section: string | null;
  text: string;
  sourceName?: string;
};

const chunks = chunksData as Chunk[];

const STOP = new Set([
  "the","a","an","and","or","of","to","in","for","on","with","by","is","are","be",
  "as","at","from","that","this","it","its","was","were","has","have","had","but",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/gi, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

const docTokens: string[][] = chunks.map((c) =>
  tokenize(`${c.text} ${c.section ?? ""} ${c.product ?? ""}`),
);
const df = new Map<string, number>();
docTokens.forEach((toks) => {
  new Set(toks).forEach((t) => df.set(t, (df.get(t) ?? 0) + 1));
});
const N = chunks.length;
const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / N;
const k1 = 1.5;
const b = 0.75;

function score(qTokens: string[], i: number): number {
  const toks = docTokens[i];
  if (!toks.length) return 0;
  const tf = new Map<string, number>();
  toks.forEach((t) => tf.set(t, (tf.get(t) ?? 0) + 1));
  let s = 0;
  for (const q of qTokens) {
    const f = tf.get(q);
    if (!f) continue;
    const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
    s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks.length) / avgLen)));
  }
  return s;
}

export default defineTool({
  name: "search_ams_guidelines",
  title: "Search AMS product guidelines",
  description:
    "Full-text search over America Medic & Science (AMS) product monographs and clinical guidelines. Returns ranked passages with product, section, page, and source document. Use to answer clinician questions grounded in AMS product literature.",
  inputSchema: {
    query: z.string().min(1).max(500).describe("Clinical question or keywords, e.g. 'PCOS inositol dose' or 'endometriosis MetrioMed'."),
    product: z
      .string()
      .optional()
      .describe("Optional exact product name filter, e.g. 'FibroMed', 'MFS Plus', 'WFS Plus'."),
    limit: z.number().int().min(1).max(20).default(8).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: ({ query, product, limit }) => {
    const qTokens = tokenize(query);
    if (!qTokens.length) {
      return { content: [{ type: "text", text: "Empty query." }], isError: true };
    }
    const cap = limit ?? 8;
    const scored: { i: number; s: number }[] = [];
    for (let i = 0; i < N; i++) {
      if (product && chunks[i].product !== product) continue;
      const s = score(qTokens, i);
      if (s > 0) scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, cap).map(({ i, s }) => {
      const c = chunks[i];
      return {
        product: c.product,
        section: c.section,
        page: c.page,
        source: c.sourceName ?? null,
        score: Math.round(s * 100) / 100,
        text: c.text.slice(0, 800),
      };
    });
    const summary =
      top.length === 0
        ? `No AMS passages matched "${query}".`
        : top
            .map(
              (r, k) =>
                `${k + 1}. ${[r.product, r.section, r.page ? `p. ${r.page}` : null, r.source]
                  .filter(Boolean)
                  .join(" · ")}\n${r.text}`,
            )
            .join("\n\n");
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { query, product: product ?? null, results: top },
    };
  },
});
