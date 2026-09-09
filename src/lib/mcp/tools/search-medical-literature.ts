import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

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

export default defineTool({
  name: "search_medical_literature",
  title: "Search recent peer-reviewed medical literature",
  description:
    "Search Europe PMC for recent peer-reviewed medical literature (PubMed + PMC, English, preprints excluded), ranked by evidence strength (guidelines / meta-analyses / systematic reviews first). Returns title, authors, journal, year, DOI, PMID, and abstract.",
  inputSchema: {
    query: z.string().min(1).max(500).describe("Clinical topic or PICO-style query."),
    yearsBack: z.number().int().min(1).max(20).default(5).optional(),
    limit: z.number().int().min(1).max(25).default(10).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  handler: async ({ query, yearsBack, limit }) => {
    const yb = yearsBack ?? 5;
    const cap = limit ?? 10;
    const now = new Date();
    const fromYear = now.getFullYear() - yb;
    const toYear = now.getFullYear();
    const clean = query.replace(/"/g, "");
    const q = [
      `(TITLE_ABS:"${clean}" OR "${clean}")`,
      `(SRC:MED OR SRC:PMC)`,
      `LANG:eng`,
      `FIRST_PDATE:[${fromYear}-01-01 TO ${toYear}-12-31]`,
      `NOT SRC:PPR`,
    ].join(" AND ");

    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.searchParams.set("query", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", String(Math.min(25, cap * 2)));
    url.searchParams.set("sort", "P_PDATE_D desc");

    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      return {
        content: [{ type: "text", text: `Europe PMC error ${res.status}` }],
        isError: true,
      };
    }
    const j = (await res.json()) as {
      hitCount?: number;
      resultList?: { result?: Array<Record<string, unknown>> };
    };
    const raw = j.resultList?.result ?? [];
    const items = raw
      .map((r) => {
        const pubTypes = (r.pubTypeList as { pubType?: string[] } | undefined)?.pubType ?? [];
        const pubType = Array.isArray(pubTypes) && pubTypes.length
          ? pubTypes.join("; ")
          : String(r.pubType ?? "Journal Article");
        const doi = (r.doi as string | undefined) ?? null;
        const pmid = (r.pmid as string | undefined) ?? null;
        return {
          title: String(r.title ?? "Untitled").replace(/\.$/, ""),
          authors: String(r.authorString ?? "").slice(0, 300),
          journal: String(r.journalTitle ?? ""),
          year: String(r.pubYear ?? ""),
          doi,
          pmid,
          pubType,
          abstract: String(r.abstractText ?? "").slice(0, 1000),
          url: doi
            ? `https://doi.org/${doi}`
            : pmid
              ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
              : "https://europepmc.org/",
          evidenceRank: rankPubType(pubType),
        };
      })
      .sort((a, b) => a.evidenceRank - b.evidenceRank || Number(b.year || 0) - Number(a.year || 0))
      .slice(0, cap);

    const summary = items.length
      ? items
          .map(
            (it, i) =>
              `${i + 1}. ${it.title}\n   ${it.authors}. ${it.journal}. ${it.year}. ${it.pubType}${it.doi ? ` doi:${it.doi}` : ""}${it.pmid ? ` PMID:${it.pmid}` : ""}\n   ${it.abstract}`,
          )
          .join("\n\n")
      : `No literature found for "${query}".`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { query, total: j.hitCount ?? items.length, items },
    };
  },
});
