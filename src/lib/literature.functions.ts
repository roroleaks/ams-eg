import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  query: z.string().min(1).max(500),
  yearsBack: z.number().int().min(1).max(20).default(5).optional(),
  limit: z.number().int().min(1).max(25).default(12).optional(),
  ingredients: z.array(z.string().min(1).max(80)).max(30).optional(),
});

export interface LiteratureItem {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string | null;
  pmid: string | null;
  pmcid: string | null;
  url: string;
  abstract: string;
  pubType: string;
  evidenceRank: number; // 1 = highest (guideline/meta/SR/RCT)
  openAccess?: boolean;
  matchedIngredients?: string[];
  relevance?: number;
  /** Set by the background validation engine. */
  validated?: boolean;
  validationNote?: string;
}

/**
 * Background validation engine: an AI reviewer reads each candidate's title
 * and abstract and confirms it is clinical evidence linking the complaint to
 * at least one product ingredient. Off-topic papers are removed before the
 * doctor sees results. If the AI step fails, rule-based results are kept.
 */
async function validateEvidence(
  complaint: string,
  ingredients: string[],
  items: LiteratureItem[],
): Promise<LiteratureItem[]> {
  if (!items.length) return items;
  const { getLovableApiKey } = await import("@/lib/lovable-api-key");
  const key = getLovableApiKey();
  if (!key) return items;
  const list = items
    .map((it, i) => `[${i}] ${it.title}\n${it.abstract.slice(0, 700)}`)
    .join("\n\n");
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low" },
        instructions:
          "You are a strict clinical evidence reviewer. For each paper decide if it provides evidence (efficacy, human mechanism, safety, or guideline) about using at least one listed ingredient for the given complaint. Reject unrelated conditions, unrelated interventions, incidental mentions, or non-clinical topics. Return json.",
        input: `Complaint: ${complaint}\nIngredients: ${ingredients.join(", ") || "(any AMS product component)"}\n\nPapers:\n${list}`,
        text: {
          format: {
            type: "json_schema",
            name: "verdicts",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["results"],
              properties: {
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["i", "keep", "score", "note"],
                    properties: {
                      i: { type: "integer" },
                      keep: { type: "boolean" },
                      score: { type: "number" },
                      note: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!res.ok || !res.body) return items;
    // Consume the SSE stream and accumulate the JSON output text.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let raw = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload) as { type?: string; delta?: string };
          if (ev.type === "response.output_text.delta" && ev.delta) raw += ev.delta;
        } catch { /* ignore partial */ }
      }
    }
    const parsed = JSON.parse(raw) as {
      results?: { i: number; keep: boolean; score?: number; note?: string }[];
    };
    const verdicts = new Map((parsed.results ?? []).map((r) => [r.i, r]));
    if (!verdicts.size) return items;
    return items
      .map((it, i) => ({ it, v: verdicts.get(i) }))
      .filter(({ v }) => v?.keep)
      .sort((a, b) => (b.v?.score ?? 0) - (a.v?.score ?? 0) || a.it.evidenceRank - b.it.evidenceRank)
      .map(({ it, v }) => ({ ...it, validated: true, validationNote: v?.note?.slice(0, 140) }));
  } catch {
    return items;
  }
}

// Rank publication types by evidence strength for medical decision-making
function rankPubType(pubType: string): number {
  const p = pubType.toLowerCase();
  if (p.includes("guideline")) return 1;
  if (p.includes("meta-analysis") || p.includes("meta analysis")) return 1;
  if (p.includes("systematic review")) return 1;
  if (p.includes("randomized controlled trial") || p.includes("randomised controlled trial")) return 2;
  if (p.includes("clinical trial")) return 3;
  if (p.includes("cohort")) return 4;
  if (p.includes("case-control") || p.includes("case control")) return 4;
  if (p.includes("case report")) return 6;
  if (p.includes("editorial") || p.includes("comment") || p.includes("letter") || p.includes("opinion")) return 7;
  if (p.includes("review")) return 3;
  return 5;
}

