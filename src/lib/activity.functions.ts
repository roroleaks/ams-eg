import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  roleFor,
  countBy,
  since,
  dailySeries,
  summarize,
  uniqueProductViews,
  type EventRow,
} from "@/lib/activity.server";
import { scrubIdentifier } from "@/lib/activity-privacy";
import {
  EventInput,
  AuditFilter,
  CATEGORY_OF,
  IMMUTABLE_CATEGORIES,
  RETENTION_OPTIONS,
  HIDDEN_EVENT_TYPES,
} from "@/lib/activity.schemas";

const SELECT =
  "id, user_id, user_role, organization, session_id, category, event_type, complaint_id, product_id, report_id, reference_id, result_count, created_at";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin only");
}

/* ---------------- Recording (never blocks or breaks the clinical flow) ---------------- */

export const recordActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EventInput.parse(d))
  .handler(async ({ data, context }) => {
    try {
      const category = CATEGORY_OF[data.event_type];
      if (!category) return { ok: true };
      const role = await roleFor(context.supabase, context.userId);
      await context.supabase.from("activity_events").insert({
        user_id: context.userId,
        user_role: role,
        organization: scrubIdentifier(data.organization ?? null, 120),
        session_id: data.session_id ?? null,
        category,
        event_type: data.event_type,
        // Normalised clinical category only — never raw patient free text.
        complaint_id: scrubIdentifier(data.complaint_id ?? null, 80),
        product_id: scrubIdentifier(data.product_id ?? null, 120),
        report_id: scrubIdentifier(data.report_id ?? null, 120),
        reference_id: scrubIdentifier(data.reference_id ?? null, 200),
        result_count: data.result_count ?? null,
        immutable: IMMUTABLE_CATEGORIES.includes(category),
      });
    } catch (e) {
      console.error("recordActivity failed", e);
    }
    return { ok: true };
  });

/* ---------------- My Activity (own data only, enforced by RLS) ---------------- */

export const listMyActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("activity_events")
      .select(SELECT)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    // Internal lifecycle rows stay out of the visible model entirely, so the
    // feed and the summary cards always reconcile.
    const rows = ((data ?? []) as EventRow[]).filter(
      (r) => !HIDDEN_EVENT_TYPES.includes(r.event_type),
    );
    return { events: rows, summary: summarize(rows) };
  });


export const deleteMyActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    // Security/auth records are immutable and excluded by RLS as well.
    let q = context.supabase
      .from("activity_events")
      .delete()
      .eq("user_id", context.userId)
      .eq("immutable", false);
    if (data.id) q = q.eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Admin: aggregated analytics ---------------- */

