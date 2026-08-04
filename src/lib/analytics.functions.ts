import { createServerFn } from "@tanstack/react-start";
import { getOptionalCaller, publicClient } from "@/lib/ai-guard.server";
import { LogInput, GuestInput } from "@/lib/analytics.schemas";

/** Logs a search for both guests (anonymous) and signed-in users. */
export const logSearch = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LogInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const caller = await getOptionalCaller();
      const client = caller.supabase ?? publicClient();
      await client.from("search_analytics").insert({
        query: data.query,
        result_count: data.result_count,
        mode: data.mode ?? null,
        user_id: caller.userId,
      });
      if (!caller.userId && data.anon_id) {
        await client.from("guest_events").insert({ anon_id: data.anon_id, event: "search" });
      }
    } catch (e) {
      // Never let analytics break the app
      console.error("logSearch failed", e);
    }
    return { ok: true };
  });

/** Records a lightweight, non-identifying guest activity event. */
export const recordGuestEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => GuestInput.parse(d))
  .handler(async ({ data }) => {
    try {
      const caller = await getOptionalCaller();
      if (caller.userId) return { ok: true };
      await publicClient().from("guest_events").insert({
        anon_id: data.anon_id,
        event: data.event,
      });
    } catch (e) {
      console.error("recordGuestEvent failed", e);
    }
    return { ok: true };
  });
