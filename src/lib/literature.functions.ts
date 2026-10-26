import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PRODUCT_DB } from "@/data/complaints";
import { dedupeEvidenceRaw, evidenceTier, mentions, qualifiesEvidence } from "@/lib/literature-relevance";

// Clinical synonyms for the searched complaint: if the query matches a known
// complaint label or alias, search PubMed with every known phrasing of that
// complaint (e.g. "isolated asthenospermia" also tries "asthenozoospermia").
function complaintPhrases(query: string): string[] {
  const clean = query.replace(/["()]/g, "").trim();
  const n = clean.toLowerCase();
  const out = new Set<string>([clean]);
  for (const p of PRODUCT_DB)
    for (const c of p.complaints) {
      const texts = [c.label, ...(c.aliases ?? [])];
      if (texts.some((t) => t.toLowerCase() === n))
        for (const t of texts) out.add(t);
    }
  return [...out].filter((t) => t.length > 2).slice(0, 8);
}

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

type LitResult = { items: LiteratureItem[]; total: number; error?: string | null; sourceStatus?: Record<string, "ok" | "unavailable"> };
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
// Qualifier words that must not be required in the keyword fallback: a paper
// about "uterine fibroid" is relevant to "small uterine fibroid" even if it
// never says "small".
const QUALIFIER = new Set(["small","medium","severe","low","high","first","second","isolated","suspected","diagnosed","confirmed","possible","poor","progressive","recurrent","young","advanced","stage","grade","below","related","pre","post","operative","support","index","rate","level","concentration","changes","cyclic","cyclical","benign","triple","defect","idiopathic","unexplained"]);
function coreTokens(toks: string[]): string[] {
  const core = toks.filter((t) => !QUALIFIER.has(t) && !/^\d+$/.test(t));
  return core.length ? core : toks;
}
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

// ---- PubMed (NCBI E-utilities) fallback ---------------------------------
// Used when the Europe PMC gateway is unreachable or rate-limiting. Returns
// records in the same shape Europe PMC produces so downstream ranking and
// filtering run unchanged.

function xmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? xmlText(m[1]) : "";
}

// NCBI allows ~3 requests/second per client; serialize and back off on 429.
let ncbiQueue: Promise<unknown> = Promise.resolve();
function ncbiFetch(url: string, timeoutMs: number): Promise<Response> {
  const run = ncbiQueue.then(async () => {
    let lastErr: unknown = new Error("ncbi unavailable");
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.status !== 429) return res;
        lastErr = new Error("ncbi 429");
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1) * (attempt + 1)));
    }
    throw lastErr;
  });
  ncbiQueue = run.catch(() => {}).then(() => new Promise((r) => setTimeout(r, 450)));
  return run;
}

async function pubmed(term: string, retmax: number): Promise<Array<Record<string, unknown>>> {
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
  const es = await ncbiFetch(`${base}/esearch.fcgi?db=pubmed&retmode=json&retmax=${retmax}&sort=relevance&term=${encodeURIComponent(term)}`, 12000);
  if (!es.ok) throw new Error(`pubmed esearch ${es.status}`);
  const esJson = (await es.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = esJson.esearchresult?.idlist ?? [];
  if (!ids.length) return [];
  const ef = await ncbiFetch(`${base}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}`, 15000);
  if (!ef.ok) throw new Error(`pubmed efetch ${ef.status}`);
  const xml = await ef.text();
  const out: Array<Record<string, unknown>> = [];
  for (const m of xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)) {
    const a = m[0];
    const pmid = tag(a, "PMID");
    const authors = [...a.matchAll(/<Author[\s>][\s\S]*?<\/Author>/g)].slice(0, 40).map((x) => {
      const last = tag(x[0], "LastName"); const init = tag(x[0], "Initials");
      return last ? `${last} ${init}`.trim() : tag(x[0], "CollectiveName");
    }).filter(Boolean);
    const pubTypes = [...a.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g)].map((x) => xmlText(x[1]));
    const doi = a.match(/<ArticleId IdType="doi">([^<]+)<\/ArticleId>/)?.[1]?.trim() ?? null;
    const pmcRaw = a.match(/<ArticleId IdType="pmc">([^<]+)<\/ArticleId>/)?.[1]?.trim() ?? null;
    const pmcid = pmcRaw ? (pmcRaw.startsWith("PMC") ? pmcRaw : `PMC${pmcRaw}`) : null;
    const year = tag(a, "Year") || a.match(/<MedlineDate>(\d{4})/)?.[1] || "";
    out.push({
      title: tag(a, "ArticleTitle"),
      abstractText: tag(a, "Abstract"),
      authorString: authors.join(", ").slice(0, 600),
      journalTitle: tag(a, "Title") && a.includes("<Journal>") ? tag(a.slice(a.indexOf("<Journal>")), "Title") : "",
      pubYear: year,
      doi, pmid, pmcid,
      isOpenAccess: pmcid ? "Y" : "N", source: "PubMed",
      pubTypeList: { pubType: pubTypes },
    });
  }
  return out;
}

