import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2, Mail } from "lucide-react";

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

const RESEND_COOLDOWN_S = 60;

function AuthPage() {
  const { next } = Route.useSearch();
  const dest = safeNext(next || "/");

  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  function startResendCountdown() {
    setResendIn(RESEND_COOLDOWN_S);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timerRef.current) window.clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  /** Handle magic-link / exchange callbacks appended to the URL. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthOk = params.get("next");
      const hasOAuthFlow = window.location.hash.length > 0 || oauthOk !== null;
      // On a fresh page load with a valid session, go straight to the app.
      if (!hasOAuthFlow) {
        const { data } = await supabase.auth.getUser();
        if (!cancelled && data.user) {
          window.location.href = dest;
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dest]);

  /** Exchange code / token_hash params (magic-link click or expired-link state). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const err = params.get("error");
    if (err) {
      setError(decodeURIComponent(params.get("error_description") ?? "Sign in failed. Please try again."));
    }
    if (code) {
      setLoading(true);
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            setError("This verification link is invalid or has expired. Please request a new code below.");
            setLoading(false);
            return;
          }
          redirectAfterAuth(dest);
        })
        .catch(() => {
          setError("This verification link is invalid or has expired. Please request a new code below.");
          setLoading(false);
        });
    } else if (tokenHash) {
      setLoading(true);
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: "magiclink" })
        .then(({ error }) => {
          if (error) {
            setError("This verification link is invalid or has expired. Please request a new code below.");
            setLoading(false);
            return;
          }
          redirectAfterAuth(dest);
        })
        .catch(() => {
          setError("This verification link is invalid or has expired. Please request a new code below.");
          setLoading(false);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth${dest !== "/" ? `?next=${encodeURIComponent(dest)}` : ""}`,
        },
      });
      if (error) throw error;
      // Generic message — never reveals whether an account exists.
      setInfo("If an account exists for this address, a sign-in code is on its way. Check your inbox (and spam folder).");
      setStep("otp");
      startResendCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: otp.replace(/\s/g, ""),
        type: "email",
      });
      if (error) throw error;
      // Account-level check (suspended / deleted).
      const { data: profile } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
        .maybeSingle();
      if (profile && profile.status !== "active") {
        await supabase.auth.signOut();
        setError("Your account is currently suspended. Contact your administrator for access.");
        setLoading(false);
        return;
      }
      window.location.href = dest;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (/expired|invalid|token/i.test(msg)) {
        setError("That code is invalid or has expired. Request a new one below.");
      } else {
        setError(msg);
      }
      setLoading(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setInfo(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth${dest !== "/" ? `?next=${encodeURIComponent(dest)}` : ""}`,
    });
    if (result.error) setError(result.error.message ?? "Google sign-in failed");
  }

  function backToEmail() {
    setStep("email");
    setError(null);
    setInfo(null);
    setOtp("");
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md p-8">
        <div className="flex items-center gap-3 mb-6">
          <img src="/ams-logo.png" alt="AMS" className="h-10 w-10" />
          <div>
            <h1 className="text-lg font-semibold">AMS Clinical Reference</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to access the clinical decision-support application
            </p>
          </div>
        </div>

        <Button type="button" variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
          Continue with Google
        </Button>
        <p className="mt-2 mb-4 text-[11px] leading-relaxed text-muted-foreground">
          Google sign-in shares only your name, email address and profile picture. We use it solely
          to personalise your experience and improve the app — your information is never shared with
          third parties and never used for marketing without your explicit consent.
        </p>

        <div className="relative my-4 text-center">
          <span className="text-xs uppercase tracking-wide text-muted-foreground bg-background px-2">
            or use a sign-in code
          </span>
        </div>

        {step === "email" ? (
          <form onSubmit={onRequestCode} className="space-y-4">
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@organisation.com"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              We'll email you a one-time sign-in code. No password required.
            </p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Mail className="mr-2 h-4 w-4" />
              Send me a sign-in code
            </Button>
          </form>
        ) : (
          <form onSubmit={onVerifyCode} className="space-y-4">
            <div>
              <Label htmlFor="otp">Sign-in code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                required
                maxLength={8}
                placeholder="6-digit code"
                className="tracking-[0.3em] text-center text-lg"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {info && <p className="text-sm text-muted-foreground">{info}</p>}
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={backToEmail}
                disabled={loading}
              >
                ← Change email
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={loading || resendIn > 0}
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  onRequestCode(new Event("submit") as any);
                }}
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </Button>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify &amp; sign in
            </Button>
          </form>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          Sign-in is restricted to authorised users. We record basic session activity (when you sign
          in/out and which articles you open) to keep the service secure and to improve it. We never
          sell or share your personal data.
        </p>
      </Card>
    </div>
  );
}

async function redirectAfterAuth(dest: string) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "")
    .maybeSingle();
  if (profile && profile.status !== "active") {
    await supabase.auth.signOut();
    window.location.href = "/auth";
    return;
  }
  window.location.href = dest;
}