import { z } from "zod";

export const LogInput = z.object({
  query: z.string().min(1).max(500),
  result_count: z.number().int().min(0).max(10000),
  mode: z.string().max(40).optional(),
  anon_id: z.string().min(8).max(64).optional(),
});

export const GuestInput = z.object({
  anon_id: z.string().min(8).max(64),
  event: z.enum(["visit", "search", "report"]),
});
