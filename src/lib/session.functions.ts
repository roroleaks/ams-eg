import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingRelationError } from "@/lib/db-errors";
import {
  StartSessionInput,
  HeartbeatInput,
  EndSessionInput,
} from "@/lib/session.schemas";

/** Creates the user's session record (idempotent per user + session key). */
export const startUserSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartSessionInput.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { data: existing } = await context.supabase
      .from("user_sessions")
      .select("id")
      .eq("user_id", context.userId)
      .eq("session_key", data.session_key)
      .is("ended_at", null)
      .maybeSingle();
    if (existing?.id) {
      await context.supabase
        .from("user_sessions")
        .update({ last_seen_at: now })
        .eq("id", existing.id);
      return { ok: true };
    }
    const { error } = await context.supabase.from("user_sessions").insert({
      user_id: context.userId,
      session_key: data.session_key,
      device_type: data.device_type ?? null,
      browser: data.browser ?? null,
      operating_system: data.operating_system ?? null,
      referrer: data.referrer ?? null,
    });
    if (error) {
      // Until the migration creates `user_sessions`, tracking is a no-op on
      // purpose — never fail (or blank) the page because of it.
      if (isMissingRelationError(error)) return { ok: true, degraded: true };
      throw new Error(error.message);
    }
    await context.supabase
      .from("profiles")
      .update({ last_active_at: now })
      .eq("id", context.userId);
    return { ok: true };
  });

/** Heartbeat: only updates while the tab is active/visible (checked client-side). */
export const recordSessionHeartbeat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => HeartbeatInput.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    await context.supabase
      .from("user_sessions")
      .update({ last_seen_at: now })
      .eq("user_id", context.userId)
      .eq("session_key", data.session_key)
      .is("ended_at", null);
    await context.supabase
      .from("profiles")
      .update({ last_active_at: now })
      .eq("id", context.userId);
    return { ok: true };
  });

/** Ends the session and computes duration server-side from trusted timestamps. */
export const endUserSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EndSessionInput.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { data: s } = await context.supabase
      .from("user_sessions")
      .select("id, started_at, last_seen_at")
      .eq("user_id", context.userId)
      .eq("session_key", data.session_key)
      .is("ended_at", null)
      .maybeSingle();
    if (s?.id) {
      const started = new Date(s.started_at).getTime();
      const lastSeen = new Date(s.last_seen_at).getTime();
      const endMs = Math.min(Date.now(), lastSeen);
      let secs = Math.max(0, Math.round((endMs - started) / 1000));
      if (secs > 8 * 3600) secs = 8 * 3600; // inactivity cap
      await context.supabase
        .from("user_sessions")
        .update({ ended_at: now, duration_seconds: secs })
        .eq("id", s.id);
    }
    await context.supabase
      .from("profiles")
      .update({ last_active_at: now })
      .eq("id", context.userId);
    return { ok: true };
  });

/* ---------------- Admin session analytics ---------------- */

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin only");
}

const INACTIVE_AFTER_MS = 30 * 60 * 1000;

export const sessionOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const since = (days: number) =>
      new Date(Date.now() - days * 86400_000).toISOString();

    const { data: rowsRaw, error } = await context.supabase
      .from("user_sessions")
      .select("id, user_id, started_at, last_seen_at, ended_at, duration_seconds")
      .gte("started_at", since(Math.max(data.days, 30)))
      .order("started_at", { ascending: false })
      .limit(20000);
    if (error) {
      if (isMissingRelationError(error)) {
        return {
          totals: {
            totalSessions: 0,
            activeSessions: 0,
            sessionsToday: 0,
            sessionsWeek: 0,
            sessionsMonth: 0,
          },
          usage: {
            activeUsersToday: 0,
            activeUsersWeek: 0,
            activeUsersMonth: 0,
            avgDurationSeconds: 0,
            totalDurationSeconds: 0,
          },
          degraded: true,
        };
      }
      throw new Error(error.message);
    }
    const rows = (rowsRaw ?? []) as any[];

    const now = Date.now();
    const dayAgo = since(1);
    const weekAgo = since(7);
    const monthAgo = since(30);

    const ended = rows.filter((r) => r.ended_at !== null);
    const open = rows.filter((r) => r.ended_at === null);

    // Sessions idle > 30 min without an explicit end are treated as ended.
    const treatEnded = open.filter(
      (r) => now - new Date(r.last_seen_at).getTime() > INACTIVE_AFTER_MS,
    );
    const activeSessions = open.filter((r) => !treatEnded.includes(r));

    const durationOf = (r: any) => {
      const d = r.duration_seconds;
      if (typeof d === "number" && d > 0) return d;
      const started = new Date(r.started_at).getTime();
      const end = r.ended_at ? new Date(r.ended_at).getTime() : new Date(r.last_seen_at).getTime();
      let secs = Math.max(0, Math.round((Math.min(end, now) - started) / 1000));
      if (secs > 8 * 3600) secs = 8 * 3600;
      return secs;
    };

    const startedTuples = [...ended, ...treatEnded].filter((r) => durationOf(r) > 0);
    const totalDuration = startedTuples.reduce((sum, r) => sum + durationOf(r), 0);

    const activeUsersDay = new Set(rows.filter((r) => r.last_seen_at >= dayAgo).map((r) => r.user_id)).size;
    const activeUsersWeek = new Set(rows.filter((r) => r.last_seen_at >= weekAgo).map((r) => r.user_id)).size;
    const activeUsersMonth = new Set(rows.filter((r) => r.last_seen_at >= monthAgo).map((r) => r.user_id)).size;

    return {
      totals: {
        totalSessions: rows.length,
        activeSessions: activeSessions.length,
        sessionsToday: rows.filter((r) => r.started_at >= dayAgo).length,
        sessionsWeek: rows.filter((r) => r.started_at >= weekAgo).length,
        sessionsMonth: rows.filter((r) => r.started_at >= monthAgo).length,
      },
      usage: {
        activeUsersToday: activeUsersDay,
        activeUsersWeek: activeUsersWeek,
        activeUsersMonth: activeUsersMonth,
        avgDurationSeconds: startedTuples.length
          ? Math.round(totalDuration / startedTuples.length)
          : 0,
        totalDurationSeconds: totalDuration,
      },
    };
  });