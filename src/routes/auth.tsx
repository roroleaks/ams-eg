import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignInPanel } from "@/components/sign-in-panel";
import { endTrackedSession } from "@/lib/session";
import { CheckCircle2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — AMS" }] }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthPage,
});

// Only allow same-origin relative paths; everything else falls back to "/".
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  return next;
}

function hasStoredAuthToken(): boolean {
  if (typeof localStorage === "undefined") return false;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) return true;
  }
  return false;
}

function AuthPage() {
  const { next } = Route.useSearch();
  const dest = safeNext(next || "/");
  const [checking, setChecking] = useState(true);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | "switch" | "signout">(null);

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
      const hadToken = hasStoredAuthToken();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        setSignedInEmail(data.user?.email ?? null);
        // A stored session that no longer validates means it expired.
        setExpired(!data.user && hadToken);
        setChecking(false);
      }
    })().catch(() => {
      if (!cancelled) {
        setSignedInEmail(null);
        setExpired(hasStoredAuthToken());
        setChecking(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="sr-only">Restoring your session…</span>
      </div>
    );
  }

  async function doSignOut(go: string) {
    setConfirmAction(null);
    await endTrackedSession();
    await supabase.auth.signOut();
    window.location.href = go;
  }

  if (signedInEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md p-8 text-center">
          <img src="/ams-logo.png" alt="AMS" className="mx-auto h-12 w-12" />
          <div className="mx-auto mt-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-foreground">You are already signed in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{signedInEmail}</span>
          </p>

          {confirmAction ? (
            <div className="mt-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                {confirmAction === "switch"
                  ? "You'll be signed out on this device so you can use a different account."
                  : "This will end your session on this device."}
              </p>
              <Button
                className="w-full"
                onClick={() => doSignOut(confirmAction === "switch" ? "/auth" : "/")}
              >
                {confirmAction === "switch" ? "Switch account" : "Sign out"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <Button asChild className="w-full">
                <a href={dest}>Continue to AMS Product Advisor</a>
              </Button>
              <Button type="button" variant="outline" className="w-full" onClick={() => setConfirmAction("switch")}>
                Use a different account
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => setConfirmAction("signout")}>
                Sign out
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md p-8">
        {expired && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Your session expired. Please sign in again.
          </p>
        )}
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