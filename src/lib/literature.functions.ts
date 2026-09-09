import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  query: z.string().min(1).max(500),
  yearsBack: z.number().int().min(1).max(20).default(5).optional(),
  limit: z.number().int().min(1).max(25).default(12).optional(),
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

export const searchLiterature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }): Promise<LitResult> => {
    const yearsBack = data.yearsBack ?? 5;
    const limit = data.limit ?? 12;
    const now = new Date();
    const fromYear = now.getFullYear() - yearsBack;
    const toYear = now.getFullYear();

    const cacheKey = `${normalizeQuery(data.query)}|${yearsBack}|${limit}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const pending = inflight.get(cacheKey);
    if (pending) return pending;

    const run = (async (): Promise<LitResult> => {
      try {
        // Europe PMC query: peer-reviewed sources (MED = PubMed, PMC = PubMed Central),
        // English, human studies preferred, recent, filter blogs/preprints out.
        // NOT SRC:PPR excludes preprints.
        const q = [
          `(TITLE_ABS:"${data.query.replace(/"/g, "")}" OR "${data.query.replace(/"/g, "")}")`,
          `(SRC:MED OR SRC:PMC)`,
          `LANG:eng`,
          `FIRST_PDATE:[${fromYear}-01-01 TO ${toYear}-12-31]`,
          `NOT SRC:PPR`,
        ].join(" AND ");

        const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
        url.searchParams.set("query", q);
        url.searchParams.set("format", "json");
        url.searchParams.set("resultType", "core");
        url.searchParams.set("pageSize", String(Math.min(25, limit * 2)));
        url.searchParams.set("sort", "P_PDATE_D desc");

        const res = await fetch(url.toString(), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`europepmc ${res.status}: ${t.slice(0, 200)}`);
        }
        const j = (await res.json()) as {
          hitCount?: number;
          resultList?: { result?: Array<Record<string, unknown>> };
        };
        const raw = j.resultList?.result ?? [];

        const items: LiteratureItem[] = raw.map((r) => {
          const pubTypes = (r.pubTypeList as { pubType?: string[] } | undefined)?.pubType ?? [];
          const pubType = Array.isArray(pubTypes) && pubTypes.length ? pubTypes.join("; ") : String(r.pubType ?? "Journal Article");
          const doi = (r.doi as string | undefined) ?? null;
          const pmid = (r.pmid as string | undefined) ?? null;
          const pmcid = (r.pmcid as string | undefined) ?? null;
          const url = doi
            ? `https://doi.org/${doi}`
            : pmid
            ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
            : pmcid
            ? `https://europepmc.org/article/PMC/${pmcid}`
            : "https://europepmc.org/";
          return {
            title: String(r.title ?? "Untitled").replace(/\.$/, ""),
            authors: String(r.authorString ?? "").slice(0, 300),
            journal: String(r.journalTitle ?? r.bookOrReportDetails ?? ""),
            year: String(r.pubYear ?? ""),
            doi,
            pmid,
            pmcid,
            url,
            abstract: String(r.abstractText ?? "").slice(0, 1200),
            pubType,
            evidenceRank: rankPubType(pubType),
          };
        });

        // Filter out obvious low-priority (editorials/letters) if enough higher-tier items
        const highTier = items.filter((i) => i.evidenceRank <= 4);
        const chosen = (highTier.length >= 4 ? highTier : items)
          .sort((a, b) => a.evidenceRank - b.evidenceRank || Number(b.year || 0) - Number(a.year || 0))
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
