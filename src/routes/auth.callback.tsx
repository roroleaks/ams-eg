import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { touchProfile } from "@/lib/profile.functions";
import { CALLBACK_TIMEOUT_MS, PROFILE_UPSERT_TIMEOUT_MS, raceWithTimeout } from "@/lib/sign-out";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthCallback,
});

// Only allow same-origin relative paths and never bounce back to auth screens.
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
  return next;
}

function AuthCallback() {
  const { next } = Route.useSearch();
  const dest = useMemo(() => safeNext(next || "/"), [next]);
  const { status } = useAuth();
  const touchProfileFn = useServerFn(touchProfile);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const exchangedRef = useRef(false);
  const finalizedRef = useRef(false);

  // Exchange the authorization code exactly once, through the official
  // provider method. Fragment-delivered magic links are handled by the auth
  // client's own URL detection during init, so no code param means wait.
  useEffect(() => {
    if (errorMessage || exchangedRef.current) return;
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get("error");
      const oauthErrorDescription = params.get("error_description");
      const code = params.get("code");

      if (oauthError || oauthErrorDescription) {
        if (cancelled) return;
        setErrorMessage(
          decodeURIComponent(
            oauthErrorDescription ?? oauthError ?? "Sign in failed. Please try again.",
          ),
        );
        return;
      }

      if (code) {
        exchangedRef.current = true;
        const res = await raceWithTimeout(
          supabase.auth.exchangeCodeForSession(code),
          CALLBACK_TIMEOUT_MS,
          "TIMEOUT" as const,
        );
        if (!cancelled) {
          if (res === "TIMEOUT") {
            setErrorMessage("Sign-in could not be completed. Check your connection and try again.");
          } else if (res.error) {
            setErrorMessage(res.error.message);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [errorMessage]);

  // Wait for the centralized auth provider to report authenticated, then
  // upsert exactly one profile row and redirect exactly once to the safe
  // destination.
  useEffect(() => {
    if (errorMessage || finalizedRef.current) return;
    if (status !== "authenticated") return;
    finalizedRef.current = true;
    // Bounded, background profile housekeeping: never delays the redirect.
    void raceWithTimeout(
      touchProfileFn(),
      PROFILE_UPSERT_TIMEOUT_MS,
      null,
    )
      .catch(() => undefined)
      .finally(() => {
        window.location.href = dest;
      });
  }, [status, errorMessage, dest, touchProfileFn]);

  // Guard against a silent hang on a parameter-less / stale landing: if the
  // provider has not authenticated shortly after we tried to exchange,
  // surface a clear error instead of spinning indefinitely.
  useEffect(() => {
    if (errorMessage || finalizedRef.current || status !== "loading") return;
    const t = window.setTimeout(() => {
      if (finalizedRef.current) return;
      setErrorMessage(
        "This sign-in link cannot be used because it is missing the required parameters or has expired.",
      );
    }, 15000);
    return () => window.clearTimeout(t);
  }, [errorMessage, status]);

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <Card className="w-full max-w-md p-8 text-center">
          <img src="/ams-logo.png" alt="AMS" className="mx-auto h-12 w-12" />
          <h1 className="mt-4 text-lg font-semibold text-foreground">
            This sign-in link could not be completed
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have expired, already been used, or be invalid. Request a new sign-in link to
            continue.
          </p>
          <div className="mt-6 space-y-3">
            <Button asChild className="w-full">
              <Link to="/auth">Go to sign in</Link>
            </Button>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/">Back to search</Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-3 text-sm text-muted-foreground">Checking your sign-in status…</p>
    </div>
  );
}