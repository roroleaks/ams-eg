import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Helpers ============

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin only");
}

async function adminRpc(supabase: any, fn: string, args?: Record<string, unknown>) {
  return supabase.rpc(fn, args);
}

async function log(
  admin: any,
  {
    document_id = null,
    action,
    status,
    message = null,
    duration_ms = null,
    created_by,
  }: {
    document_id?: string | null;
    action: string;
    status: string;
    message?: string | null;
    duration_ms?: number | null;
    created_by: string;
  },
) {
  try {
    await admin.from("indexing_logs").insert({
      document_id,
      action,
      status,
      message,
      duration_ms,
      created_by,
    });
  } catch {
    // Logging is best-effort: it must never fail an admin operation whose
    // underlying write has already succeeded.
  }
}

/** Writes a tamper-evident admin action audit trail. */
async function audit(
  context: { supabase: any; userId: string },
  {
    action,
    target_user_id = null,
    details = {},
  }: {
    action: string;
    target_user_id?: string | null;
    details?: Record<string, unknown>;
  },
) {
  try {
    await context.supabase.from("admin_audit_logs").insert({
      admin_id: context.userId,
      action,
      target_user_id,
      details: details as never,
    });
  } catch {
    /* auditing must never block the admin action itself */
  }
}

// ============ Documents ============

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("documents")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { documents: data };
  });

export const createDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        title: z.string().min(1).max(200),
        filename: z.string().min(1).max(300),
        storage_path: z.string().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: doc, error } = await context.supabase
      .from("documents")
      .insert({
        title: data.title,
        filename: data.filename,
        storage_path: data.storage_path,
        uploaded_by: context.userId,
        status: "pending",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await log(context.supabase, {
      document_id: doc.id,
      action: "upload",
      status: "success",
      message: `Uploaded ${data.filename}`,
      created_by: context.userId,
    });
    return { document: doc };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: doc } = await context.supabase
      .from("documents")
      .select("storage_path, filename")
      .eq("id", data.id)
      .single();
    if (doc?.storage_path) {
      await context.supabase.storage.from("pdfs").remove([doc.storage_path]);
    }
    const { error } = await context.supabase.from("documents").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await log(context.supabase, {
      document_id: data.id,
      action: "delete",
      status: "success",
      message: `Deleted ${doc?.filename ?? "document"}`,
      created_by: context.userId,
    });
    return { ok: true };
  });

export const replaceDocumentVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        filename: z.string().min(1).max(300),
        storage_path: z.string().min(1).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { data: prev } = await context.supabase
      .from("documents")
      .select("version, storage_path")
      .eq("id", data.id)
      .single();
    if (prev?.storage_path && prev.storage_path !== data.storage_path) {
      await context.supabase.storage.from("pdfs").remove([prev.storage_path]);
    }
    // Delete old chunks
    await context.supabase.from("document_chunks").delete().eq("document_id", data.id);
    const { error } = await context.supabase
      .from("documents")
      .update({
        filename: data.filename,
        storage_path: data.storage_path,
        version: (prev?.version ?? 1) + 1,
        status: "pending",
        chunk_count: 0,
        indexed_at: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await log(context.supabase, {
      document_id: data.id,
      action: "replace",
      status: "success",
      message: `New version uploaded`,
      created_by: context.userId,
    });
    return { ok: true };
  });

// ============ Re-index pipeline ============

function chunkText(text: string, page: number): { page: number; content: string }[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  // Split into ~600 char chunks on sentence boundaries
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const chunks: { page: number; content: string }[] = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + " " + s).length > 600 && buf.length > 100) {
      chunks.push({ page, content: buf.trim() });
      buf = s;
    } else {
      buf = buf ? buf + " " + s : s;
    }
  }
  if (buf.trim()) chunks.push({ page, content: buf.trim() });
  return chunks;
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: texts,
      dimensions: 512,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Embedding failed ${res.status}: ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { data: { embedding: number[] }[] };
  return j.data.map((d) => d.embedding);
}

function packEmbedding(vec: number[]): string {
  // L2 normalize, pack as Float32 little-endian, encode as \x hex for bytea
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n) || 1;
  const arr = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) arr[i] = vec[i] / n;
  const bytes = new Uint8Array(arr.buffer);
  let hex = "\\x";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

