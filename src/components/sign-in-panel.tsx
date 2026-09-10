import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, Mail } from "lucide-react";
import {
  AUTH_RESTORE_TIMEOUT_MS,
  CALLBACK_TIMEOUT_MS,
  delay,
  raceWithTimeout,
  SIGN_OUT_TIMEOUT_MS,
} from "@/lib/sign-out";

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
const KNOWN_EMAILS_KEY = "ams_known_emails";
const MAX_KNOWN_EMAILS = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Previously-used sign-in emails, most recent first (local-only library). */
function readKnownEmails(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KNOWN_EMAILS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is string => typeof e === "string" && EMAIL_RE.test(e.trim()))
      .slice(0, MAX_KNOWN_EMAILS);
  } catch {
    return [];
  }
}

function writeKnownEmails(list: string[]): void {
  try {
    if (list.length) localStorage.setItem(KNOWN_EMAILS_KEY, JSON.stringify(list));
    else localStorage.removeItem(KNOWN_EMAILS_KEY);
  } catch {
    /* ignore */
  }
}

/** Records a used email in the library (deduped, most recent first). */
function saveKnownEmail(value: string): string[] {
  const em = value.trim().toLowerCase();
  const list = [em, ...readKnownEmails().filter((e) => e !== em)].slice(0, MAX_KNOWN_EMAILS);
  writeKnownEmails(list);
  try {
    localStorage.setItem(LAST_EMAIL_KEY, em);
  } catch {
    /* ignore */
  }
  return list;
}

// Surface provider errors verbatim, but translate transport-level failures into
// a clear network message instead of leaking technical "fetch failed" text.
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
 * Email + password sign-in / sign-up panel. Used both as a full page
 * (route /auth) and inside the AuthGate modal.
 */
