/**
 * Resolves the Lovable AI gateway key across runtimes.
 *
 * - Production: Lovable injects LOVABLE_API_KEY into the hosted runtime as a
 *   real env var (highest precedence).
 * - Preview / local: Vite loads .env and .env.local into import.meta.env, so a
 *   gitignored .env.local can provide the key without committing a secret.
 */
export function getLovableApiKey(): string | undefined {
  const fromProcess =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)?.LOVABLE_API_KEY
      : undefined;
  return (
    fromProcess ??
    (import.meta.env.LOVABLE_API_KEY as string | undefined) ??
    (import.meta.env.VITE_LOVABLE_API_KEY as string | undefined)
  );
}