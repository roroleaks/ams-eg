import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({ query: z.string().min(1).max(500) });

export const embedQuery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }) => {
    // Enforce per-user can_search permission (default allow if no row)
    const { data: perm } = await context.supabase
      .from("user_permissions")
      .select("can_search")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (perm && perm.can_search === false) {
      throw new Error("Search permission is disabled for your account");
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: data.query,
        dimensions: 512,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`embed ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      data: { embedding: number[] }[];
    };
    const v = j.data[0].embedding;
    // L2-normalize
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    n = Math.sqrt(n) || 1;
    return { vec: v.map((x) => x / n) };
  });
