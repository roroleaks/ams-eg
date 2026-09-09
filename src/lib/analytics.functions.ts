import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LogInput } from "@/lib/analytics.schemas";

/** Logs a search for the signed-in user. */
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