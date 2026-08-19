import type { SupabaseClient } from "@supabase/supabase-js";

/** Small TTL cache so role lookups never add latency to the clinical flow. */
const roleCache = new Map<string, { role: string; expires: number }>();

export async function roleFor(supabase: SupabaseClient<any>, userId: string): Promise<string> {
  const hit = roleCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.role;
  let role = "registered";
  try {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = (data ?? []).map((r: { role: string }) => r.role);
    role = roles.includes("admin")
      ? "admin"
      : roles.includes("owner")
        ? "owner"
        : roles.includes("medical_editor")
          ? "medical_editor"
          : (roles[0] ?? "registered");
  } catch {
    /* best effort */
  }
  roleCache.set(userId, { role, expires: Date.now() + 5 * 60 * 1000 });
  return role;
}

export interface EventRow {
  id: string;
  user_id: string | null;
  user_role: string | null;
  organization: string | null;
  session_id: string | null;
  category: string;
  event_type: string;
  complaint_id: string | null;
  product_id: string | null;
  report_id: string | null;
  reference_id: string | null;
  result_count: number | null;
  created_at: string;
}

export function countBy(rows: EventRow[], key: keyof EventRow, limit = 10) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (typeof v !== "string" || !v) continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function since(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/** Daily buckets for the trend chart. */
export function dailySeries(rows: EventRow[], days: number) {
  const buckets = new Map<string, { date: string; searches: number; views: number; reports: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    buckets.set(d, { date: d, searches: 0, views: 0, reports: 0 });
  }
  for (const r of rows) {
    const d = r.created_at.slice(0, 10);
    const b = buckets.get(d);
    if (!b) continue;
    if (r.category === "search") b.searches += 1;
    else if (r.category === "product") b.views += 1;
    else if (r.category === "report") b.reports += 1;
  }
  return [...buckets.values()];
}

/**
 * Single source of truth for activity metrics. Summary cards and the detailed
 * feed must always be derived from this function so the numbers reconcile.
 *  - one completed search  = one `search_performed` event
 *  - one product view      = one unique product opened (per scope)
 *  - one report generated  = one `report_generated` event
 */
export function summarize(rows: EventRow[]) {
  const products = new Set<string>();
  for (const r of rows) {
    if (r.event_type === "product_details_opened" && r.product_id) products.add(r.product_id);
  }
  const count = (...types: string[]) => rows.filter((r) => types.includes(r.event_type)).length;
  return {
    searches: count("search_performed"),
    noResult: count("search_no_result"),
    products: products.size,
    evidence: count("evidence_report_opened"),
    references: count("reference_opened", "monograph_opened"),
    reports: count("report_generated"),
    saved: count("product_saved", "search_saved", "report_saved", "product_favorited"),
    exports: count("report_exported"),
  };
}

/** Unique (scope, product) pairs — used for the admin "products viewed" metric. */
export function uniqueProductViews(rows: EventRow[]): number {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.event_type !== "product_details_opened" || !r.product_id) continue;
    set.add(`${r.user_id ?? r.session_id ?? "anon"}|${r.product_id}`);
  }
  return set.size;
}