// ---- Additional open scholarly sources ----------------------------------
type Raw = Record<string, unknown>;
const UA = "AMS-Product-Advisor/1.0 (mailto:raouf66@gmail.com)";
const freeQuery = (phrases: string[], ing: string[]) =>
  `${phrases[0] ?? ""} ${ing.slice(0, 3).join(" ")}`.trim();

async function getJson<T>(url: string, ms = 10000): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return (await res.json()) as T;
}

async function openAlex(phrases: string[], ing: string[], from: number, toDate: string): Promise<Raw[]> {
  const c = phrases.slice(0, 3).map((p) => `"${p}"`).join(" OR ");
  const i = ing.slice(0, 8).map((t) => `"${t}"`).join(" OR ");
  const search = i ? `(${c}) AND (${i})` : c;
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(search)}&filter=from_publication_date:${from}-01-01,to_publication_date:${toDate},language:en,type:article|review&per-page=50&mailto=raouf66@gmail.com`;
  const j = await getJson<{ results?: Array<Record<string, any>> }>(url);
  return (j.results ?? []).map((w) => {
    const inv = w.abstract_inverted_index as Record<string, number[]> | null;
    let abstract = "";
    if (inv) {
      const pos: string[] = [];
      for (const [word, idx] of Object.entries(inv)) for (const k of idx) pos[k] = word;
      abstract = pos.filter(Boolean).join(" ");
    }
    const doi = w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//, "") : null;
    const pmid = w.ids?.pmid ? String(w.ids.pmid).split("/").pop() : null;
    const pmcRaw = w.ids?.pmcid ? String(w.ids.pmcid).split("/").pop() : null;
    return {
      title: w.title ?? w.display_name ?? "", abstractText: abstract,
      authorString: (w.authorships ?? []).slice(0, 20).map((a: any) => a.author?.display_name).filter(Boolean).join(", "),
      journalTitle: w.primary_location?.source?.display_name ?? "",
      pubYear: String(w.publication_year ?? ""), doi, pmid, pmcid: pmcRaw,
      isOpenAccess: w.open_access?.is_oa ? "Y" : "N",
      pubTypeList: { pubType: [w.type === "review" ? "Review" : "Journal Article"] }, source: "OpenAlex",
    };
  });
}

async function semanticScholar(phrases: string[], ing: string[], from: number, to: number): Promise<Raw[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(freeQuery(phrases, ing))}&year=${from}-${to}&limit=50&fields=title,abstract,authors,venue,year,externalIds,publicationTypes,isOpenAccess`;
  const j = await getJson<{ data?: Array<Record<string, any>> }>(url);
  return (j.data ?? []).map((p) => {
    const types: string[] = p.publicationTypes ?? [];
    return {
      title: p.title ?? "", abstractText: p.abstract ?? "",
      authorString: (p.authors ?? []).slice(0, 20).map((a: any) => a.name).join(", "),
      journalTitle: p.venue ?? "", pubYear: String(p.year ?? ""),
      doi: p.externalIds?.DOI ?? null, pmid: p.externalIds?.PubMed ?? null,
      pmcid: p.externalIds?.PubMedCentral ? `PMC${String(p.externalIds.PubMedCentral).replace(/^PMC/, "")}` : null,
      isOpenAccess: p.isOpenAccess ? "Y" : "N",
      pubTypeList: { pubType: types.map((t) => t === "MetaAnalysis" ? "Meta-Analysis" : t === "ClinicalTrial" ? "Clinical Trial" : t) },
      source: "Semantic Scholar",
    };
  });
}

