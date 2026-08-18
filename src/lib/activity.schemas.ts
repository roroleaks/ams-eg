import { z } from "zod";

/** Every event the activity/audit layer understands, grouped by category. */
export const EVENT_TYPES = {
  auth: ["user_signed_in", "user_signed_out", "account_created"],
  search: ["search_performed", "complaint_selected", "search_completed", "search_no_result"],
  product: [
    "product_result_viewed",
    "product_details_opened",
    "product_favorited",
    "product_unfavorited",
  ],
  evidence: ["evidence_report_opened", "reference_opened", "monograph_opened"],
  report: ["report_generated", "report_opened", "report_exported"],
  saved: ["search_saved", "report_saved", "product_saved"],
} as const;

export type EventCategory = keyof typeof EVENT_TYPES;
export const ALL_EVENT_TYPES = Object.values(EVENT_TYPES).flat() as string[];

export const CATEGORY_OF: Record<string, EventCategory> = Object.fromEntries(
  (Object.keys(EVENT_TYPES) as EventCategory[]).flatMap((c) =>
    EVENT_TYPES[c].map((t) => [t, c] as const),
  ),
) as Record<string, EventCategory>;

/** Events that must survive ordinary user history deletion. */
export const IMMUTABLE_CATEGORIES: EventCategory[] = ["auth"];

export const EventInput = z.object({
  event_type: z.string().refine((v) => ALL_EVENT_TYPES.includes(v), "unknown event type"),
  session_id: z.string().min(8).max(64).optional(),
  complaint_id: z.string().max(120).optional().nullable(),
  product_id: z.string().max(120).optional().nullable(),
  report_id: z.string().max(120).optional().nullable(),
  reference_id: z.string().max(200).optional().nullable(),
  result_count: z.number().int().min(0).max(10000).optional().nullable(),
  organization: z.string().max(120).optional().nullable(),
});
export type EventInputType = z.infer<typeof EventInput>;

export const AuditFilter = z.object({
  days: z.number().int().min(1).max(3650).default(30),
  from: z.string().max(40).optional().nullable(),
  to: z.string().max(40).optional().nullable(),
  event_type: z.string().max(60).optional().nullable(),
  category: z.string().max(30).optional().nullable(),
  complaint_id: z.string().max(120).optional().nullable(),
  product_id: z.string().max(120).optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
  user_role: z.string().max(40).optional().nullable(),
  organization: z.string().max(120).optional().nullable(),
  limit: z.number().int().min(1).max(1000).default(200),
});
export type AuditFilterType = z.infer<typeof AuditFilter>;

export const RETENTION_OPTIONS = [30, 90, 180, 365] as const;
