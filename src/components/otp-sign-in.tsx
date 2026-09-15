import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, ArrowLeft, AlertCircle } from "lucide-react";
import { safeNext, maskEmail } from "@/lib/auth-utils";
import { CALLBACK_TIMEOUT_MS, raceWithTimeout } from "@/lib/sign-out";

const RESEND_COOLDOWN_S = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
 * Magic-link sign-in. Sends a secure sign-in link to the email.
 * The link returns the user to /auth/callback which completes the sign-in.
 */
export const STAY_SIGNED_IN_KEY = "ams-stay-signed-in";

function readStaySignedIn(): boolean {
  try {
    return localStorage.getItem(STAY_SIGNED_IN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function OtpSignIn({ next = "/" }: { next?: string }) {
  const [step, setStep] = useState<"email" | "check-email">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [staySignedIn, setStaySignedInState] = useState<boolean>(readStaySignedIn);
  const timerRef = useRef<number | null>(null);

  function setStaySignedIn(v: boolean) {
    setStaySignedInState(v);
    try {
      localStorage.setItem(STAY_SIGNED_IN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

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

  async function sendLink() {
    const normEmail = email.trim().toLowerCase();
    const dest = safeNext(next || "/");
    const res = await raceWithTimeout(
      supabase.auth.signInWithOtp({
        email: normEmail,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(dest)}`,
        },
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
      if (await sendLink()) {
        setStep("check-email");
        startResendCountdown();
      }
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
      if (await sendLink()) {
        setInfo("A new sign-in link is on its way.");
        startResendCountdown();
      }
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  /** Verifies the 6-digit access code included in the sign-in email. */
  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (verifying) return;
    setError(null);
    setInfo(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifying(true);
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
        if (/expired|invalid|token/i.test(msg)) {
          setError(
            "That code is not valid or has expired. Check the latest email, or request a new access link.",
          );
        } else {
          setError(friendlyAuthError(res.error));
        }
        return;
      }
      window.location.href = safeNext(next || "/");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setVerifying(false);
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

  const maskedEmail = maskEmail(email);

  return (
    <div>
      {step === "email" ? (
        <form onSubmit={onSubmitEmail} className="space-y-4" noValidate>
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
              aria-describedby="email-hint"
            />
            <p id="email-hint" className="text-xs text-muted-foreground">
              We&apos;ll email you a single-use, secure access link. No password required.
            </p>
          </div>
          <label className="flex items-start gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={staySignedIn}
              onChange={(e) => setStaySignedIn(e.target.checked)}
              disabled={loading}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>
              Stay signed in on this device
              <span className="block text-xs">
                Untick on shared or public computers — you&apos;ll be signed out when you close this tab.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            Send secure access link
          </Button>
        </form>
      ) : step === "check-email" ? (
        <div className="space-y-4" role="status" aria-live="polite">
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-5 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/20">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <p className="mt-4 font-semibold text-foreground">Secure access link sent</p>
            <p className="mt-2 text-sm text-muted-foreground">
              We&apos;ve emailed a one-time sign-in link to{" "}
              <span className="font-medium text-foreground">{maskedEmail}</span>.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the email on this device and tap the link to enter your AMS clinical reference
              workspace — or enter the 6-digit code from the same email below. Both expire in 10
              minutes and can be used once.
            </p>
          </div>

          <form onSubmit={onVerifyCode} className="space-y-3">
            <Label htmlFor="otp-code">Enter your 6-digit access code</Label>
            <Input
              id="otp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={verifying}
              className="text-center text-2xl tracking-[0.5em] font-semibold"
              aria-describedby="otp-code-hint"
            />
            <p id="otp-code-hint" className="text-xs text-muted-foreground text-center">
              Use the code if you opened the email on another device.
            </p>
            <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
              {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify and continue
            </Button>
          </form>


          <p className="text-center text-sm text-muted-foreground">
            Didn&apos;t receive it?{" "}
            {resendIn > 0 ? (
              <span>Resend in {resendIn}s</span>
            ) : (
              <button
                type="button"
                onClick={onResend}
                disabled={loading}
                className="font-medium text-primary hover:underline"
              >
                Resend access link
              </button>
            )}
          </p>

          {info && (
            <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary text-center">
              A new access link is on its way.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive text-center flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </p>
          )}

          <div className="flex items-center justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("email");
                setError(null);
                setInfo(null);
              }}
              disabled={loading}
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Use a different email
            </Button>
          </div>
        </div>
      ) : null}

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