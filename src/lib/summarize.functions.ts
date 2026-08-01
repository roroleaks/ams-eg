import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PassageSchema = z.object({
  product: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  page: z.number().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  text: z.string(),
});

const LiteratureSchema = z.object({
  title: z.string(),
  authors: z.string(),
  journal: z.string(),
  year: z.string(),
  doi: z.string().nullable(),
  pmid: z.string().nullable(),
  pmcid: z.string().nullable().optional(),
  pubType: z.string(),
});

const Input = z.object({
  query: z.string().min(1).max(500),
  passages: z.array(PassageSchema).max(30),
  literature: z.array(LiteratureSchema).max(20).optional(),
  useGuidelines: z.boolean().default(true).optional(),
  useLiterature: z.boolean().default(true).optional(),
});

export const summarizeResults = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const { getOptionalCaller, permissionDenied, clientKey, enforceRateLimit } = await import(
      "@/lib/ai-guard.server"
    );
    const caller = await getOptionalCaller();
    if (await permissionDenied(caller, "can_summarize")) {
      throw new Error("Summary permission is disabled for your account");
    }
    enforceRateLimit(clientKey("summary", caller.userId), caller.userId ? 30 : 8, 10 * 60_000);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const useGuidelines = data.useGuidelines !== false;
    const useLiterature = data.useLiterature !== false;

    const guidelineContext = data.passages
      .map((p, i) => {
        const cite = [
          p.sourceName,
          p.product,
          p.section,
          p.page != null ? `p. ${p.page}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `SOURCE ${i + 1} (${cite})\n${p.text}`;
      })
      .join("\n\n");

    const litContext = (data.literature ?? [])
      .map((l, i) => {
        const links = [
          l.pmid ? `PubMed https://pubmed.ncbi.nlm.nih.gov/${l.pmid}/` : null,
          l.pmcid ? `PMC https://pmc.ncbi.nlm.nih.gov/articles/${l.pmcid}/` : null,
          l.doi ? `Publisher https://doi.org/${l.doi}` : null,
          l.doi ? `CrossRef https://search.crossref.org/?q=${encodeURIComponent(l.doi)}` : null,
        ]
          .filter(Boolean)
          .join(" | ");
        return `STUDY ${i + 1} "${l.title}" — ${l.authors}. ${l.journal}. ${l.year}. ${l.pubType}\nLINKS: ${links || "(none)"}`;
      })
      .join("\n\n");

    const haveG = useGuidelines && data.passages.length > 0;
    const haveL = useLiterature && (data.literature?.length ?? 0) > 0;

    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const system = `You are a senior clinical evidence-synthesis author writing a formal "Clinical Evidence Report" for physicians. The output must read like a professional medical review article, NOT a retrieval log.

ABSOLUTE RULES:
- NEVER show retrieval identifiers of any kind: no (G1), [G2], (L3), [R4], "Source 5", "Study 2", "Chunk", "Passage", "Vector Score", "Similarity", or any internal metadata.
- NEVER print raw DOI strings such as "doi:10.xxxx/yyyy" or "DOI:10...." anywhere, including References. DOIs may only appear converted into a clickable hyperlink inside the final "Useful Links" section.
- No URLs anywhere except the "Useful Links" section.
- DEDUPLICATE aggressively. Each medication, supplement or active ingredient must appear exactly ONCE in the whole report. Merge every retrieved fact about it into that single entry, including synonyms and brand/INN variants (e.g. CoQ10 = Coenzyme Q10 = Ubiquinone = Ubiquinol; L-Carnitine = Levocarnitine = LC/LAC; Myo-inositol = Inositol; Vitamin B9 = Folate = Folic acid). Choose one canonical heading and list the synonyms in parentheses once.
- Never repeat the same sentence, fact, or recommendation in more than one section.
- Ground every clinical statement in the supplied sources; do NOT fabricate studies, authors, journals, dosages, or findings.
- Use professional, neutral medical register with clean headings and spacing; the document must be suitable for printing or PDF export.`;

    const user = `Topic (clinician's query): "${data.query}"
Date generated: ${today}

Produce a Markdown document with EXACTLY these headings, in this order.

# Clinical Evidence Report

**Topic:** ${data.query}
**Date Generated:** ${today}

---

## Executive Summary
3–6 sentences of flowing prose covering the most important clinical conclusions.

## Guideline Recommendations
${haveG
  ? `Summarize the indexed guideline sources below using only the relevant ### subheadings among: Diagnosis, Risk Factors, Treatment, Follow-up, Clinical Pearls. Do not duplicate content that belongs in Medication Summary — keep drug-specific detail there and reference it only at a high level here.`
  : `Write exactly: *No indexed guideline evidence was found for this query.*`}