async function crossref(phrases: string[], ing: string[], from: number, toDate: string): Promise<Raw[]> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(freeQuery(phrases, ing))}&filter=from-pub-date:${from}-01-01,until-pub-date:${toDate},type:journal-article,has-abstract:true&rows=40&select=DOI,title,author,container-title,issued,abstract&mailto=raouf66@gmail.com`;
  const j = await getJson<{ message?: { items?: Array<Record<string, any>> } }>(url);
  return (j.message?.items ?? []).map((w) => ({
    title: (w.title ?? [""])[0], abstractText: xmlText(String(w.abstract ?? "")).replace(/^Abstract\s*/i, ""),
    authorString: (w.author ?? []).slice(0, 20).map((a: any) => `${a.family ?? ""} ${a.given?.[0] ?? ""}`.trim()).join(", "),
    journalTitle: (w["container-title"] ?? [""])[0], pubYear: String(w.issued?.["date-parts"]?.[0]?.[0] ?? ""),
    doi: w.DOI ?? null, pmid: null, pmcid: null, isOpenAccess: "N",
    pubTypeList: { pubType: ["Journal Article"] }, source: "Crossref",
  }));
}

// Merge sources: one record per DOI/PMID/title, keeping the richest copy.
export const searchLiterature = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }): Promise<LitResult> => {
    const yearsBack = data.yearsBack ?? 5;
    const limit = data.limit ?? 12;
    const now = new Date();
    const fromYear = now.getFullYear() - yearsBack;
    const toYear = now.getFullYear();
    const toDate = now.toISOString().slice(0, 10);

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
        const phrases = complaintPhrases(data.query);
        const core = coreTokens(toks);
        const complaintClause = `(${phrases.map((p) => `TITLE_ABS:"${p}"`).join(" OR ")} OR (${core.map((t) => `TITLE_ABS:${t}`).join(" AND ")}))`;
        const ingClause = ingTerms.length
          ? `(${ingTerms.map((t) => `TITLE_ABS:"${t}"`).join(" OR ")})`
          : null;
        const build = (from: number) => [
          complaintClause,
          ingClause,
          `(SRC:MED OR SRC:PMC)`,
          `LANG:eng`,
          `FIRST_PDATE:[${from}-01-01 TO ${toDate}]`,
        ].filter(Boolean).join(" AND ") + ' NOT PUB_TYPE:"Preprint" NOT SRC:PPR';
        // Same logic translated to PubMed E-utilities syntax.
        const buildPubmed = (from: number) => [
          `(${phrases.map((p) => `"${p}"[Title/Abstract]`).join(" OR ")} OR (${core.map((t) => `${t}[Title/Abstract]`).join(" AND ")}))`,
          ingTerms.length ? `(${ingTerms.map((t) => `"${t}"[Title/Abstract]`).join(" OR ")})` : null,
          `english[Language]`,
          `("${from}/01/01"[Date - Publication] : "${toDate.replace(/-/g, "/")}"[Date - Publication])`,
        ].filter(Boolean).join(" AND ") + " NOT preprint[Publication Type]";

        const sourceStatus: Record<string, "ok" | "unavailable"> = {};
        const source = async (name: string, load: () => Promise<Raw[]>): Promise<Raw[]> => {
          try {
            const rows = await load();
            sourceStatus[name] = "ok";
            return rows;
          } catch (err) {
            sourceStatus[name] = "unavailable";
            console.warn(`Literature source unavailable: ${name}`, err instanceof Error ? err.message : "request failed");
            return [];
          }
        };
        const primary = (async () => {
          const rows = await source("Europe PMC", async () => {
            const j = await epmc(build(fromYear), 100);
            return (j.resultList?.result ?? []).map(r => ({ ...r, source: "Europe PMC" }));
          });
          if (sourceStatus["Europe PMC"] === "ok") return rows;
          return source("PubMed", () => pubmed(buildPubmed(fromYear), 100));
        })();
        const batches = await Promise.all([
          primary,
          source("OpenAlex", () => openAlex(phrases, ingTerms, fromYear, toDate)),
          source("Semantic Scholar", () => semanticScholar(phrases, ingTerms, fromYear, toYear)),
          source("Crossref", () => crossref(phrases, ingTerms, fromYear, toDate)),
        ]);
        if (!Object.values(sourceStatus).some(s => s === "ok")) {
          return { items: [], total: 0, sourceStatus, error: "Medical literature sources are temporarily unavailable. Please try again shortly." };
        }
        const raw = dedupeEvidenceRaw(batches.flat());

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
          const matchedIngredients = ingTerms.filter((t) => mentions(abstract, t) || mentions(title, t));
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
            abstract,
            pubType,
            evidenceRank: 9,
            openAccess,
            matchedIngredients,
            relevance,
          };
        });

        const finalItems = items
          .filter(i => qualifiesEvidence(i, phrases, core, ingTerms, fromYear, toYear))
          .map(i => ({ ...i, evidenceRank: evidenceTier(i) }))
          .sort((a, b) => a.evidenceRank - b.evidenceRank || Number(b.year) - Number(a.year) || (b.relevance ?? 0) - (a.relevance ?? 0))
          .slice(0, limit);
        return { items: finalItems, total: finalItems.length, error: null, sourceStatus };
      } catch (err) {
        console.error("searchLiterature failed:", err);
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
