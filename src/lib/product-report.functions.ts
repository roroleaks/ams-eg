import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ProductSchema = z.object({
  name: z.string(),
  matchedIndications: z.array(z.string()).max(20),
  otherIndications: z.array(z.string()).max(30),
  passages: z
    .array(
      z.object({
        section: z.string().nullable().optional(),
        page: z.number().nullable().optional(),
        sourceName: z.string().nullable().optional(),
        text: z.string(),
      }),
    )
    .max(8),
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
  complaint: z.string().min(1).max(500),
  products: z.array(ProductSchema).max(10),
  literature: z.array(LiteratureSchema).max(20).optional(),
});

export const summarizeProductReport = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data }) => {
    const { getOptionalCaller, permissionDenied, clientKey, enforceRateLimit } = await import(
      "@/lib/ai-guard.server"
    );
    const caller = await getOptionalCaller();
    if (await permissionDenied(caller, "can_summarize")) {
      throw new Error("Summary permission is disabled for your account");
    }
    enforceRateLimit(clientKey("report", caller.userId), caller.userId ? 30 : 8, 10 * 60_000);

    const { generateProductReport } = await import("@/lib/product-report.server");
    const markdown = await generateProductReport(data);
    return { markdown };
  });

