import { describe, it, expect, beforeEach, vi } from "vitest";
import { summarize, uniqueProductViews, type EventRow } from "./activity-metrics";

const sent: any[] = [];
vi.mock("@/lib/activity.functions", () => ({
  recordActivity: (arg: any) => {
    sent.push(arg.data);
    return Promise.resolve({ ok: true });
  },
}));

// minimal browser shims for the tracker
class MemStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
(globalThis as any).window = globalThis;
(globalThis as any).sessionStorage = new MemStore();
if (!(globalThis as any).crypto) (globalThis as any).crypto = {};

const { track, startNewSession, getSessionId } = await import("./activity");

const rowOf = (e: Partial<EventRow>): EventRow => ({
  id: Math.random().toString(36),
  user_id: "u1",
  user_role: "registered",
  organization: null,
  session_id: getSessionId(),
  category: "search",
  event_type: "search_performed",
  complaint_id: null,
  product_id: null,
  report_id: null,
  reference_id: null,
  result_count: null,
  created_at: new Date().toISOString(),
  ...e,
});

const asRows = () => sent.map((s) => rowOf(s));

beforeEach(() => {
  sent.length = 0;
  startNewSession();
});

describe("activity metrics — 17 checks", () => {
  it("1. single PCOS search records exactly one visible search event", () => {
    track({ event_type: "search_performed", complaint_raw: "PCOS", result_count: 4 });
    expect(sent.length).toBe(1); // 1
    expect(sent[0].event_type).toBe("search_performed"); // 2
    expect(summarize(asRows()).searches).toBe(1); // 3
  });

  it("2. product refresh / re-open counts one unique product view", () => {
    for (let i = 0; i < 5; i++)
      track({ event_type: "product_details_opened", product_id: "FibroMed" });
    expect(sent.length).toBe(1); // 4
    expect(summarize(asRows()).products).toBe(1); // 5
    expect(uniqueProductViews(asRows())).toBe(1); // 6
  });

  it("3. a second, different search adds exactly one more search", () => {
    track({ event_type: "search_performed", complaint_raw: "PCOS" });
    track({ event_type: "search_performed", complaint_raw: "male infertility" });
    expect(summarize(asRows()).searches).toBe(2); // 7
    const distinct = new Set(sent.map((s) => s.complaint_id));
    expect(distinct.size).toBe(2); // 8
    expect(summarize(asRows()).products).toBe(0); // 9
  });

  it("4. report generation counts once; opens and exports stay separate", () => {
    track({ event_type: "report_generated", report_id: "r1" });
    track({ event_type: "report_opened", report_id: "r1" });
    track({ event_type: "report_opened", report_id: "r1" });
    track({ event_type: "report_exported", report_id: "r1" });
    const s = summarize(asRows());
    expect(s.reports).toBe(1); // 10
    expect(s.exports).toBe(1); // 11
    expect(sent.filter((e) => e.event_type === "report_opened").length).toBe(1); // 12
  });

  it("5. deleting history rows recalculates metrics immediately", () => {
    track({ event_type: "search_performed", complaint_raw: "PCOS" });
    track({ event_type: "product_details_opened", product_id: "Q-Well" });
    const rows = asRows();
    expect(summarize(rows).searches).toBe(1); // 13
    const afterDelete = rows.filter((r) => r.event_type !== "search_performed");
    expect(summarize(afterDelete).searches).toBe(0); // 14
    expect(summarize(afterDelete).products).toBe(1); // 15
  });

  it("6. a new session resets scoped counts and issues a fresh session id", () => {
    track({ event_type: "product_details_opened", product_id: "FibroMed" });
    const oldRows = asRows();
    const oldId = getSessionId();
    const newId = startNewSession();
    expect(newId).not.toBe(oldId); // 16
    track({ event_type: "product_details_opened", product_id: "FibroMed" });
    const sessionRows = asRows().filter((r) => r.session_id === newId);
    expect(sessionRows.length).toBe(1); // 17 — dedupe cleared, session scoped
    expect(oldRows.length).toBe(1);
  });
});
