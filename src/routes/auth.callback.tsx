import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" && s.next ? { next: s.next } : {},
  component: AuthCallback,
});

// Only allow same-origin relative paths; everything else falls back to "/".
function safeNext(next: string): string {
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  return next;
}

function AuthCallback() {
  const { next } = Route.useSearch();
  const dest = safeNext(next || "/");
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError = params.get("error");
      const oauthErrorDescription = params.get("error_description");
      const code = params.get("code");

      if (oauthError || oauthErrorDescription) {
        if (!cancelled) {
          setErrorMessage(
            decodeURIComponent(
              oauthErrorDescription ?? oauthError ?? "Sign in failed. Please try again.",
            ),
          );
          setStatus("error");
        }
        return;
      }

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (window.location.hash.length > 0) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error("This sign-in link is invalid or has expired.");
        } else {
          throw new Error("This sign-in link cannot be used because it is missing the required parameters.");
        }
        const { data } = await supabase.auth.getUser();
        if (!cancelled) {
          if (data.user) {
            window.location.href = dest;
          } else {
            setErrorMessage("Sign-in could not be completed. Please try again.");
            setStatus("error");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error ? err.message : "Sign-in could not be completed. Please try again.",
          );
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dest]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="mt-3 text-sm text-muted-foreground">Checking your sign-in status…</p>
      </div>
    );
  }

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