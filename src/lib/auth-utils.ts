/**
 * Shared auth helpers: same-origin destination validation and email masking.
 * Kept side-effect free so they are trivially unit-testable.
 */

/**
 * Only same-origin relative paths survive; anything else (external URLs,
 * protocol-relative URLs, backslash tricks, auth screens) falls back to "/".
 * Used everywhere a user-controllable `next` value must not become an open
 * redirect or bounce the user back into an auth screen.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
  return next;
}

/**
 * Masks a user email for display, e.g. "j***e@clinic.com". Never reveals the
 * full local part. Short locals and malformed values degrade gracefully.
 */
export function maskEmail(email: string | null): string {
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local.slice(1, -1).replace(/./g, "*")}${local[local.length - 1]}@${domain}`;
}