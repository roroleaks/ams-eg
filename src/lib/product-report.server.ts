export interface ReportProduct {
  name: string;
  matchedIndications: string[];
  otherIndications: string[];
  passages: {
    section?: string | null;
    page?: number | null;
    sourceName?: string | null;
    text: string;
  }[];
}

export interface ReportLiterature {
  title: string;
  authors: string;
  journal: string;
  year: string;
  doi: string | null;
  pmid: string | null;
  pmcid?: string | null;
  pubType: string;
}

export interface ReportInput {
  complaint: string;
  products: ReportProduct[];
  literature?: ReportLiterature[];
}

/** Builds the Clinical Product Report markdown via the Lovable AI gateway. */
export async function generateProductReport(data: ReportInput): Promise<string> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("Missing LOVABLE_API_KEY");

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const productContext = data.products
    .map((p) => {
      const seen = new Set<string>();
      const ev = p.passages
        .filter((s) => {
          const sig = s.text.slice(0, 120).toLowerCase().replace(/\s+/g, " ");
          if (seen.has(sig)) return false;
          seen.add(sig);
          return true;
        })
        .map((s) => {
          const cite = [s.sourceName, s.section, s.page != null ? `p. ${s.page}` : null]
            .filter(Boolean)
            .join(" · ");
          return `- (${cite}) ${s.text.slice(0, 800)}`;
        })
        .join("\n");
      return `PRODUCT: ${p.name}
Official indications matching the complaint: ${p.matchedIndications.join("; ") || "(none)"}
Other official indications: ${p.otherIndications.join("; ") || "(none)"}
Indexed evidence:
${ev || "(no indexed passages)"}`;
    })
    .join("\n\n");

  const litContext = (data.literature ?? [])
    .map((l) => {
      const links = [
        l.pmid ? `PubMed https://pubmed.ncbi.nlm.nih.gov/${l.pmid}/` : null,
        l.pmcid ? `PMC https://pmc.ncbi.nlm.nih.gov/articles/${l.pmcid}/` : null,
        l.doi ? `Publisher https://doi.org/${l.doi}` : null,
        l.doi ? `CrossRef https://search.crossref.org/?q=${encodeURIComponent(l.doi)}` : null,
        l.doi ? `OpenAlex https://openalex.org/works?filter=doi:${encodeURIComponent(l.doi)}` : null,
      ]
        .filter(Boolean)
        .join(" | ");
      return `"${l.title}" — ${l.authors}. ${l.journal}. ${l.year}. ${l.pubType}\nLINKS: ${links || "(none)"}`;
    })
    .join("\n\n");

  const haveL = (data.literature?.length ?? 0) > 0;

  const system = `You are a senior clinical pharmacologist writing a formal "Clinical Product Report" that helps a physician choose an America Medic & Science (AMS) product for one specific patient complaint.

ABSOLUTE RULES:
- NEVER show retrieval identifiers: no (G1), [R2], "Source 3", "Chunk", "Passage", "Similarity", "Vector Score", or any internal metadata.
- NEVER print raw DOI strings anywhere. DOIs may only appear as clickable https://doi.org/... hyperlinks inside "Useful Links".
- URLs appear ONLY in the "Useful Links" section.
- Each product appears exactly ONCE in the whole report. Merge everything known about it into that single entry.
- Never repeat the same sentence or fact in two sections.
- Ground every clinical statement in the supplied evidence; never invent studies, authors, dosages, or findings. If active ingredients are not stated in the evidence, write "Not specified in the indexed documents".
- Professional, neutral medical register; clean headings and spacing; suitable for printing or PDF export.`;

  const user = `Patient complaint: "${data.complaint}"
Date generated: ${today}

Produce Markdown with EXACTLY these headings, in this order.

# Clinical Product Report

**Patient Complaint:** ${data.complaint}
**Date Generated:** ${today}

---

## Executive Summary
3–6 sentences: which AMS products are indicated for this complaint and why, plus the overall strength of the supporting evidence.

## Products Recommended
One ### heading per product, in the order supplied. Under each, use exactly these bolded bullet labels (omit a label only when no information exists):

- **Active Ingredients:**
- **Mechanism of Action:**
- **How it addresses this complaint:**
- **Supporting evidence from indexed documents:**
- **Recent peer-reviewed literature:**
- **Clinical pearls:**

## Comparison Table
A Markdown table with columns: Product | Active Ingredients | Mechanism | Main Indication | Advantages | Supporting Evidence. One row per product, concise cells.

## References

### Indexed Documents
Clean bibliography of the indexed documents actually used, one per block:

Organization or Author.
Document title.
Year (use "n.d." if unknown).
pp. [page numbers].

Deduplicate identical documents by merging page ranges. No URLs, no DOIs.

### Recent Literature
${haveL ? `Numbered Vancouver-style entries without DOI or URL:\n\n1. Authors. Title. Journal. Year.` : `*None.*`}

## Useful Links
${haveL
  ? `Present as a Markdown bullet list. Each bullet on its own line begins with the study's short title, followed by clickable Markdown links using ONLY the links supplied in that study's LINKS field (labels: PubMed, PMC, Publisher, CrossRef, OpenAlex). Invent no URLs. This is the ONLY section allowed to contain URLs.

Example:
- Short title: [PubMed](url) · [PMC](url) · [Publisher](url)`
  : `*No external links available.*`}

---

MATCHED PRODUCTS AND INDEXED EVIDENCE (internal — never reference by number):
${productContext || "(none provided)"}

---

RECENT LITERATURE (internal — never reference by number):
${litContext || "(none provided)"}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.status === 429) throw new Error("AI service is busy right now. Please retry shortly.");
  if (res.status === 402)
    throw new Error("AI credits are exhausted. Please contact the administrator.");
  if (res.status === 403)
    throw new Error("AI access is blocked for this workspace. Please contact the administrator.");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`report ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  return (j.choices[0]?.message?.content ?? "")
    .replace(/\(?\s*(?:doi|DOI)\s*:\s*10\.[^\s)\]]+\s*\)?/g, "")
    .replace(/[ \t]{2,}/g, " ");
}