## Recent Medical Evidence
${haveL
  ? `Summarize the recent peer-reviewed literature, organized into ### subheadings by study type where applicable (Meta-analyses, Systematic Reviews, Randomized Trials, Cohort Studies). End with a short paragraph stating whether recent evidence **Supports**, **Expands**, or **Challenges** the guideline recommendations.`
  : `Write exactly: *No recent peer-reviewed literature matching this topic was identified.*\n\nDo not expand further in this section.`}

## Medication Summary
List every medication, supplement or active ingredient found in the evidence above. One ### heading per medication (canonical name, with synonyms in parentheses once). Under each heading use exactly these bolded labels as bullets, omitting a label only when no information exists:

- **Mechanism of Action:** one brief sentence.
- **Clinical Benefits:** merged bullet list of all benefits found across every source.
- **Level of Evidence:** e.g. meta-analysis, RCT, cohort, guideline consensus, expert opinion.
- **Recommended Patient Population:** who should receive it.
- **Important Notes:** dosing duration, cautions, contraindications, interactions.

Each medication appears once and only once. If no medications are present in the evidence, write: *No specific medications were identified in the retrieved evidence.*

## Clinical Interpretation
Practical, evidence-based interpretation: implications for practice, patient selection, limitations, and where caution is needed. Do not repeat earlier sections.

## Key Clinical Takeaways
5–10 concise, actionable bullet points, each distinct.

## References

### Indexed Guidelines
${haveG
  ? `Clean bibliography of the guideline documents actually used, one per block:\n\nOrganization or Author.\nDocument title.\nEdition or Year (use "n.d." if unknown).\npp. [page numbers].\n\nDeduplicate identical documents by combining page ranges. No URLs, no DOIs.`
  : `*None.*`}

### Recent Literature
${haveL
  ? `Numbered Vancouver-style entries without DOI or URL:\n\n1. Authors. Title. Journal. Year.\n\nOmit fields that were not provided.`
  : `*None.*`}

## Useful Links
${haveL
  ? `For each cited study, one line beginning with the study's short title followed by clickable Markdown links, using ONLY the links supplied in the LINKS field for that study (labels: PubMed, PMC, Publisher, CrossRef). Convert nothing yourself and invent no URLs. Omit studies with no links. This is the ONLY section allowed to contain URLs.`
  : `*No external links available.*`}

---

INDEXED GUIDELINE SOURCES (internal — never reference by number):
${guidelineContext || "(none provided)"}

---

RECENT LITERATURE (internal — never reference by number):
${litContext || "(none provided)"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (res.status === 429) throw new Error("AI service is busy right now. Please retry shortly.");
    if (res.status === 402) throw new Error("AI credits are exhausted. Please contact the administrator.");
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`summarize ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    let markdown = j.choices[0]?.message?.content ?? "";
    // Safety net: strip any stray raw DOI strings from the body.
    markdown = markdown.replace(/\(?\s*(?:doi|DOI)\s*:\s*10\.[^\s)\]]+\s*\)?/g, "").replace(/[ \t]{2,}/g, " ");
    return { markdown };
  });
