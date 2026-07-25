import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


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
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    const { data: perm } = await context.supabase
      .from("user_permissions")
      .select("can_summarize")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (perm && perm.can_summarize === false) {
      throw new Error("Summary permission is disabled for your account");
    }

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
        const cite = [
          l.journal,
          l.year,
          l.pubType,
          l.doi ? `DOI:${l.doi}` : null,
          l.pmid ? `PMID:${l.pmid}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `STUDY ${i + 1} "${l.title}" — ${l.authors} (${cite})`;
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

ABSOLUTE FORMATTING RULES:
- NEVER show retrieval identifiers of any kind in the body: no (G1), [G2], (L3), [R4], "Source 5", "Study 2", "Chunk", "Passage", "Vector Score", "Similarity", or similar internal metadata.
- NEVER place URLs, DOIs, or PMIDs in the body prose. URLs appear ONLY in the final "Useful Links" section. DOI/PMID appear ONLY in the References section.
- Write clean, flowing medical prose. Do NOT interrupt sentences or paragraphs with reference labels.
- Ground every clinical statement in the supplied sources; do NOT fabricate studies, authors, DOIs, PMIDs, journals, dosages, or findings.
- Use professional, neutral medical register.`;

    const user = `Topic (clinician's query): "${data.query}"
Date generated: ${today}

Produce a Markdown document with EXACTLY this structure and these headings, in this order. Follow every rule precisely.

# Clinical Evidence Report

**Topic:** ${data.query}
**Date Generated:** ${today}

---

## Executive Summary
Write 3–6 sentences summarizing the most important clinical conclusions in flowing prose. No citation tags. No URLs.

## Guideline Recommendations
${haveG
  ? `Summarize the recommendations extracted from the indexed guideline sources below. Organize into logical ### subheadings chosen from (only include those relevant to the topic): Diagnosis, Risk Factors, Treatment, Follow-up, Clinical Pearls. Write in professional medical language. Do not repeat information. Absolutely no inline citation tags or source labels — the reader will find sources in the References section.`
  : `Write exactly: *No indexed guideline evidence was found for this query.*`}

## Recent Medical Evidence
${haveL
  ? `Summarize the recent peer-reviewed literature provided below, organized into ### subheadings by study type where applicable (Meta-analyses, Systematic Reviews, Randomized Trials, Cohort Studies). At the end of this section include a short paragraph stating whether recent evidence **Supports**, **Expands**, or **Challenges** the guideline recommendations. No inline citation tags. No URLs.`
  : `Write exactly: *No recent peer-reviewed literature matching this topic was identified.*\n\nDo not expand further in this section.`}

## Clinical Interpretation
Provide a practical, evidence-based interpretation for clinicians. Focus on implications for practice, patient selection, limitations, and situations where caution is needed. Do not repeat earlier sections. No citation tags. No URLs.

## Key Clinical Takeaways
Provide 5–10 concise bullet points with the most important actionable messages. No citation tags. No URLs.

## References

### Indexed Guidelines
${haveG
  ? `List every indexed guideline source that was actually used, one per line block, formatted as:\n\nOrganization or Author.\nDocument title.\nEdition or Year (use "n.d." if unknown).\npp. [page numbers].\n\nDeduplicate identical documents by combining page ranges. No URLs here.`
  : `*None.*`}

### Recent Literature
${haveL
  ? `List each cited study in Vancouver style, one per numbered entry:\n\n1. Authors. Title. Journal. Year;Volume:Pages. doi:XXXX. PMID:XXXX.\n\nOmit fields that were not provided. No URLs in this block — URLs go in Useful Links.`
  : `*None.*`}

## Useful Links
${haveL
  ? `List clickable Markdown hyperlinks for the recent literature only, one per line, using these labels when the identifier is available:\n\n- [PubMed](https://pubmed.ncbi.nlm.nih.gov/{PMID}/)\n- [DOI](https://doi.org/{DOI})\n\nIf neither PMID nor DOI is available for a study, omit it. Do NOT invent URLs. This is the ONLY section allowed to contain URLs.`
  : `*No external links available.*`}

---

INDEXED GUIDELINE SOURCES (internal — do NOT reference by number in the body):
${guidelineContext || "(none provided)"}

---

RECENT LITERATURE (internal — do NOT reference by number in the body):
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
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`summarize ${res.status}: ${t.slice(0, 300)}`);
    }
    const j = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return { markdown: j.choices[0]?.message?.content ?? "" };
  });
