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
        return `[G${i + 1}] (${cite})\n${p.text}`;
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
        return `[L${i + 1}] "${l.title}" — ${l.authors} (${cite})`;
      })
      .join("\n\n");

    const haveG = useGuidelines && data.passages.length > 0;
    const haveL = useLiterature && (data.literature?.length ?? 0) > 0;

    const system = `You are a clinical evidence-synthesis assistant for physicians. You have TWO source pools:
- Guideline passages from indexed product monographs (highest priority), cited as [G#].
- Recent peer-reviewed literature from PubMed/Europe PMC (secondary), cited as [L#].

STRICT RULES:
- Ground every statement in the provided sources. Cite inline with [G1], [L2], etc.
- NEVER fabricate citations, DOIs, PMIDs, journals, or study findings.
- If guideline evidence is missing, write exactly: "No indexed guideline evidence was found for this query."
- If literature is missing, write exactly: "No recent peer-reviewed evidence was identified."
- If literature CONFLICTS with the guideline, do not hide the guideline. Present both viewpoints and prefix with: "Recent literature reports findings that differ from the current guideline."
- Keep the guideline recommendation intact even when literature expands or contradicts it.`;

    const user = `Clinician's query: "${data.query}"

Produce a Markdown briefing with EXACTLY these five ## sections in this order:

## Guideline Recommendation
${haveG
  ? "Summarize the indexed guideline passages. For each point cite [G#] AND state Guideline name · Year (if available) · Section · Page inline."
  : 'Write exactly: "No indexed guideline evidence was found for this query."'}

## Recent Evidence
${haveL
  ? "Summarize the recent peer-reviewed literature. For each finding cite [L#] and include the study Title, Authors, Journal, Year, and DOI/PMID inline."
  : 'Write exactly: "No recent peer-reviewed evidence was identified."'}

## Agreement Between Sources
${haveG && haveL
  ? "State whether the literature ✓ Supports, △ Expands upon, or ✗ Conflicts with the guideline. Explain briefly and cite both [G#] and [L#]."
  : "State that comparison is not possible because one source pool is empty."}

## Clinical Interpretation
Practical, prescriber-facing takeaways (patient type, dosing if stated, cautions). Cite everything.

## References
Numbered list. First list guideline sources as: **[G#]** Guideline name — Section, p. Page.
Then list literature as: **[L#]** Authors. Title. *Journal*. Year. DOI: xxx. PMID: xxx.
Only include references that were actually cited above.

---

GUIDELINE PASSAGES (${data.passages.length}):
${guidelineContext || "(none provided)"}

---

RECENT LITERATURE (${data.literature?.length ?? 0}):
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
