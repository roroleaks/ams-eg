import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const PassageSchema = z.object({
  product: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  page: z.number().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  text: z.string(),
});

const ProductSchema = z.object({
  name: z.string(),
  score: z.number().optional(),
  matchedIndications: z.array(z.string()).max(30),
  otherIndications: z.array(z.string()).max(40),
  passages: z.array(PassageSchema).max(8),
});

const LiteratureSchema = z.object({
  title: z.string(),
  authors: z.string(),
  journal: z.string(),
  year: z.string(),
  doi: z.string().nullable(),
  pmid: z.string().nullable(),
  pmcid: z.string().nullable().optional(),
  pubType: z.string(),
  url: z.string().optional(),
});

const LOCK_KEY = "library_build_lock";
const LOCK_TTL_MS = 5 * 60_000;

async function adminContext(context: { supabase: unknown; userId: string }) {
  const supabase = context.supabase as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
  };
  const { data } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (data !== true) throw new Error("Admin access required");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Admin = Awaited<ReturnType<typeof adminContext>>;

async function readLock(db: Admin) {
  const { data } = await db.from("app_settings").select("value").eq("key", LOCK_KEY).maybeSingle();
  return (data?.value ?? null) as { token: string; expires: number; by: string } | null;
}

async function assertLock(db: Admin, token: string) {
  const lock = await readLock(db);
  if (!lock || lock.token !== token || lock.expires < Date.now()) {
    throw new Error("Library build lock lost — another build may be running.");
  }
  await db
    .from("app_settings")
    .update({ value: { ...lock, expires: Date.now() + LOCK_TTL_MS } })
    .eq("key", LOCK_KEY);
}

/** Single-flight lock so two admins cannot build the library at the same time. */
export const acquireLibraryLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ force: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const db = await adminContext(context);
    const existing = await readLock(db);
    if (existing && existing.expires > Date.now() && !data.force) {
      throw new Error("A library build is already running. Try again in a few minutes.");
    }
    const token = crypto.randomUUID();
    await db.from("app_settings").upsert(
      {
        key: LOCK_KEY,
        value: { token, expires: Date.now() + LOCK_TTL_MS, by: context.userId },
        updated_by: context.userId,
      },
      { onConflict: "key" },
    );
    return { token };
  });

export const releaseLibraryLock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = await adminContext(context);
    const lock = await readLock(db);
    if (lock && lock.token === data.token) {
      await db.from("app_settings").update({ value: { token: "", expires: 0, by: "" } }).eq("key", LOCK_KEY);
    }
    return { ok: true };
  });

/** Which complaints already have a stored entry. */
export const libraryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await adminContext(context);
    const { data } = await db
      .from("complaint_library")
      .select("complaint, status, built_at, product_count, evidence_count, literature_count")
      .order("complaint");
    const lock = await readLock(db);
    return {
      entries: (data ?? []) as {
        complaint: string;
        status: string;
        built_at: string;
        product_count: number;
        evidence_count: number;
        literature_count: number;
      }[],
      locked: !!lock && lock.expires > Date.now(),
    };
  });

/** Builds and stores ONE complaint entry (bounded work per call). */
export const buildLibraryEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string(),
        complaint: z.string().min(1).max(300),
        products: z.array(ProductSchema).max(10),
        literature: z.array(LiteratureSchema).max(20).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = await adminContext(context);
    await assertLock(db, data.token);

    const evidence = data.products.flatMap((p) =>
      p.passages.map((s) => ({ ...s, product: s.product ?? p.name })),
    );

    let markdown: string | null = null;
    let status = "ok";
    let error: string | null = null;
    try {
      const { generateProductReport } = await import("@/lib/product-report.server");
      markdown = await generateProductReport({
        complaint: data.complaint,
        products: data.products,
        literature: data.literature ?? [],
      });
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : "Report generation failed";
      // Credit / policy failures must stop the whole batch.
      if (/credits are exhausted|blocked for this workspace|Missing LOVABLE_API_KEY/i.test(error)) {
        await db.from("complaint_library").upsert(
          {
            complaint: data.complaint,
            products: data.products,
            evidence,
            literature: data.literature ?? [],
            report_markdown: null,
            product_count: data.products.length,
            evidence_count: evidence.length,
            literature_count: data.literature?.length ?? 0,
            status,
            error,
            built_by: context.userId,
            built_at: new Date().toISOString(),
          },
          { onConflict: "complaint" },
        );
        return { ok: false, halt: true, error };
      }
    }

    const { error: dbError } = await db.from("complaint_library").upsert(
      {
        complaint: data.complaint,
        products: data.products,
        evidence,
        literature: data.literature ?? [],
        report_markdown: markdown,
        product_count: data.products.length,
        evidence_count: evidence.length,
        literature_count: data.literature?.length ?? 0,
        status,
        error,
        built_by: context.userId,
        built_at: new Date().toISOString(),
      },
      { onConflict: "complaint" },
    );
    if (dbError) throw new Error(dbError.message);
    return { ok: status === "ok", halt: false, error };
  });

export const clearLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await adminContext(context);
    await db.from("complaint_library").delete().neq("complaint", "");
    return { ok: true };
  });