export const reindexDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const started = Date.now();
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey)
      throw new Error(
        "AI is unavailable in this preview. Open the published app to index documents.",
      );

    const { data: doc, error: docErr } = await context.supabase
      .from("documents")
      .select("id, storage_path, filename")
      .eq("id", data.id)
      .single();
    if (docErr || !doc) throw new Error(docErr?.message ?? "Document not found");

    await context.supabase
      .from("documents")
      .update({ status: "processing", status_message: null })
      .eq("id", data.id);

    try {
      // 1. Download PDF
      const { data: fileData, error: dlErr } = await context.supabase.storage
        .from("pdfs")
        .download(doc.storage_path);
      if (dlErr || !fileData) throw new Error(`Download: ${dlErr?.message ?? "empty"}`);
      const buf = new Uint8Array(await fileData.arrayBuffer());

      // 2. Extract text
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(buf);
      const { text, totalPages } = await extractText(pdf, { mergePages: false });
      const pages: string[] = Array.isArray(text) ? text : [String(text)];

      // 3. Chunk
      const allChunks: { page: number; content: string }[] = [];
      pages.forEach((pageText, idx) => {
        allChunks.push(...chunkText(pageText, idx + 1));
      });
      if (allChunks.length === 0) throw new Error("No text extracted from PDF");

      // 4. Clear old chunks
      await context.supabase.from("document_chunks").delete().eq("document_id", doc.id);

      // 5. Embed in batches of 64
      const BATCH = 64;
      for (let i = 0; i < allChunks.length; i += BATCH) {
        const slice = allChunks.slice(i, i + BATCH);
        const vecs = await embedBatch(
          slice.map((c) => c.content),
          apiKey,
        );
        const rows = slice.map((c, j) => ({
          document_id: doc.id,
          page: c.page,
          chunk_index: i + j,
          content: c.content,
          embedding: packEmbedding(vecs[j]),
        }));
        const { error: insErr } = await context.supabase.from("document_chunks").insert(rows);
        if (insErr) throw new Error(`Insert chunks: ${insErr.message}`);
      }

      // 6. Mark indexed
      await context.supabase
        .from("documents")
        .update({
          status: "indexed",
          page_count: totalPages,
          chunk_count: allChunks.length,
          indexed_at: new Date().toISOString(),
          status_message: null,
        })
        .eq("id", doc.id);

      await log(context.supabase, {
        document_id: doc.id,
        action: "reindex",
        status: "success",
        message: `${allChunks.length} chunks · ${totalPages} pages`,
        duration_ms: Date.now() - started,
        created_by: context.userId,
      });

      return { ok: true, chunks: allChunks.length, pages: totalPages };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await context.supabase
        .from("documents")
        .update({ status: "failed", status_message: msg })
        .eq("id", doc.id);
      await log(context.supabase, {
        document_id: doc.id,
        action: "reindex",
        status: "error",
        message: msg,
        duration_ms: Date.now() - started,
        created_by: context.userId,
      });
      throw new Error(msg);
    }
  });

// ============ Users & Permissions ============

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data: authUsers, error: usersErr } = await adminRpc(context.supabase, "admin_list_users");
    if (usersErr) throw new Error(usersErr.message);
    const users = (authUsers ?? []) as Array<{
      id: string;
      email: string | null;
      created_at: string | null;
      last_sign_in_at: string | null;
      email_confirmed_at: string | null;
    }>;
    const { data: roles } = await context.supabase.from("user_roles").select("user_id, role");
    const { data: perms } = await context.supabase.from("user_permissions").select("*");
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    const permsByUser = new Map<string, any>();
    (perms ?? []).forEach((p) => permsByUser.set(p.user_id, p));
    return {
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        confirmed: !!u.email_confirmed_at,
        roles: rolesByUser.get(u.id) ?? [],
        permissions: permsByUser.get(u.id) ?? null,
      })),
    };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "user"]),
        grant: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.grant) {
      await context.supabase
        .from("user_roles")
        .upsert({ user_id: data.user_id, role: data.role }, { onConflict: "user_id,role" });
    } else {
      await context.supabase
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
    }
    await audit(context, {
      action: data.grant ? "role_granted" : "role_revoked",
      target_user_id: data.user_id,
      details: { role: data.role },
    });
    return { ok: true };
  });

