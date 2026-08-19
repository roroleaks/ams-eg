/**
 * Shared (client + server) activity metric definitions.
 *
 * Summary cards, the activity feed and admin analytics must all derive their
 * numbers from here so that totals always reconcile with the detailed records.
 */

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

/**
 *  - one completed search  = one `search_performed` event
 *  - one product view      = one unique product opened within the scope
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

/** Unique (user/session, product) pairs — the admin "products viewed" metric. */
export function uniqueProductViews(rows: EventRow[]): number {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.event_type !== "product_details_opened" || !r.product_id) continue;
    set.add(`${r.user_id ?? r.session_id ?? "anon"}|${r.product_id}`);
  }
  return set.size;
}
