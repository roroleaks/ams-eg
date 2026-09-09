import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bumpCounter } from "@/lib/profile.server";
import { HistoryInput, FavInput } from "@/lib/profile.schemas";

/** Creates the profile on first sign-in and refreshes sign-in timestamps afterwards. */
export const touchProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const claims = context.claims as Record<string, any>;
    const meta = (claims.user_metadata ?? {}) as Record<string, any>;
    const now = new Date().toISOString();
    // display_name / role / status / last_sign_in_at / last_active_at are added
    // by the pending migration. Until it is applied, those columns do not exist
    // on the live database, so we fall back to the base column set rather than
    // failing (and never, ever creating the profile).
    const fullPatch = {
      id: context.userId,
      email: (claims.email as string) ?? null,
      full_name: (meta.full_name as string) ?? null,
      display_name: (meta.full_name as string ?? meta.name as string ?? meta.email as string) ?? null,
      avatar_url: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
      provider: (claims.app_metadata as any)?.provider ?? null,
      provider_account_id: (meta.sub as string) ?? (meta.provider_id as string) ?? null,
      last_login_at: now,
      last_sign_in_at: now,
      last_active_at: now,
    };
    const { data, error } = await context.supabase
      .from("profiles")
      .upsert(fullPatch, { onConflict: "id" })
      .select()
      .single();
    if (error && /column .* does not exist/i.test(error.message ?? "")) {
      const minimal = {
        id: context.userId,
        email: fullPatch.email,
        full_name: fullPatch.full_name,
        avatar_url: fullPatch.avatar_url,
        provider: fullPatch.provider,
        provider_account_id: fullPatch.provider_account_id,
        last_login_at: now,
      };
      const { data: d2, error: e2 } = await context.supabase
        .from("profiles")
        .upsert(minimal, { onConflict: "id" })
        .select()
        .single();
      if (e2) throw new Error(e2.message);
      return { profile: d2, degraded: true };
    }
    if (error) throw new Error(error.message);
    return { profile: data, degraded: false };
  });

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    return { profile: data };
  });

export const saveSearchHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => HistoryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("search_history")
      .insert({
        user_id: context.userId,
        query: data.query,
        products: data.products,
        result_count: data.result_count,
        report_markdown: data.report_markdown ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await bumpCounter(context, "search_count");
    return { id: row.id };
  });

export const attachReportToHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), report_markdown: z.string().max(60000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("search_history")
      .update({ report_markdown: data.report_markdown })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    await bumpCounter(context, "report_count");
    return { ok: true };
  });

export const listSearchHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("search_history")
      .select("id, query, products, result_count, report_markdown, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { history: data ?? [] };
  });

export const deleteSearchHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("search_history").delete().eq("user_id", context.userId);
    if (data.id) q = q.eq("id", data.id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const toggleFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FavInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("favorites")
      .select("id")
      .eq("user_id", context.userId)
      .eq("item_type", data.item_type)
      .eq("item_key", data.item_key)
      .maybeSingle();
    if (existing) {
      await context.supabase.from("favorites").delete().eq("id", existing.id);
      return { favorited: false };
    }
    const { error } = await context.supabase.from("favorites").insert({
      user_id: context.userId,
      item_type: data.item_type,
      item_key: data.item_key,
      label: data.label ?? data.item_key,
      payload: (data.payload ?? null) as never,
    });
    if (error) throw new Error(error.message);
    return { favorited: true };
  });

export const listFavorites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("favorites")
      .select("id, item_type, item_key, label, payload, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { favorites: data ?? [] };
  });
