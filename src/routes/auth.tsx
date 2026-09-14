import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OtpSignIn } from "@/components/otp-sign-in";
import { useAuth } from "@/lib/auth-context";
import { consumeLocalCleared } from "@/lib/sign-out";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — AMS" }] }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthPage,
});

// Only allow same-origin relative paths; never bounce back to auth screens.
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
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
  const { status, user, signingOut, restoreFailed, retryRestore } = useAuth();
  const checking = status === "loading";
  const [expired, setExpired] = useState(false);
  const [localCleared, setLocalCleared] = useState(false);

  // A valid persisted session means this device is already trusted: send the
  // user straight back into the app without any sign-in prompt or extra click.
  // Covers both direct visits and the magic-link / Google OAuth return (the
  // provider applies the delivered session before this effect runs).
  useEffect(() => {
    if (status !== "authenticated" || !user || signingOut) return;
    window.location.href = dest;
  }, [status, user, signingOut, dest]);

  // A one-shot notice when a sign-out could only clear the device locally (the
  // provider was unreachable). It never claims the server session was ended.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    setLocalCleared(consumeLocalCleared());
  }, [status]);

  // A leftover stored token that no longer validates means the session
  // expired. Detect it once the provider has finished restoring.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    let mounted = true;
    const t = window.setTimeout(() => {
      if (mounted) setExpired(hasStoredAuthToken());
    }, 50);
    return () => {
      mounted = false;
      window.clearTimeout(t);
    };
  }, [status]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="sr-only">Checking your sign-in status…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src="/ams-logo.png" alt="AMS" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">AMS Clinical Reference</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to access the clinical decision-support application
            </p>
          </div>
        </div>

        {localCleared && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Your local session was cleared. Please reload if the app still appears signed in.
          </p>
        )}
        {restoreFailed && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            <p>We could not restore your session. Please try again.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => retryRestore()}
            >
              Retry
            </Button>
          </div>
        )}
        {expired && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Your session expired. Please sign in again.
          </p>
        )}

        <OtpSignIn next={dest} />

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Sign-in is restricted to authorised users. We record basic session activity (when you sign
          in/out and which articles you open) to keep the service secure and to improve it. We never
          sell or share your personal data.
        </p>
      </Card>
    </div>
  );
}