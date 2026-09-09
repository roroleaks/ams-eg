import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SignInPanel } from "@/components/sign-in-panel";
import { useAuth } from "@/lib/auth-context";
import { CheckCircle2, Loader2 } from "lucide-react";

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
  const { status, user, signOut, signingOut } = useAuth();
  const checking = status === "loading";
  const signedInEmail = user?.email ?? null;
  const [expired, setExpired] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | "switch" | "signout">(null);
  const [tab, setTab] = useState<"signin" | "create">("signin");

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
        <span className="sr-only">Restoring your session…</span>
      </div>
    );
  }

  function doSignOut(go: string) {
    setConfirmAction(null);
    void signOut(go);
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
                disabled={signingOut}
                onClick={() => doSignOut(confirmAction === "switch" ? "/auth" : "/auth?next=%2F")}
              >
                {signingOut ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing out…
                  </>
                ) : confirmAction === "switch" ? (
                  "Switch account"
                ) : (
                  "Sign out"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={signingOut}
                onClick={() => setConfirmAction(null)}
              >
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
        <h1 className="mb-4 text-center text-lg font-semibold text-foreground">
          Sign in or create an AMS account
        </h1>
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => setTab("signin")}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === "signin"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setTab("create")}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === "create"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Create account
          </button>
        </div>
        <SignInPanel next={dest} mode={tab} />
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