export const activityDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ days: z.number().int().min(1).max(365).default(30) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: rowsRaw, error } = await context.supabase
      .from("activity_events")
      .select(SELECT)
      .gte("created_at", since(Math.max(data.days, 30)))
      .order("created_at", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);
    const rows = (rowsRaw ?? []) as EventRow[];

    const dayAgo = since(1);
    const weekAgo = since(7);
    const monthAgo = since(30);
    const isSearch = (r: EventRow) => r.event_type === "search_performed";

    const { count: totalUsers } = await context.supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });

    const activeUsers = new Set(
      rows.filter((r) => r.created_at >= monthAgo && r.user_id).map((r) => r.user_id),
    ).size;

    const noResult = rows.filter((r) => r.event_type === "search_no_result");

    return {
      totals: {
        totalUsers: totalUsers ?? 0,
        activeUsers,
        searchesToday: rows.filter((r) => isSearch(r) && r.created_at >= dayAgo).length,
        searchesWeek: rows.filter((r) => isSearch(r) && r.created_at >= weekAgo).length,
        searchesMonth: rows.filter((r) => isSearch(r) && r.created_at >= monthAgo).length,
        reports: rows.filter((r) => r.event_type === "report_generated").length,
        productsViewed: uniqueProductViews(rows),
        evidenceOpened: rows.filter((r) => r.event_type === "evidence_report_opened").length,
        favorites: rows.filter((r) => r.event_type === "product_favorited").length,
        exports: rows.filter((r) => r.event_type === "report_exported").length,
      },
      topComplaints: countBy(rows.filter(isSearch), "complaint_id", 12),
      topProductsMatched: countBy(
        rows.filter((r) => r.event_type === "product_result_viewed"),
        "product_id",
        12,
      ),
      topProductsOpened: countBy(
        rows.filter((r) => r.event_type === "product_details_opened"),
        "product_id",
        12,
      ),
      topProductsFavorited: countBy(
        rows.filter((r) => r.event_type === "product_favorited"),
        "product_id",
        12,
      ),
      topProductsInReports: countBy(
        rows.filter((r) => r.category === "report" && r.product_id),
        "product_id",
        12,
      ),
      evidence: {
        evidenceReports: rows.filter((r) => r.event_type === "evidence_report_opened").length,
        references: rows.filter((r) => r.event_type === "reference_opened").length,
        monographs: rows.filter((r) => r.event_type === "monograph_opened").length,
      },
      noResult: countBy(noResult, "complaint_id", 15),
      noResultTotal: noResult.length,
      trend: dailySeries(
        rows.filter((r) => r.created_at >= since(Math.min(data.days, 90))),
        Math.min(data.days, 90),
      ),
    };
  });

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AuditFilter.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    let q = context.supabase
      .from("activity_events")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    q = q.gte("created_at", data.from ? new Date(data.from).toISOString() : since(data.days));
    if (data.to) q = q.lte("created_at", new Date(data.to).toISOString());
    if (data.event_type) q = q.eq("event_type", data.event_type);
    if (data.category) q = q.eq("category", data.category);
    if (data.complaint_id) q = q.ilike("complaint_id", `%${data.complaint_id}%`);
    if (data.product_id) q = q.ilike("product_id", `%${data.product_id}%`);
    if (data.user_id) q = q.eq("user_id", data.user_id);
    if (data.user_role) q = q.eq("user_role", data.user_role);
    if (data.organization) q = q.ilike("organization", `%${data.organization}%`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { events: (rows ?? []) as EventRow[] };
  });

export const userActivityProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, created_at, last_login_at, search_count, report_count")
      .eq("id", data.user_id)
      .maybeSingle();
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const { data: rowsRaw } = await context.supabase
      .from("activity_events")
      .select(SELECT)
      .eq("user_id", data.user_id)
      .order("created_at", { ascending: false })
      .limit(200);
    const { count: favorites } = await context.supabase
      .from("favorites")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.user_id);
    const rows = (rowsRaw ?? []) as EventRow[];
    return {
      profile,
      roles: (roles ?? []).map((r: { role: string }) => r.role),
      stats: {
        searches: rows.filter((r) => r.event_type === "search_performed").length,
        reports: rows.filter((r) => r.event_type === "report_generated").length,
        productsViewed: uniqueProductViews(rows),
        favorites: favorites ?? 0,
      },
      recent: rows.slice(0, 30),
    };
  });

/* ---------------- Admin: retention ---------------- */

export const getRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data } = await context.supabase
      .from("app_settings")
      .select("value, updated_at")
      .eq("key", "activity_retention_days")
      .maybeSingle();
    return { days: Number(data?.value ?? 90), updated_at: data?.updated_at ?? null };
  });

export const setRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ days: z.number().int().refine((v) => (RETENTION_OPTIONS as readonly number[]).includes(v)) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase
      .from("app_settings")
      .upsert(
        { key: "activity_retention_days", value: data.days as never, updated_by: context.userId },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, days: data.days };
  });

/** Applies the retention policy. Security/auth records are never removed. */
export const purgeActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data: setting } = await context.supabase
      .from("app_settings")
      .select("value")
      .eq("key", "activity_retention_days")
      .maybeSingle();
    const days = Number(setting?.value ?? 90);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("activity_events")
      .delete()
      .eq("immutable", false)
      .lt("created_at", since(days))
      .select("id");
    if (error) throw new Error(error.message);
    return { removed: data?.length ?? 0, days };
  });
