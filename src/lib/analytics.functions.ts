import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const LogInput = z.object({
  query: z.string().min(1).max(500),
  result_count: z.number().int().min(0).max(10000),
  mode: z.string().max(40).optional(),
});

export const logSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => LogInput.parse(d))
  .handler(async ({ data, context }) => {
    try {
      await context.supabase.from("search_analytics").insert({
        query: data.query,
        result_count: data.result_count,
        mode: data.mode ?? null,
        user_id: context.userId,
      });
    } catch (e) {
      // Never let analytics break the app
      console.error("logSearch failed", e);
    }
    return { ok: true };
  });
