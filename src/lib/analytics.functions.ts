import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const LogInput = z.object({
  query: z.string().min(1).max(500),
  result_count: z.number().int().min(0).max(10000),
  mode: z.string().max(40).optional(),
});

export const logSearch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LogInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("search_analytics").insert({
        query: data.query,
        result_count: data.result_count,
        mode: data.mode ?? null,
      });
    } catch (e) {
      // Never let analytics break the app
      console.error("logSearch failed", e);
    }
    return { ok: true };
  });