export const setUserPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        can_search: z.boolean(),
        can_summarize: z.boolean(),
        can_download: z.boolean(),
        notes: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { error } = await context.supabase.from("user_permissions").upsert(
      {
        user_id: data.user_id,
        can_search: data.can_search,
        can_summarize: data.can_summarize,
        can_download: data.can_download,
        notes: data.notes ?? null,
        updated_by: context.userId,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    await audit(context, {
      action: "permissions_updated",
      target_user_id: data.user_id,
      details: {
        can_search: data.can_search,
        can_summarize: data.can_summarize,
        can_download: data.can_download,
      },
    });
    return { ok: true };
  });

export const setUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        status: z.enum(["active", "suspended", "deleted"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot change your own account status");
    const { error } = await context.supabase
      .from("profiles")
      .update({ status: data.status })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);
    await audit(context, {
      action: "user_status_changed",
      target_user_id: data.user_id,
      details: { status: data.status },
    });
    return { ok: true, status: data.status };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.user_id === context.userId) throw new Error("You cannot delete yourself");
    const { error } = await adminRpc(context.supabase, "admin_delete_user", { p_user_id: data.user_id });
    if (error) throw new Error(error.message);
    await audit(context, { action: "user_deleted", target_user_id: data.user_id });
    return { ok: true };
  });

// ============ Logs & Analytics ============

export const listIndexingLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("indexing_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { logs: data };
  });

export const listSearchAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data, error } = await context.supabase
      .from("search_analytics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    // Aggregate
    const total = data.length;
    const zero = data.filter((r: any) => r.result_count === 0).length;
    const byQuery = new Map<string, number>();
    data.forEach((r: any) => {
      const q = r.query.toLowerCase().trim();
      byQuery.set(q, (byQuery.get(q) ?? 0) + 1);
    });
    const top = [...byQuery.entries()]
      .map(([query, count]) => ({ query, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { rows: data, total, zero, top };
  });

export const exportUsageReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data: analytics } = await context.supabase
      .from("search_analytics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);
    const rows = [["timestamp", "query", "result_count", "mode", "user_id"]];
    (analytics ?? []).forEach((r: any) => {
      rows.push([
        r.created_at,
        `"${(r.query ?? "").replace(/"/g, '""')}"`,
        String(r.result_count ?? 0),
        r.mode ?? "",
        r.user_id ?? "",
      ]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    return { csv, filename: `usage-report-${new Date().toISOString().slice(0, 10)}.csv` };
  });

export const isAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

// ============ Registered users & user analytics ============

export const listRegisteredUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const [{ data: profiles }, { data: authUsers }, { data: favs }, { data: roles }] =
      await Promise.all([
        context.supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        adminRpc(context.supabase, "admin_list_users"),
        context.supabase.from("favorites").select("user_id, item_type, label"),
        context.supabase.from("user_roles").select("user_id, role"),
      ]);
    const authById = new Map<string, any>((authUsers ?? []).map((u: any) => [u.id, u]));
    const favByUser = new Map<string, string[]>();
    (favs ?? []).forEach((f: any) => {
      if (f.item_type !== "product") return;
      const arr = favByUser.get(f.user_id) ?? [];
      arr.push(f.label ?? "");
      favByUser.set(f.user_id, arr);
    });
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r: any) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    return {
      users: (profiles ?? []).map((p: any) => ({
        id: p.id,
        full_name: p.full_name,
        display_name: p.display_name,
        email: p.email ?? authById.get(p.id)?.email ?? null,
        avatar_url: p.avatar_url,
        provider: p.provider,
        created_at: p.created_at,
        last_login_at: p.last_login_at ?? authById.get(p.id)?.last_sign_in_at ?? null,
        last_active_at: p.last_active_at,
        search_count: p.search_count ?? 0,
        report_count: p.report_count ?? 0,
        favorites: favByUser.get(p.id) ?? [],
        roles: rolesByUser.get(p.id) ?? [],
        status: p.status ?? "active",
        role: p.role ?? "user",
      })),
    };
  });

