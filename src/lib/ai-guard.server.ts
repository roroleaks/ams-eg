import { getRequestHeader } from "@tanstack/react-start/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

function makeClient(token?: string): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!;
  return createClient<Database>(url, key, {
    global: {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        if (token) headers.set("Authorization", `Bearer ${token}`);
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

/** Publishable-key client for anonymous (guest) writes allowed by RLS. */
export function publicClient(): SupabaseClient<Database> {
  return makeClient();
}

export interface Caller {
  userId: string | null;
  supabase: SupabaseClient<Database> | null;
}

/** Resolves the caller if a valid bearer token is present; otherwise treats them as a guest. */
export async function getOptionalCaller(): Promise<Caller> {
  try {
    const authHeader = getRequestHeader("authorization");
    if (!authHeader?.startsWith("Bearer ")) return { userId: null, supabase: null };
    const token = authHeader.slice(7);
    if (token.split(".").length !== 3) return { userId: null, supabase: null };
    const supabase = makeClient(token);
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) return { userId: null, supabase: null };
    return { userId: data.claims.sub, supabase };
  } catch {
    return { userId: null, supabase: null };
  }
}

/** Returns true when the signed-in user has the permission explicitly disabled. */
export async function permissionDenied(
  caller: Caller,
  column: "can_search" | "can_summarize",
): Promise<boolean> {
  if (!caller.supabase || !caller.userId) return false;
  const { data } = await caller.supabase
    .from("user_permissions")
    .select(column)
    .eq("user_id", caller.userId)
    .maybeSingle();
  return Boolean(data && (data as Record<string, unknown>)[column] === false);
}

const buckets = new Map<string, { count: number; reset: number }>();

export function clientKey(prefix: string, userId: string | null): string {
  if (userId) return `${prefix}:u:${userId}`;
  const ip =
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anon";
  return `${prefix}:ip:${ip}`;
}

/** Silent, in-memory sliding window limiter. Throws a friendly error when exceeded. */
export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    }
    return;
  }
  b.count += 1;
  if (b.count > limit) {
    throw new Error("You've reached the temporary usage limit. Please try again in a few minutes.");
  }
}
