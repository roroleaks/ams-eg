import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OtpSignIn } from "@/components/otp-sign-in";
import { useAuth } from "@/lib/auth-context";
import { safeNext, maskEmail } from "@/lib/auth-utils";
import { consumeLocalCleared } from "@/lib/sign-out";
import { Loader2, LogOut, User } from "lucide-react";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — AMS" }] }),
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  const dest = safeNext(next || "/");
  const { status, user, signingOut, restoreFailed, retryRestore, signOut } = useAuth();
  const checking = status === "loading";
  const [expired, setExpired] = useState(false);
  const [localCleared, setLocalCleared] = useState(false);
  const [hasStoredSession, setHasStoredSession] = useState(false);

  // Returning users keep their session: if they are still signed in and were
  // sent here on the way to a page, take them straight there.
  useEffect(() => {
    if (status !== "authenticated" || signingOut) return;
    if (!next) return;
    window.location.replace(dest);
  }, [status, signingOut, next, dest]);

  // A one-shot notice when a sign-out could only clear the device locally (the
  // provider was unreachable). It never claims the server session was ended.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    setLocalCleared(consumeLocalCleared());
  }, [status]);

  // A stored session token on this device means the visitor has signed in
  // before. Offer a quick "already signed in" continue; if that token no
  // longer validates, treat the session as expired.
  useEffect(() => {
    if (status !== "unauthenticated") return;
    let hadToken = false;
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && /^sb-.*-auth-token/.test(key)) {
          hadToken = true;
          break;
        }
      }
    } catch {
      /* ignore */
    }
    if (!hadToken) return;
    setHasStoredSession(true);
    let mounted = true;
    const t = window.setTimeout(() => {
      if (mounted) setExpired(true);
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

  // Already signed in — show account options
  if (status === "authenticated" && user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md p-8">
          <div className="mb-6 text-center">
            <img
              src="/ams-logo.png"
              alt="America Medic &amp; Science"
              className="mx-auto h-16 w-16 rounded-2xl object-contain bg-white p-1.5 ring-1 ring-border shadow-sm"
            />
            <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
              AMS Clinical Reference
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to access the clinical decision-support application
            </p>
          </div>

          <div className="mb-6 p-4 rounded-lg border border-primary/30 bg-primary/10">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/20">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Welcome back</p>
                <p className="text-sm text-muted-foreground">{maskEmail(user.email)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              className="w-full"
              onClick={() => window.location.href = dest}
              disabled={signingOut}
            >
              Continue to AMS Clinical Reference
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void signOut("/auth?next=%2F")}
              disabled={signingOut}
            >
              {signingOut ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  <LogOut className="mr-2 h-4 w-4" />
                  Signing out…
                </>
              ) : (
                <>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out and use another account
                </>
              )}
            </Button>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground text-center">
            Access is restricted to authorised clinicians. We log only the activity needed to keep this
            workspace secure and to improve your experience — never patient data, and never for advertising.
            Your information is not sold or shared.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <img
            src="/ams-logo.png"
            alt="America Medic &amp; Science"
            className="mx-auto h-16 w-16 rounded-2xl object-contain bg-white p-1.5 ring-1 ring-border shadow-sm"
          />
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">
            AMS Clinical Reference
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to access the clinical decision-support application
          </p>
        </div>

        {hasStoredSession && (
          <Button className="w-full mb-4" onClick={() => window.location.replace(dest)}>
            Already signed in? Continue to AMS Clinical Reference
          </Button>
        )}


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

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground text-center">
          Access is restricted to authorised clinicians. We log only the activity needed to keep this
          workspace secure and to improve your experience — never patient data, and never for advertising.
          Your information is not sold or shared.
        </p>
      </Card>
    </div>
  );
}