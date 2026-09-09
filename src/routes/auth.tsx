import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignInPanel } from "@/components/sign-in-panel";
import { completeSignOut } from "@/lib/auth-actions";
import { CheckCircle2, Loader2 } from "lucide-react";

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
  const [checking, setChecking] = useState(true);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  // Restore an existing session first — never flash the sign-in form when a
  // saved session exists. Skipped when a callback is present (panel handles).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hasCode = params.get("code");
    const hasTokenHash = params.get("token_hash");
    const hasOauthError = params.get("error");
    if (window.location.hash.length > 0 || hasCode || hasTokenHash || hasOauthError) {
      setChecking(false);
      setSignedInEmail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      await supabase.auth.getSession();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        setSignedInEmail(data.user?.email ?? null);
        setChecking(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setSignedInEmail(null);
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [dest]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="sr-only">Restoring your session…</span>
      </div>
    );
  }

  if (signedInEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-foreground">Already signed in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You're signed in as <span className="font-medium text-foreground">{signedInEmail}</span>.
            Continue to the app.
          </p>
          <div className="mt-6 space-y-3">
            <Button asChild className="w-full">
              <a href={dest}>Continue to the app</a>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => void completeSignOut()}
            >
              Sign in with a different account
            </Button>
          </div>
        </Card>
      </div>
    );
  }

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