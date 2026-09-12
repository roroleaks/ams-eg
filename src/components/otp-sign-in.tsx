import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, ArrowLeft, ShieldCheck } from "lucide-react";
import {
  AUTH_RESTORE_TIMEOUT_MS,
  CALLBACK_TIMEOUT_MS,
  delay,
  raceWithTimeout,
  SIGN_OUT_TIMEOUT_MS,
} from "@/lib/sign-out";

const RESEND_COOLDOWN_S = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Same-origin relative paths only; anything else falls back to "/".
function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
  return next;
}

function friendlyAuthError(err: unknown): string {
  if (err instanceof Error && err.message) {
    if (/(fetch failed|network|load failed|timeout|connection|socket)/i.test(err.message)) {
      return "Network error — check your connection and try again.";
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

/**
 * Passwordless email-code (OTP) sign-in. Sends a 6-digit code to the email,
 * verifies it, then resumes to `next`. A magic link in the same email also
 * works (handled by /auth/callback).
 */
export function OtpSignIn({ next = "/" }: { next?: string }) {
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<number | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (step === "verify") codeRef.current?.focus();
  }, [step]);

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

  async function sendCode() {
    const normEmail = email.trim().toLowerCase();
    const res = await raceWithTimeout(
      supabase.auth.signInWithOtp({
        email: normEmail,
        options: { shouldCreateUser: true },
      }),
      CALLBACK_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (res === "TIMEOUT") {
      setError("Sending timed out. Check your connection and try again.");
      return false;
    }
    if (res.error) {
      const msg = res.error.message || "";
      if (/rate limit|too many requests|over_email_send_rate_limit/i.test(msg)) {
        setError("Too many attempts. Please wait a few minutes and try again.");
      } else {
        setError(friendlyAuthError(res.error));
      }
      return false;
    }
    setEmail(normEmail);
    return true;
  }

  async function onSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setInfo(null);
    const normEmail = email.trim().toLowerCase();
    if (!normEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (!EMAIL_RE.test(normEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      if (await sendCode()) {
        setStep("verify");
        startResendCountdown();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  /** Reject suspended/deleted accounts before letting the session through. */
  async function ensureActiveAccount(): Promise<boolean> {
    const res = await raceWithTimeout(
      supabase.auth.getUser(),
      AUTH_RESTORE_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (res === "TIMEOUT" || res.error || !res.data.user) {
      setError("We couldn't verify your account. Check your connection and try again.");
      return false;
    }
    const user = res.data.user;
    const profileRes = await raceWithTimeout(
      Promise.resolve(supabase.from("profiles").select("status").eq("id", user.id).maybeSingle()),
      AUTH_RESTORE_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (profileRes !== "TIMEOUT" && !profileRes.error) {
      const profile = profileRes.data;
      if (profile && profile.status !== "active") {
        void Promise.race([supabase.auth.signOut().catch(() => {}), delay(SIGN_OUT_TIMEOUT_MS)]);
        setError("Your account is currently suspended. Contact your administrator for access.");
        return false;
      }
    }
    return true;
  }

  async function onSubmitCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    const token = code.trim();
    if (!/^\d{6}$/.test(token)) {
      setError("Please enter the 6-digit code from your email.");
      return;
    }
    setLoading(true);
    try {
      const res = await raceWithTimeout(
        supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" }),
        CALLBACK_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("Verification timed out. Check your connection and try again.");
        return;
      }
      if (res.error) {
        const msg = res.error.message || "";
        if (/expired|invalid/i.test(msg)) {
          setError("That code is invalid or has expired. Request a new one and try again.");
        } else {
          setError(friendlyAuthError(res.error));
        }
        return;
      }
      if (!(await ensureActiveAccount())) return;
      window.location.href = safeNext(next);
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (loading || resendIn > 0) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (await sendCode()) {
        setCode("");
        setInfo("A new code is on its way.");
        startResendCountdown();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setLoading(true);
    const result = await raceWithTimeout(
      lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin }),
      CALLBACK_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (result === "TIMEOUT") {
      setError("Google sign-in is taking too long. Check your connection and try again.");
      setLoading(false);
      return;
    }
    if (result.error) {
      setError(result.error.message ?? "Google sign-in failed");
      setLoading(false);
    }
    // Success navigates away via the broker flow.
  }

  return (
    <div>
      {step === "email" ? (
        <form onSubmit={onSubmitEmail} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp-email">Work email</Label>
            <Input
              id="otp-email"
              type="email"
              autoComplete="email"
              placeholder="you@clinic.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
            <p className="text-xs text-muted-foreground">
              We'll email you a 6-digit sign-in code — no password needed.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Email me a code
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} className="space-y-4">
          <button
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setInfo(null);
            }}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Use a different email
          </button>
          <div className="space-y-2">
            <Label htmlFor="otp-code">Enter the 6-digit code</Label>
            <Input
              id="otp-code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={loading}
              className="text-center text-2xl font-semibold tracking-[0.5em]"
              required
            />
            <p className="text-xs text-muted-foreground">
              Sent to <span className="font-medium text-foreground">{email}</span>. You can also
              click the sign-in link in the email.
            </p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {info && (
            <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              {info}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
            Verify & sign in
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Didn't get it?{" "}
            {resendIn > 0 ? (
              <span>Resend in {resendIn}s</span>
            ) : (
              <button
                type="button"
                onClick={onResend}
                disabled={loading}
                className="font-medium text-primary hover:underline"
              >
                Resend code
              </button>
            )}
          </p>
        </form>
      )}

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onGoogle} disabled={loading}>
        Continue with Google
      </Button>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        We only use your name, email, and profile picture to create your account.
      </p>
    </div>
  );
}