export const userAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const now = Date.now();
    const dayAgo = new Date(now - 86400_000).toISOString();
    const weekAgo = new Date(now - 7 * 86400_000).toISOString();
    const monthAgo = new Date(now - 30 * 86400_000).toISOString();
    const todayStart = new Date(new Date().toISOString().slice(0, 10)).toISOString();

    const [{ data: profiles }, { data: sessions }, { data: searches }, { data: history }] =
      await Promise.all([
        context.supabase
          .from("profiles")
          .select("id, created_at, last_sign_in_at, last_active_at, status, search_count, report_count"),
        context.supabase.from("user_sessions").select("user_id, started_at, last_seen_at, duration_seconds, ended_at").limit(20000),
        context.supabase.from("search_analytics").select("query, user_id, created_at").limit(10000),
        context.supabase.from("search_history").select("products").limit(5000),
      ]);

    const p = profiles ?? [];
    const ss = sessions ?? [];
    const s = searches ?? [];

    const activeUsers = (from: string) =>
      new Set([
        ...p.filter((r: any) => r.last_active_at >= from || r.last_sign_in_at >= from).map((r: any) => r.id),
        ...ss.filter((r: any) => r.last_seen_at >= from).map((r: any) => r.user_id),
      ]).size;

    const endedSessions = ss.filter((r: any) => r.ended_at !== null || (r.last_seen_at && now - new Date(r.last_seen_at).getTime() > 30 * 60 * 1000));
    const totalDuration = endedSessions.reduce(
      (sum: number, r: any) =>
        sum +
        (r.duration_seconds ?? Math.max(0, Math.min(8 * 3600, Math.round((Math.min(now, new Date(r.last_seen_at).getTime()) - new Date(r.started_at).getTime()) / 1000)))),
      0,
    );

    const byQuery = new Map<string, number>();
    s.forEach((r: any) => {
      const q = (r.query ?? "").toLowerCase().trim();
      if (q) byQuery.set(q, (byQuery.get(q) ?? 0) + 1);
    });
    const byProduct = new Map<string, number>();
    (history ?? []).forEach((r: any) =>
      (r.products ?? []).forEach((n: string) => byProduct.set(n, (byProduct.get(n) ?? 0) + 1)),
    );

    const totalReports = p.reduce((sum: number, r: any) => sum + (r.report_count ?? 0), 0);
    const totalUsers = p.length;
    const completed = endedSessions.length;
    const registered = p.filter((r: any) => r.status === "active").length;
    const suspended = p.length - p.filter((r: any) => r.status === "active").length;

    return {
      totalGuests: 0,
      totalRegistered: p.length,
      activeRegistered: registered,
      suspended,
      newToday: p.filter((r: any) => r.created_at >= todayStart).length,
      newWeek: p.filter((r: any) => r.created_at >= weekAgo).length,
      newMonth: p.filter((r: any) => r.created_at >= monthAgo).length,
      dau: activeUsers(dayAgo),
      wau: activeUsers(weekAgo),
      mau: activeUsers(monthAgo),
      totalSearches: s.length,
      avgSearchesPerUser: totalUsers ? +(s.length / totalUsers).toFixed(1) : 0,
      avgReportsPerUser: totalUsers ? +(totalReports / totalUsers).toFixed(1) : 0,
      totalReports,
      totalSessions: ss.length,
      activeSessions: ss.filter((r: any) => r.ended_at === null && r.last_seen_at && now - new Date(r.last_seen_at).getTime() <= 30 * 60 * 1000).length,
      avgSessionSeconds: completed ? Math.round(totalDuration / completed) : 0,
      totalUsageSeconds: totalDuration,
      topComplaints: [...byQuery.entries()]
        .map(([query, count]) => ({ query, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topProducts: [...byProduct.entries()]
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  });

export const exportRegisteredUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data: profiles } = await context.supabase
      .from("profiles")
      .select("full_name, email, created_at, last_login_at, search_count, report_count")
      .order("created_at", { ascending: false });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Name", "Email", "Registration Date", "Last Login", "Searches", "Reports"].join(","),
      ...(profiles ?? []).map((r: any) =>
        [
          esc(r.full_name),
          esc(r.email),
          esc(r.created_at),
          esc(r.last_login_at),
          r.search_count ?? 0,
          r.report_count ?? 0,
        ].join(","),
      ),
    ];
    return {
      csv: "\uFEFF" + rows.join("\r\n"),
      filename: `registered-users-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  });
