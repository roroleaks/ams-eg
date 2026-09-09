/**
 * Shared predicate for PostgREST/Supabase errors caused by relations or columns
 * that do not exist yet. The pending migration adds `user_sessions`,
 * `admin_audit_logs` and several `profiles` columns; until it is applied those
 * queries legitimately fail with schema-cache/does-not-exist messages and must
 * degrade gracefully instead of surfacing as blank screens or 500s.
 */
export function isMissingRelationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; code?: unknown; details?: unknown };
  const code = typeof e.code === "string" ? e.code : "";
  const message =
    typeof e.message === "string"
      ? e.message
      : typeof e.details === "string"
        ? e.details
        : "";
  if (/^PGRST20[15]$/.test(code)) return true;
  return /(?:relation .* does not exist|could not find the (?:'[^']+' )?table .*? in the schema cache|could not find the table .*? in the schema cache|column .* does not exist|could not find the ['"][^'"]+['"] column of .*? in the schema cache)/i.test(
    message,
  );
}