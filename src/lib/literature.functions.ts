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
  url.searchParams.set("sort", "RELEVANCE");
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

        let j = await epmc(build(fromYear), 50);
        if ((j.resultList?.result?.length ?? 0) < 4) j = await epmc(build(toYear - 12), 50);
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

        // Drop papers that don't actually discuss an ingredient (when known)
        // or that lack an abstract to verify relevance.
        const relevant = items.filter((i) =>
          i.abstract.length > 50 && (ingTerms.length === 0 || (i.matchedIngredients?.length ?? 0) > 0),
        );
        const highTier = relevant.filter((i) => i.evidenceRank <= 4);
        const pool = highTier.length >= 4 ? highTier : relevant;
        const chosen = pool
          .sort((a, b) => {
            const sa = (a.relevance ?? 0) + (7 - a.evidenceRank) * 1.2;
            const sb = (b.relevance ?? 0) + (7 - b.evidenceRank) * 1.2;
            return sb - sa || Number(b.year || 0) - Number(a.year || 0);
          })
          .slice(0, limit);

        return { items: chosen, total: j.hitCount ?? chosen.length, error: null };
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
