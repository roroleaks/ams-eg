import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";

const RESEND_COOLDOWN_S = 60;

// Same-origin relative paths only; anything else (external, scheme-URLs,
// protocol-relative, auth screens) falls back to "/" to prevent open-redirect.
function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (/^[/\\]{2}/.test(next)) return "/";
  if (next === "/auth" || next.startsWith("/auth/") || next.startsWith("/auth?")) return "/";
  return next;
}
const LAST_EMAIL_KEY = "ams_last_login_email";

/**
 * Passwordless email sign-in flow (magic link). Used both as a full page
 * (route /auth) and inside the AuthGate modal. Sign-in always goes through
 * the Supabase emailed magic link.
 */
export function SignInPanel({
  next = "/",
  onSuccess,
  showClose = false,
  onClose,
  mode = "signin",
}: {
  /** Same-origin destination to resume to after auth (page mode). */
  next?: string;
  /** Called after successful auth so the caller can resume a pending action. */
  onSuccess?: () => void;
  /** Render a close/cancel control (modal mode). */
  showClose?: boolean;
  onClose?: () => void;
  /** "signin" = existing user; "create" = new account via verification link. */
  mode?: "signin" | "create";
}) {
  const [step, setStep] = useState<"email" | "sent">("email");
  const [email, setEmail] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem(LAST_EMAIL_KEY) ?? "" : ""),
  );
  const [remembered, setRemembered] = useState<string | null>(() =>
    typeof window !== "undefined" ? (localStorage.getItem(LAST_EMAIL_KEY) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<number | null>(null);
  const completedRef = useRef(false);

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
    if (user.email) {
      try {
        localStorage.setItem(LAST_EMAIL_KEY, user.email);
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  async function finishAuthentication() {
    if (completedRef.current) return;
    completedRef.current = true;
    if (!(await ensureActiveAccount())) {
      completedRef.current = false;
      setLoading(false);
      return;
    }
    onSuccess?.();
    deletePendingHash();
    if (!onSuccess) window.location.href = safeNext(next);
  }

  /** Handles magic-link / OAuth exchange parameters appended to the URL. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const err = params.get("error");
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
            setError(error.message || "This sign-in link is invalid or has expired. Please try again.");
            setLoading(false);
          } else {
            await finishAuthentication();
          }
        }
      } else {
        // Magic-link / OAuth redirects deliver the session as URL fragment
        // parameters (e.g. #access_token=...&refresh_token=...). We must NOT
        // clean the URL before this recovery runs, or sign-in fails silently.
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session) await finishAuthentication();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Complete auth whenever Supabase reports a signed-in user (async recovery). */
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && !completedRef.current) void finishAuthentication();
    });
    return () => sub.subscription.unsubscribe();
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
    if (loading) return;
    setError(null);
    setInfo(null);
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError("Please enter your email address.");
      return;
    }
    setEmail(normalized);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalized,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback${
            next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
          }`,
        },
      });
      if (error) throw error;
      try {
        localStorage.setItem(LAST_EMAIL_KEY, normalized);
      } catch {
        /* ignore */
      }
      setRemembered(normalized);
      // Generic message — never reveals whether an account exists.
      setInfo(
        "If this email already has an account, you will be signed in. If it is new, an account will be created after email verification.",
      );
      setStep("sent");
      startResendCountdown();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
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
  }

  function forgetEmail() {
    try {
      localStorage.removeItem(LAST_EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setRemembered(null);
    setEmail("");
  }

  const sentHeadline = "Check your email";
  const sentBodyStart = "We sent a secure sign-in link to your email address.";

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
          or sign in with your work email
        </span>
      </div>

      {step === "email" ? (
        <form onSubmit={onRequestCode} className="space-y-4">
          <p className="text-sm font-semibold text-foreground">
            {mode === "create" ? "New to AMS?" : "Already have an account?"}
          </p>
          <div>
            <Label htmlFor="signin-email">Email address</Label>
            <Input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          {remembered && email === remembered && (
            <button
              type="button"
              onClick={forgetEmail}
              className="self-end text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Forget this email
            </button>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            If this email already has an account, you will be signed in. If it is new, an account
            will be created after email verification.
          </p>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === "create" ? "Creating account…" : "Sending sign-in link…"}
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                {mode === "create" ? "Create account" : "Send me a sign-in link"}
              </>
            )}
          </Button>
        </form>
      ) : (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-5 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">{sentHeadline}</p>
            <p className="mt-1 text-sm text-muted-foreground">{sentBodyStart}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Open the link in your email to continue to AMS Product Advisor.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <div className="flex items-center justify-center gap-3">
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
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend sign-in link"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={backToEmail} disabled={loading}>
              Use a different email
            </Button>
          </div>
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Sign-in is restricted to authorised users. We record basic session activity (when you sign
        in/out and which articles you open) to keep the service secure and to improve it. We never
        sell or share your personal data.
      </p>
    </div>
  );
}