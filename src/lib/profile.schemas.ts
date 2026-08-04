import { z } from "zod";

export const HistoryInput = z.object({
  query: z.string().min(1).max(500),
  products: z.array(z.string().max(120)).max(30).default([]),
  result_count: z.number().int().min(0).max(1000).default(0),
  report_markdown: z.string().max(60000).nullable().optional(),
});

export const FavInput = z.object({
  item_type: z.enum(["product", "complaint", "report"]),
  item_key: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
