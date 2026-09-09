import { z } from "zod";

export const StartSessionInput = z.object({
  session_key: z.string().min(8).max(64),
  device_type: z.string().max(30).optional().nullable(),
  browser: z.string().max(60).optional().nullable(),
  operating_system: z.string().max(60).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
});

export const HeartbeatInput = z.object({
  session_key: z.string().min(8).max(64),
});

export const EndSessionInput = z.object({
  session_key: z.string().min(8).max(64),
});