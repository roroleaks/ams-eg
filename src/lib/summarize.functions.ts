import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PassageSchema = z.object({
  product: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  page: z.number().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  text: z.string(),
});

const Input = z.object({
  query: z.string().min(1).max(500),
  passages: z.array(PassageSchema).min(1).max(30),
});

export const summarizeResults = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const context = data.passages
      .map((p, i) => {
        const cite = [
          p.sourceName,
          p.product,
          p.section,
          p.page != null ? `p. ${p.page}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        return `[${i + 1}] (${cite})\n${p.text}`;
      })
      .join("\n\n");

    const system = `You are a clinical reference assistant summarizing product monograph passages for a physician. Ground every statement in the provided passages. Cite sources inline with bracketed numbers like [1], [3]. Do not invent facts, doses, or trials that are not in the passages. If a section has no supporting content, write "Not addressed in the provided sources."`;

    const user = `Clinician's query: "${data.query}"

Below are the top matching passages from AMS product monographs. Produce a concise, structured briefing in Markdown with EXACTLY these five sections (use ## headings, in this order):

## Executive Summary
2–4 sentences framing what the sources say in relation to the query.

## Key Recommendations
Bulleted, action-oriented recommendations (product, dose/regimen if stated, patient type).

## Clinical Pearls
Bulleted mechanistic or practical insights a prescriber should remember.

## Contraindications
Bulleted contraindications, cautions, interactions, or "Not addressed in the provided sources."

## Important Updates
Bulleted recent trial data, guideline notes, or reformulations mentioned in the sources, or "Not addressed in the provided sources."

Passages:
${context}`;

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
