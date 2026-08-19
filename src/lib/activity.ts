/**
 * Client-side activity tracker.
 *
 * Fire-and-forget: analytics must never slow down or break clinical search.
 * Only normalised, non-identifying values are sent.
 *
 * The tracker also guarantees a clean event model:
 *  - one completed user search produces exactly one visible search event;
 *  - repeated renders, refreshes or re-opens of the same product/reference
 *    within the same session do not inflate the metrics.
 */
import { recordActivity } from "@/lib/activity.functions";
import { normalizeComplaint } from "@/lib/activity-privacy";
import type { EventInputType } from "@/lib/activity.schemas";

const SESSION_KEY = "ams-session-id";
const SESSION_START_KEY = "ams-session-started";
const DEDUPE_KEY = "ams-activity-seen";

function newId(): string {
  return (crypto.randomUUID?.() ?? `s${Date.now()}${Math.random()}`).replace(/-/g, "");
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = newId();
    sessionStorage.setItem(SESSION_KEY, id);
    sessionStorage.setItem(SESSION_START_KEY, new Date().toISOString());
  }
  return id;
}

/** ISO timestamp of when the current session began. */
export function getSessionStart(): string | null {
  if (typeof window === "undefined") return null;
  getSessionId();
  return sessionStorage.getItem(SESSION_START_KEY);
}

/** A new sign-in starts a brand-new session (current-session metrics reset). */
export function startNewSession(): string {
  if (typeof window === "undefined") return "";
  const id = newId();
  sessionStorage.setItem(SESSION_KEY, id);
  sessionStorage.setItem(SESSION_START_KEY, new Date().toISOString());
  sessionStorage.removeItem(DEDUPE_KEY);
  return id;
}

/**
 * Events that describe a state the user reached, not an action repeated on
 * purpose. They are recorded once per session per target so that refreshes,
 * re-renders and re-opens never inflate the counts.
 */
const ONCE_PER_SESSION = new Set([
  "product_details_opened",
  "product_result_viewed",
  "evidence_report_opened",
  "reference_opened",
  "monograph_opened",
  "report_opened",
  "user_signed_in",
]);

function seen(): Set<string> {
  try {
    return new Set<string>(JSON.parse(sessionStorage.getItem(DEDUPE_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function remember(set: Set<string>) {
  try {
    sessionStorage.setItem(DEDUPE_KEY, JSON.stringify([...set].slice(-500)));
  } catch {
    /* storage full — dedupe degrades gracefully */
  }
}

type TrackInput = Omit<EventInputType, "session_id"> & { complaint_raw?: string };

/** Records an event without ever throwing into the calling clinical flow. */
export function track(input: TrackInput): void {
  if (typeof window === "undefined") return;
  const { complaint_raw, ...rest } = input;
  const complaint_id = rest.complaint_id
    ? normalizeComplaint(rest.complaint_id)
    : complaint_raw
      ? normalizeComplaint(complaint_raw)
      : null;
  try {
    const sessionId = getSessionId();
    if (ONCE_PER_SESSION.has(rest.event_type)) {
      const key = [
        rest.event_type,
        rest.product_id ?? "",
        rest.reference_id ?? "",
        rest.report_id ?? "",
        complaint_id ?? "",
      ].join("|");
      const set = seen();
      if (set.has(key)) return;
      set.add(key);
      remember(set);
    }
    void recordActivity({
      data: { ...rest, complaint_id, session_id: sessionId },
    }).catch(() => {});
  } catch {
    /* analytics failure must never surface to the user */
  }
}

export { normalizeComplaint };
