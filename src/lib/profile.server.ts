export async function bumpCounter(
  context: { supabase: any; userId: string },
  column: "search_count" | "report_count",
) {
  try {
    const { data } = await context.supabase
      .from("profiles")
      .select(column)
      .eq("id", context.userId)
      .maybeSingle();
    const current = Number(data?.[column] ?? 0);
    await context.supabase
      .from("profiles")
      .update({ [column]: current + 1 })
      .eq("id", context.userId);
  } catch {
    /* counters are best-effort */
  }
}