type LitResult = { items: LiteratureItem[]; total: number; error?: string | null };
type CacheEntry = { at: number; value: LitResult };
const TTL_MS = 15 * 60 * 1000; // 15 min
const MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<LitResult>>();

function normalizeQuery(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}


function ingredientTerms(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const inner = n.match(/\(([^)]+)\)/)?.[1];
    const base = n.replace(/\([^)]*\)/g, "").replace(/\bextract\b/gi, "").trim();
    if (base.length > 2) out.add(base);
    if (inner) for (const t of inner.split(/[,/]/)) if (t.trim().length > 2) out.add(t.trim());
  }
  return [...out].map((t) => t.replace(/["()]/g, "")).slice(0, 24);
}

const STOP = new Set(["the","and","or","of","in","for","with","to","a","an","on","due","patient","women","men"]);
function complaintTokens(q: string): string[] {
  return q.toLowerCase().replace(/[^a-z0-9\- ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
}

async function epmc(query: string, pageSize: number) {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(pageSize));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`europepmc ${res.status}`);
  return (await res.json()) as { hitCount?: number; resultList?: { result?: Array<Record<string, unknown>> } };
}

export const searchLiterature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }): Promise<LitResult> => {
    const yearsBack = data.yearsBack ?? 5;
    const limit = data.limit ?? 12;
    const now = new Date();
    const fromYear = now.getFullYear() - yearsBack;
    const toYear = now.getFullYear();

    const cacheKey = `${normalizeQuery(data.query)}|${yearsBack}|${limit}|${(data.ingredients ?? []).slice().sort().join(",")}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const run = (async (): Promise<LitResult> => {
      try {
        // Evidence logic: a paper is relevant only if it links the complaint
        // to at least one active ingredient of the matched products. Europe
        // PMC (free PubMed/PMC API) is queried for complaint AND ingredient in
        // title/abstract, peer-reviewed only, then re-ranked locally.
        const ingTerms = ingredientTerms(data.ingredients ?? []);
        const toks = complaintTokens(data.query);
        const clean = data.query.replace(/["()]/g, "");
        const complaintClause = toks.length > 1
          ? `(TITLE_ABS:"${clean}" OR (${toks.map((t) => `TITLE_ABS:${t}`).join(" AND ")}))`
          : `TITLE_ABS:"${clean}"`;
        const ingClause = ingTerms.length
          ? `(${ingTerms.map((t) => `TITLE_ABS:"${t}"`).join(" OR ")})`
          : null;
        const build = (from: number) => [
          complaintClause,
          ingClause,
          `(SRC:MED OR SRC:PMC)`,
          `LANG:eng`,
          `FIRST_PDATE:[${from}-01-01 TO ${toYear}-12-31]`,
          `NOT PUB_TYPE:"Preprint"`,
          `NOT SRC:PPR`,
        ].filter(Boolean).join(" AND ");

        let j = await epmc(build(fromYear), 100);
        if ((j.resultList?.result?.length ?? 0) < 4) j = await epmc(build(toYear - 12), 100);
        const raw = j.resultList?.result ?? [];

        const items: LiteratureItem[] = raw.map((r) => {
          const pubTypes = (r.pubTypeList as { pubType?: string[] } | undefined)?.pubType ?? [];
          const pubType = Array.isArray(pubTypes) && pubTypes.length ? pubTypes.join("; ") : String(r.pubType ?? "Journal Article");
          const doi = (r.doi as string | undefined) ?? null;
          const pmid = (r.pmid as string | undefined) ?? null;
          const pmcid = (r.pmcid as string | undefined) ?? null;
          const openAccess = r.isOpenAccess === "Y" || !!pmcid;
          const url = pmcid
            ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`
            : doi
            ? `https://doi.org/${doi}`
            : pmid
            ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
            : "https://europepmc.org/";
          const title = String(r.title ?? "Untitled").replace(/\.$/, "");
          const abstract = String(r.abstractText ?? "").replace(/<[^>]+>/g, "");
          const tl = title.toLowerCase();
          const al = abstract.toLowerCase();
          const matchedIngredients = ingTerms.filter((t) => al.includes(t.toLowerCase()) || tl.includes(t.toLowerCase()));
          let relevance = 0;
          for (const t of ingTerms) {
            const k = t.toLowerCase();
            if (tl.includes(k)) relevance += 3; else if (al.includes(k)) relevance += 1;
          }
          for (const t of toks) {
            if (tl.includes(t)) relevance += 2; else if (al.includes(t)) relevance += 0.5;
          }
          if (/human|patients|women|men|randomi[sz]ed/i.test(abstract)) relevance += 1;
          if (/\b(mice|rats?|murine|in vitro|cell line)\b/i.test(title)) relevance -= 2;
          if (openAccess) relevance += 0.5;
          return {
            title,
            authors: String(r.authorString ?? "").slice(0, 300),
            journal: String(r.journalTitle ?? r.bookOrReportDetails ?? ""),
            year: String(r.pubYear ?? ""),
            doi, pmid, pmcid, url,
            abstract: abstract.slice(0, 1200),
            pubType,
            evidenceRank: rankPubType(pubType),
            openAccess,
            matchedIngredients,
            relevance,
          };
        });

        // Strict evidence gate: Tier 1 (guideline / systematic review /
        // meta-analysis) and Tier 2 (RCT / placebo-controlled) human studies
        // only. Design is read from pubType AND title/abstract text.
        const NOTICE = /^(retraction|retracted|erratum|correction|corrigendum|expression of concern|author'?s? reply|reply|comment|letter|study protocol)\b/i;
        const PRECLIN = /\b(mice|mouse|murine|rats?|rodents?|zebrafish|in vitro|cell lines?|cell culture|granulosa cells|animal model)\b/i;
        const tierOf = (i: LiteratureItem): number => {
          const t = `${i.pubType} ${i.title}`.toLowerCase();
          const a = i.abstract.toLowerCase();
          if (/protocol/.test(i.title.toLowerCase())) return 9;
          if (/guideline|consensus statement|meta-analys|meta analys|systematic review/.test(t) || /\b(systematic review|meta-analysis)\b/.test(a.slice(0, 400))) return 1;
          if (/randomi[sz]ed|placebo-controlled|double-blind/.test(t) || /\b(randomi[sz]ed|placebo-controlled|double-blind)\b/.test(a)) return 2;
          return 9;
        };
        const finalItems = items
          .filter((i) =>
            i.abstract.length > 50 && !NOTICE.test(i.title) &&
            !PRECLIN.test(i.title) && !(PRECLIN.test(i.abstract) && !/\b(patients|women|men|participants|subjects|humans?)\b/i.test(i.abstract)) &&
            (ingTerms.length === 0 || (i.matchedIngredients?.length ?? 0) > 0),
          )
          .map((i) => ({ ...i, evidenceRank: tierOf(i) }))
          .filter((i) => i.evidenceRank <= 2)
          .sort((a, b) => a.evidenceRank - b.evidenceRank || (b.relevance ?? 0) - (a.relevance ?? 0) || Number(b.year || 0) - Number(a.year || 0))
          .slice(0, limit);
        return { items: finalItems, total: finalItems.length, error: null };
      } catch {
        // Bounded failure: never let a slow/unreachable medical-literature
        // provider leave the UI spinning. Return an empty, graceful result.
        return {
          items: [],
          total: 0,
          error:
            "Medical literature search is temporarily unavailable. Please try again later.",
        };
      }
    })();

    inflight.set(cacheKey, run);
    try {
      const value = await run;
      if (!value.error) {
        cache.set(cacheKey, { at: Date.now(), value });
        if (cache.size > MAX_ENTRIES) {
          // Evict oldest
          const oldestKey = cache.keys().next().value;
          if (oldestKey) cache.delete(oldestKey);
        }
      }
      return value;
    } finally {
      inflight.delete(cacheKey);
    }
  });
