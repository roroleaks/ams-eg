import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getOptionalCaller, publicClient } from "@/lib/ai-guard.server";

const LogInput = z.object({
  query: z.string().min(1).max(500),
  result_count: z.number().int().min(0).max(10000),
  mode: z.string().max(40).optional(),
  anon_id: z.string().min(8).max(64).optional(),
});

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

const GuestInput = z.object({
  anon_id: z.string().min(8).max(64),
  event: z.enum(["visit", "search", "report"]),
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
