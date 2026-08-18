/**
 * Client-side activity tracker.
 *
 * Fire-and-forget: analytics must never slow down or break clinical search.
 * Only normalised, non-identifying values are sent.
 */
import { recordActivity } from "@/lib/activity.functions";
import { normalizeComplaint } from "@/lib/activity-privacy";
import type { EventInputType } from "@/lib/activity.schemas";

const SESSION_KEY = "ams-session-id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `s${Date.now()}${Math.random()}`).replace(/-/g, "");
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
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
    void recordActivity({
      data: { ...rest, complaint_id, session_id: getSessionId() },
    }).catch(() => {});
  } catch {
    /* analytics failure must never surface to the user */
  }
}

export { normalizeComplaint };
