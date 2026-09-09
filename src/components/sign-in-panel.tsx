import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";

const RESEND_COOLDOWN_S = 60;

/**
 * Shared email OTP / magic-link sign-in flow. Used both as a full page
 * (route /auth) and inside the AuthGate modal. Never verifies an arbitrary
 * email locally — sign-in always goes through Supabase OTP verification.
 */
export function SignInPanel({
  next = "/",
  onSuccess,
  showClose = false,
  onClose,
}: {
  /** Same-origin destination to resume to after auth (page mode). */
  next?: string;
  /** Called after successful auth so the caller can resume a pending action. */
  onSuccess?: () => void;
  /** Render a close/cancel control (modal mode). */
  showClose?: boolean;
  onClose?: () => void;
}) {
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

  /** Reject accounts whose profile is not active (suspended / deleted). */
  async function ensureActiveAccount(): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (profile && profile.status !== "active") {
      await supabase.auth.signOut();
      setError("Your account is currently suspended. Contact your administrator for access.");
      return false;
    }
    return true;
  }

  async function finishAuthentication() {
    if (!(await ensureActiveAccount())) {
      setLoading(false);
      return;
    }
    onSuccess?.();
    deletePendingHash();
    if (!onSuccess) window.location.href = next;
  }

  /** Handles magic-link / OAuth exchange parameters appended to the URL. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const err = params.get("error");
      const oauthNext = params.get("next");
      if (err) {
        setError(
          decodeURIComponent(params.get("error_description") ?? "Sign in failed. Please try again."),
        );
        return;
      }
      if (code) {
        setLoading(true);
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) {
          if (error) {
            setError(
              "This verification link is invalid or has expired. Please request a new code below.",
            );
            setLoading(false);
          } else {
            await finishAuthentication();
          }
        }
      } else if (tokenHash) {
        setLoading(true);
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (!cancelled) {
          if (error) {
            setError(
              "This verification link is invalid or has expired. Please request a new code below.",
            );
            setLoading(false);
          } else {
            await finishAuthentication();
          }
        }
      } else if (oauthNext !== null && window.location.hash.length > 0) {
        // Clean up leftover OAuth hash fragments (e.g. #access_token=...) after exchange.
        window.history.replaceState(null, "", window.location.pathname);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function deletePendingHash() {
    try {
      const params = new URLSearchParams(window.location.search);
      const nextParam = params.get("next");
      window.history.replaceState(
        null,
        "",
        nextParam ? `/auth?next=${encodeURIComponent(nextParam)}` : window.location.pathname,
      );
    } catch {
      /* ignore */
    }
  }

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth${
            next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
          }`,
        },
      });
      if (error) throw error;
      // Generic message — never reveals whether an account exists.
      setInfo(
        "If an account exists for this address, a sign-in code is on its way. Check your inbox (and spam folder).",
      );
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
      await finishAuthentication();
      setStep("email");
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
      redirect_uri: `${window.location.origin}/auth${
        next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
      }`,
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
    <div>
      <div className="flex items-center gap-3">
        <img src="/ams-logo.png" alt="AMS" className="h-10 w-10" />
        <div>
          <h1 className="text-lg font-semibold">AMS Clinical Reference</h1>
          <p className="text-sm text-muted-foreground">Sign in to use the AMS Product Advisor</p>
        </div>
        {showClose && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Close sign in"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <Button type="button" variant="outline" className="mt-6 w-full" onClick={onGoogle} disabled={loading}>
        Continue with Google
      </Button>
      <p className="mt-2 mb-4 text-[11px] leading-relaxed text-muted-foreground">
        Google sign-in shares only your name, email address and profile picture. We use it solely to
        personalise your experience and improve the app — your information is never shared with third
        parties and never used for marketing without your explicit consent.
      </p>

      <div className="relative my-4 text-center">
        <span className="bg-background px-2 text-xs uppercase tracking-wide text-muted-foreground">
          or use a sign-in code
        </span>
      </div>

      {step === "email" ? (
        <form onSubmit={onRequestCode} className="space-y-4">
          <div>
            <Label htmlFor="signin-email">Work email</Label>
            <Input
              id="signin-email"
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
            <Label htmlFor="signin-otp">Sign-in code</Label>
            <Input
              id="signin-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
              maxLength={8}
              placeholder="6-digit code"
              className="text-center text-lg tracking-[0.3em]"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="ghost" size="sm" onClick={backToEmail} disabled={loading}>
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
    </div>
  );
}