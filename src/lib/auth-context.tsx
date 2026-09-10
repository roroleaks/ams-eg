import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  AUTH_RESTORE_TIMEOUT_MS,
  SIGN_OUT_TIMEOUT_MS,
  clearAuthTokens,
  delay,
  markLocalCleared,
  raceWithTimeout,
  redirectOnce,
  scheduleSessionCleanup,
} from "@/lib/sign-out";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "signing_out";

export interface AuthUser {
  id: string;
  email: string | null;
  name?: string;
  avatar?: string;
  metadata: Record<string, unknown>;
}

export interface AuthSessionInfo {
  user_id: string;
  email: string | null;
  expires_at: number | null;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Lightweight snapshot of the current auth session (never raw tokens). */
  session: AuthSessionInfo | null;
  /** True while the sign-out operation is in progress (`status === "signing_out"`). */
  signingOut: boolean;
  /** Increments on real sign-in events, never on restores/refreshes. */
  signInCount: number;
  /** Increments on real sign-out events. */
  signOutCount: number;
  /** True only when the initial session restore hit its bounded timeout. */
  restoreFailed: boolean;
  /**
   * The single shared, bounded sign-out operation. Re-entrant calls reuse the
   * in-flight operation, its cleanup never blocks it, and it always redirects
   * to `/auth?next=%2F` (or `to`).
   */
  signOut: (to?: string) => Promise<void>;
  /** Bounded refresh; used by recovery UI when the initial restore failed. */
  refreshSession: () => Promise<void>;
  /** Retries the initial session restoration. */
  retryRestore: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  session: null,
  signingOut: false,
  signInCount: 0,
  signOutCount: 0,
  restoreFailed: false,
  signOut: () => Promise.resolve(),
  refreshSession: () => Promise.resolve(),
  retryRestore: () => {},
});

function toAuthUser(u: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): AuthUser {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? null,
    name: (meta.full_name as string | undefined) ?? (meta.name as string | undefined),
    avatar:
      (meta.avatar_url as string | undefined) ?? (meta.picture as string | undefined),
    metadata: meta,
  };
}

