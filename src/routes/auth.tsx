import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { SignInPanel } from "@/components/sign-in-panel";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — AMS" }] }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthPage,
});

// Only allow same-origin relative paths.
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function AuthPage() {
  const { next } = Route.useSearch();
  const dest = safeNext(next || "/");

  // Fresh page load with an active session → straight to the app. Skipped when
  // a magic-link / OAuth callback is present (the panel handles those).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasCode = params.get("code");
    const hasTokenHash = params.get("token_hash");
    const hasOauthError = params.get("error");
    if (window.location.hash.length > 0 || hasCode || hasTokenHash || hasOauthError) return;
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!cancelled && data.user) window.location.href = dest;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dest]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <SignInPanel next={dest} />
        <p className="mt-6 text-center">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            ← Back to search
          </Link>
        </p>
      </Card>
    </div>
  );
}