export function SignInPanel({
  next = "/",
  onSuccess,
  showClose = false,
  onClose,
  mode = "signin",
  onSwitchMode,
}: {
  /** Same-origin destination to resume to after auth (page mode). */
  next?: string;
  /** Called after successful auth so the caller can resume a pending action. */
  onSuccess?: () => void;
  /** Render a close/cancel control (modal mode). */
  showClose?: boolean;
  onClose?: () => void;
  /** "signin" = existing user; "create" = new account. */
  mode?: "signin" | "create";
  /** Lets the page-level caller (auth.tsx) own the mode toggle. */
  onSwitchMode?: (m: "signin" | "create") => void;
}) {
  const [step, setStep] = useState<"email" | "sent" | "reset">("email");
  const [email, setEmail] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem(LAST_EMAIL_KEY) ?? "" : ""),
  );
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [knownEmails, setKnownEmails] = useState<string[]>(() => readKnownEmails());
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

  // Reset form state whenever the parent flips between Sign In / Sign Up.
  useEffect(() => {
    setStep("email");
    setPassword("");
    setPasswordConfirm("");
    setFullName("");
    setError(null);
    setInfo(null);
  }, [mode]);

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
    let user: { id: string; email?: string | null } | null = null;
    try {
      const res = await raceWithTimeout(
        supabase.auth.getUser(),
        AUTH_RESTORE_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("We couldn't verify your account. Check your connection and try again.");
        return false;
      }
      user = res.data.user;
    } catch {
      setError("We couldn't verify your account. Check your connection and try again.");
      return false;
    }
    if (!user) {
      setError(
        "Your session could not be verified. Please check your credentials and try again.",
      );
      return false;
    }
    const profileQuery = supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    const profileRes = await raceWithTimeout(
      Promise.resolve(profileQuery),
      AUTH_RESTORE_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (profileRes !== "TIMEOUT") {
      const profile = profileRes.data;
      if (profile && profile.status !== "active") {
        void Promise.race([
          supabase.auth.signOut().catch(() => {}),
          delay(SIGN_OUT_TIMEOUT_MS),
        ]);
        setError("Your account is currently suspended. Contact your administrator for access.");
        return false;
      }
    }
    if (user.email) {
      const list = saveKnownEmail(user.email);
      setKnownEmails(list);
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

  /** Handles a `?code=` exchange parameter appended to the URL (bounded). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const err = params.get("error");
      if (err) {
        setError(
          decodeURIComponent(
            params.get("error_description") ?? "Sign in failed. Please try again.",
          ),
        );
        return;
      }
      if (code) {
        setLoading(true);
        const res = await raceWithTimeout(
          supabase.auth.exchangeCodeForSession(code),
          CALLBACK_TIMEOUT_MS,
          "TIMEOUT" as const,
        );
        if (!cancelled) {
          if (res === "TIMEOUT") {
            setError(
              "This sign-in link could not be completed. Check your connection and try again.",
            );
            setLoading(false);
          } else if (res.error) {
            setError(
              res.error.message ||
                "This sign-in link is invalid or has expired. Please try again.",
            );
            setLoading(false);
          } else {
            await finishAuthentication();
          }
        }
      }
    })().catch((error) => {
      if (!cancelled) setError(friendlyAuthError(error));
    });
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

  // ────────────────────────────────────────────────
  //  Sign-in with password
  // ────────────────────────────────────────────────
  async function onSubmitSignIn(e: React.FormEvent) {
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
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setEmail(normEmail);
    setLoading(true);
    try {
      const res = await raceWithTimeout(
        supabase.auth.signInWithPassword({ email: normEmail, password }),
        CALLBACK_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("Sign-in timed out. Check your connection and try again.");
        return;
      }
      if (res.error) {
        const msg = res.error.message || "";
        if (/email not confirmed/i.test(msg)) {
          setError(
            "Your email has not been verified yet. Please check your inbox for the verification link, or create a new account.",
          );
        } else if (/invalid login credentials|invalid_grant/i.test(msg)) {
          setError("Incorrect email or password. Please try again.");
        } else {
          setError(msg);
        }
        return;
      }
      saveKnownEmail(normEmail);
      await finishAuthentication();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  //  Create account
  // ────────────────────────────────────────────────
  async function onSubmitSignUp(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setInfo(null);
    const normEmail = email.trim().toLowerCase();
    const name = fullName.trim();
    if (!name) {
      setError("Please enter your name.");
      return;
    }
    if (!normEmail) {
      setError("Please enter your email address.");
      return;
    }
    if (!EMAIL_RE.test(normEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords do not match.");
      return;
    }
    setEmail(normEmail);
    setLoading(true);
    try {
      const res = await raceWithTimeout(
        supabase.auth.signUp({
          email: normEmail,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/auth/callback${
              next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
            }`,
          },
        }),
        CALLBACK_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("Sign-up timed out. Check your connection and try again.");
        return;
      }
      if (res.error) {
        const msg = res.error.message || "";
        if (/already (registered|exist|sign up)/i.test(msg)) {
          setError(
            "An account with this email already exists. Please sign in instead.",
          );
        } else {
          setError(msg);
        }
        return;
      }
      // If email confirmation is disabled the session is immediately available.
      if (res.data?.session) {
        saveKnownEmail(normEmail);
        await finishAuthentication();
        return;
      }
      // Email confirmation required — show success message.
      const list = saveKnownEmail(normEmail);
      setKnownEmails(list);
      setStep("sent");
      startResendCountdown();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  //  Forgot password (email reset)
  // ────────────────────────────────────────────────
  async function onSubmitReset(e: React.FormEvent) {
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
    setEmail(normEmail);
    setLoading(true);
    try {
      const res = await raceWithTimeout(
        supabase.auth.resetPasswordForEmail(normEmail, {
          redirectTo: `${window.location.origin}/auth`,
        }),
        CALLBACK_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("Timed out. Check your connection and try again.");
        return;
      }
      if (res.error) throw res.error;
      setStep("sent");
      startResendCountdown();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  //  Resend from the "sent" screen
  // ────────────────────────────────────────────────
  async function onResend() {
    if (loading || resendIn > 0) return;
    setError(null);
    setInfo(null);
    const normEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const res = await raceWithTimeout(
        supabase.auth.signInWithOtp({
          email: normEmail,
          options: {
            shouldCreateUser: mode === "create",
            emailRedirectTo: `${window.location.origin}/auth/callback${
              next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
            }`,
          },
        }),
        CALLBACK_TIMEOUT_MS,
        "TIMEOUT" as const,
      );
      if (res === "TIMEOUT") {
        setError("Could not resend. Check your connection and try again.");
        return;
      }
      if (res.error) throw res.error;
      startResendCountdown();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  // ────────────────────────────────────────────────
  //  Google OAuth
  // ────────────────────────────────────────────────
  async function onGoogle() {
    setError(null);
    setInfo(null);
    const result = await raceWithTimeout(
      lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}/auth${
          next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
        }`,
      }),
      CALLBACK_TIMEOUT_MS,
      "TIMEOUT" as const,
    );
    if (result === "TIMEOUT") {
      setError("Google sign-in is taking too long. Check your connection and try again.");
      return;
    }
    if (result.error) setError(result.error.message ?? "Google sign-in failed");
  }

  // ────────────────────────────────────────────────
  //  Saved-email helpers
  // ────────────────────────────────────────────────
  function forgetEmail() {
    const target = email.trim().toLowerCase();
    const remaining = knownEmails.filter((e) => e !== target);
    writeKnownEmails(remaining);
    setKnownEmails(remaining);
    try {
      localStorage.removeItem(LAST_EMAIL_KEY);
    } catch {
      /* ignore */
    }
    setEmail("");
  }

  function removeKnown(savedEmail: string) {
    const target = savedEmail.toLowerCase();
    setKnownEmails((prev) => {
      const remaining = prev.filter((e) => e !== target);
      writeKnownEmails(remaining);
      return remaining;
    });
    if (email.trim().toLowerCase() === target) {
      try {
        localStorage.removeItem(LAST_EMAIL_KEY);
      } catch {
        /* ignore */
      }
      setEmail("");
    }
  }

  function switchMode(m: "signin" | "create") {
    onSwitchMode?.(m);
    // Reset form state inline if parent doesn't own it (e.g. modal).
    if (!onSwitchMode) {
      setStep("email");
      setPassword("");
      setPasswordConfirm("");
      setFullName("");
      setError(null);
      setInfo(null);
    }
  }

  // ────────────────────────────────────────────────
  //  Render
  // ────────────────────────────────────────────────
  const isSignup = mode === "create";

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <img src="/ams-logo.png" alt="AMS" className="h-10 w-10" />
        <div>
          <h1 className="text-lg font-semibold">AMS Clinical Reference</h1>
          <p className="text-sm text-muted-foreground">
            {isSignup ? "Create your account" : "Sign in to your account"}
          </p>
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

      {/* Google */}
      <Button
        type="button"
        variant="outline"
        className="mt-6 w-full"
        onClick={onGoogle}
        disabled={loading}
      >
        Continue with Google
      </Button>
      <p className="mt-2 mb-4 text-[11px] leading-relaxed text-muted-foreground">
        Google sign-in shares only your name, email address and profile picture. We use it solely to
        personalise your experience and improve the app — your information is never shared with third
        parties and never used for marketing without your explicit consent.
      </p>

      <div className="relative my-4 text-center">
        <span className="bg-background px-2 text-xs uppercase tracking-wide text-muted-foreground">
          or continue with email
        </span>
      </div>

      {/* ── EMAIL STEP (varies by mode) ────────────────────── */}
      {step === "email" && mode === "signin" && (
        <form onSubmit={onSubmitSignIn} className="space-y-4">
          <div>
            <Label htmlFor="signin-email">Email</Label>
            {knownEmails.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recently used on this device
                </p>
                <div className="flex flex-wrap gap-2">
                  {knownEmails.map((savedEmail) => (
                    <span
                      key={savedEmail}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 py-1 pl-3 pr-1 text-xs"
                    >
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => {
                          setError(null);
                          setInfo(null);
                          setEmail(savedEmail);
                        }}
                      >
                        {savedEmail}
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${savedEmail} from saved emails`}
                        title="Remove this saved email"
                        className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        onClick={() => removeKnown(savedEmail)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
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

          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="signin-password">Password</Label>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setStep("reset");
                }}
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="signin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Your password"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => switchMode("create")}
            >
              Sign up
            </button>
          </p>
        </form>
      )}

      {step === "email" && mode === "create" && (
        <form onSubmit={onSubmitSignUp} className="space-y-4">
          <div>
            <Label htmlFor="signup-name">Full name</Label>
            <Input
              id="signup-name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Your name"
            />
          </div>

          <div>
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <Label htmlFor="signup-password">Password</Label>
            <Input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="At least 6 characters"
            />
            {password.length > 0 && password.length < 6 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {6 - password.length} more character{6 - password.length !== 1 ? "s" : ""} needed
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="signup-confirm">Confirm password</Label>
            <Input
              id="signup-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Re-enter your password"
            />
            {passwordConfirm.length > 0 && password !== passwordConfirm && (
              <p className="mt-1 text-[11px] text-destructive">Passwords do not match</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create account"
            )}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
          </p>
        </form>
      )}

      {/* ── FORGOT-PASSWORD STEP ──────────────────────────── */}
      {step === "reset" && (
        <form onSubmit={onSubmitReset} className="space-y-4">
          <p className="text-sm text-foreground">
            Enter your email address and we'll send you a link to reset your password.
          </p>
          <div>
            <Label htmlFor="reset-email">Email</Label>
            <Input
              id="reset-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setStep("email");
                setPassword("");
                setError(null);
                setInfo(null);
              }}
            >
              Back to sign in
            </button>
          </p>
        </form>
      )}

      {/* ── SENT / CHECK-YOUR-EMAIL SCREEN ────────────────── */}
      {step === "sent" && (
        <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-5 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <Mail className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Check your email</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "create"
                ? "We sent a verification link to your email address. Open it to activate your account."
                : "We sent a password reset link to your email address. Open it to set a new password."}
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
                onResend();
              }}
            >
              {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend email"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep("email");
                setPassword("");
                setError(null);
                setInfo(null);
              }}
              disabled={loading}
            >
              Use a different email
            </Button>
          </div>
        </div>
      )}

      {/* Privacy */}
      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Sign-in is restricted to authorised users. We record basic session activity (when you sign
        in/out and which articles you open) to keep the service secure and to improve it. We never
        sell or share your personal data.
      </p>
    </div>
  );
}