/**
 * The single, centralized auth provider. Owns the only auth client state, the
 * only onAuthStateChange listener and cross-tab session sync, and exposes a
 * deterministic state machine: loading -> authenticated | unauthenticated,
 * with a dedicated signing_out state while sign-out runs.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<AuthSessionInfo | null>(null);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [signInCount, setSignInCount] = useState(0);
  const [signOutCount, setSignOutCount] = useState(0);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);
  const statusRef = useRef<AuthStatus>("loading");
  const restoringRef = useRef(false);
  const signOutInFlightRef = useRef<Promise<void> | null>(null);
  const signedOutByListenerRef = useRef(false);
  const localSignOutRef = useRef(false);
  const authGenerationRef = useRef(0);
  const restoreFnRef = useRef<() => void>(() => {});

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const applySession = (s: Session) => {
      if (cancelledRef.current) return;
      setSession({
        user_id: s.user.id,
        email: s.user.email ?? null,
        expires_at: s.expires_at ?? null,
      });
      setUser(toAuthUser(s.user as never));
      setStatus("authenticated");
    };

    const clearAuthState = () => {
      setUser(null);
      setSession(null);
      setStatus("unauthenticated");
    };

    // Bounded initial restoration, exactly once (re-runnable via retryRestore).
    const restore = async () => {
      if (restoringRef.current || cancelledRef.current) return;
      restoringRef.current = true;
      setRestoreFailed(false);
      const gen = authGenerationRef.current;

      // getSession reads the persisted session. With an expired stored token it
      // triggers a provider refresh, so it MUST be bounded: on timeouts the page
      // must never stay frozen on the loading screen.
      const result = await raceWithTimeout(
        supabase.auth.getSession(),
        AUTH_RESTORE_TIMEOUT_MS,
        null as never,
      );

      if (cancelledRef.current || gen !== authGenerationRef.current) {
        restoringRef.current = false;
        return;
      }

      // Provider did not answer in time: recover with an explicit retry instead
      // of leaving the app permanently in `loading`.
      if (result === null || result?.error) {
        // A session may already have been applied via an INITIAL_SESSION event
        // before the bounded call settled — never sign a restored user out.
        if (statusRef.current !== "authenticated") {
          setRestoreFailed(true);
          clearAuthState();
        }
        restoringRef.current = false;
        return;
      }

      const sess = result.data?.session ?? null;
      if (sess) {
        // A valid persisted session restores immediately; token expiry/refresh
        // is handled by the official client without blocking this page.
        applySession(sess);
      } else {
        clearAuthState();
      }
      restoringRef.current = false;
    };
    restoreFnRef.current = () => {
      void restore();
    };

    // Exactly one auth-state listener for the whole application.
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (cancelledRef.current) return;
      const gen = authGenerationRef.current;

      // While signing out, ignore any event that could flip us back to
      // authenticated (stale refresh / late restore from the outgoing session).
      if (statusRef.current === "signing_out") {
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
          return;
        }
      }

      if (event === "SIGNED_OUT") {
        // Only honor SIGNED_OUT for the current generation; the one emitted by
        // our own signOut() (post-generation bump) is finalized by signOut().
        if (gen !== authGenerationRef.current) return;
        if (localSignOutRef.current) {
          // This tab's own signOut() counts and clears in its finally block, so
          // the SIGNED_OUT it triggers must never count a second time.
          clearAuthState();
          return;
        }
        signedOutByListenerRef.current = true;
        setSignOutCount((c) => c + 1);
        clearAuthState();
        return;
      }

      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        event === "USER_UPDATED" ||
        event === "INITIAL_SESSION"
      ) {
        // A stale event from a previous generation must never re-authenticate.
        if (gen !== authGenerationRef.current) return;
        // Only genuine sign-ins increment the counter — never restores (the
        // first event on a refreshed page is INITIAL_SESSION, not SIGNED_IN).
        if (event === "SIGNED_IN") setSignInCount((c) => c + 1);
        if (sess) applySession(sess);
        else clearAuthState();
      }
    });

    void restore();

    const onStorage = (e: StorageEvent) => {
      if (!e.key || !e.key.startsWith("sb-")) return;
      const gen = authGenerationRef.current;
      void raceWithTimeout(
        supabase.auth.getSession().then(({ data }) => data.session),
        AUTH_RESTORE_TIMEOUT_MS,
        null as never,
      ).then((sess) => {
        if (gen !== authGenerationRef.current) return;
        if (statusRef.current === "signing_out") return;
        if (sess) applySession(sess);
        else clearAuthState();
      });
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelledRef.current = true;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /**
   * The single shared sign-out operation. All Sign out buttons call this through
   * the provider, repeated clicks reuse the in-flight operation, and nothing
   * outside the official provider call (bounded) is ever awaited.
   */
  const signOut = useCallback((to = "/auth?next=%2F"): Promise<void> => {
    if (signOutInFlightRef.current) return signOutInFlightRef.current;

    // Bump the generation so any in-flight restore/storage result from before
    // sign-out can never re-authenticate this session.
    authGenerationRef.current += 1;
    signOutInFlightRef.current = (async () => {
      setStatus("signing_out");
      signedOutByListenerRef.current = false;
      localSignOutRef.current = true;

      // Optional session-record cleanup: bounded and in the background. It can
      // never delay ending the authentication session.
      scheduleSessionCleanup();

      try {
        let timedOut = false;
        try {
          const outcome = await Promise.race([
            supabase.auth.signOut().then(() => "ok").catch(() => "ok"),
            delay(SIGN_OUT_TIMEOUT_MS).then(() => "timeout" as const),
          ]);
          if (outcome === "timeout") {
            // Provider did not answer in time: end the session on this device
            // locally so the app never stays in a signed-in state, and flag /auth
            // to show a safe "local session only" notice. Bump the generation so
            // any in-flight restore/storage result can never re-authenticate.
            timedOut = true;
            authGenerationRef.current += 1;
            clearAuthTokens();
            markLocalCleared();
          }
        } finally {
          // On the timeout path the provider may still fire a SIGNED_OUT later;
          // it must not count twice, so keep the local latch set for this tab.
          if (!timedOut) localSignOutRef.current = false;
        }
      } finally {
        if (!signedOutByListenerRef.current) setSignOutCount((c) => c + 1);
        setUser(null);
        setSession(null);
        setStatus("unauthenticated");
        redirectOnce(to === "/auth" ? "/auth" : "/auth?next=%2F");
      }
    })();
    return signOutInFlightRef.current;
  }, []);

  /** Bounded refresh, exposed for the session-restore recovery UI. */
  const refreshSession = useCallback(async () => {
    const result = await raceWithTimeout(
      supabase.auth.refreshSession(),
      AUTH_RESTORE_TIMEOUT_MS,
      null as never,
    );
    if (result === null || result?.error || !result?.data?.session) {
      setRestoreFailed(true);
      setUser(null);
      setSession(null);
      setStatus("unauthenticated");
      return;
    }
    setRestoreFailed(false);
    setSession({
      user_id: result.data.session.user.id,
      email: result.data.session.user.email ?? null,
      expires_at: result.data.session.expires_at ?? null,
    });
    setUser(toAuthUser(result.data.session.user as never));
    setStatus("authenticated");
  }, []);

  const retryRestore = useCallback(() => {
    setRestoreFailed(false);
    void restoreFnRef.current();
  }, []);

  const signingOut = status === "signing_out";

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        session,
        signingOut,
        signInCount,
        signOutCount,
        restoreFailed,
        signOut,
        refreshSession,
        retryRestore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}