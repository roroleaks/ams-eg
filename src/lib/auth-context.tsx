import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  SIGN_OUT_TIMEOUT_MS,
  clearAuthTokens,
  delay,
  redirectOnce,
  scheduleSessionCleanup,
} from "@/lib/sign-out";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthUser {
  id: string;
  email: string | null;
  name?: string;
  avatar?: string;
  metadata: Record<string, unknown>;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** True while a sign-out operation is in progress (UI shows "Signing out…"). */
  signingOut: boolean;
  /** Increments on real sign-in events, never on restores/refreshes. */
  signInCount: number;
  /** Increments on real sign-out events. */
  signOutCount: number;
  /**
   * The single shared sign-out operation. Bounded (5s provider timeout),
   * re-entrant calls reuse the in-flight operation, optional session cleanup
   * never blocks it, and it always redirects to `/auth?next=%2F` (or `to`).
   */
  signOut: (to?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  signingOut: false,
  signInCount: 0,
  signOutCount: 0,
  signOut: () => Promise.resolve(),
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
 * The single, centralized auth provider. Owns the only auth-state initialization,
 * the only onAuthStateChange listener and cross-tab session sync, and exposes
 * exactly three states: loading -> authenticated | unauthenticated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signInCount, setSignInCount] = useState(0);
  const [signOutCount, setSignOutCount] = useState(0);
  const startedRef = useRef(false);
  const signOutInFlightRef = useRef<Promise<void> | null>(null);
  const signedOutByListenerRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;

    const applyUser = (u: AuthUser | null) => {
      if (cancelled) return;
      setUser(u);
      setStatus(u ? "authenticated" : "unauthenticated");
    };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const sessUser = session?.user
        ? toAuthUser(session.user as {
            id: string;
            email?: string | null;
            user_metadata?: Record<string, unknown>;
          })
        : null;
      if (event === "SIGNED_IN") setSignInCount((c) => c + 1);
      if (event === "SIGNED_OUT") {
        signedOutByListenerRef.current = true;
        setSignOutCount((c) => c + 1);
      }
      if (
        event === "SIGNED_IN" ||
        event === "SIGNED_OUT" ||
        event === "USER_UPDATED" ||
        event === "INITIAL_SESSION" ||
        event === "TOKEN_REFRESHED"
      ) {
        applyUser(sessUser);
      }
    });

    (async () => {
      await supabase.auth.getSession();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) {
        const u = data.user
          ? toAuthUser(data.user as {
              id: string;
              email?: string | null;
              user_metadata?: Record<string, unknown>;
            })
          : null;
        setUser(u);
        setStatus(u ? "authenticated" : "unauthenticated");
      }
    })();

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("sb-") && e.key.endsWith("-auth-token")) {
        void supabase.auth.getSession().then(({ data: { session } }) => {
          applyUser(
            session?.user
              ? toAuthUser(session.user as {
                  id: string;
                  email?: string | null;
                  user_metadata?: Record<string, unknown>;
                })
              : null,
          );
        });
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  /**
   * The single shared sign-out operation. All Sign out buttons call this through
   * the provider so the header and the auth page can never run two independent
   * logout flows, and repeated clicks reuse the same in-flight operation.
   */
  const signOut = useCallback((to = "/auth?next=%2F"): Promise<void> => {
    if (signOutInFlightRef.current) return signOutInFlightRef.current;

    const run = (async () => {
      setSigningOut(true);
      signedOutByListenerRef.current = false;

      // Optional session-record cleanup: bounded and in the background. It can
      // never delay ending the authentication session.
      scheduleSessionCleanup();

      const race = Promise.race([
        supabase.auth.signOut().then(() => "ok" as const).catch(() => "ok" as const),
        delay(SIGN_OUT_TIMEOUT_MS).then(() => "timeout" as const),
      ]);
      try {
        const outcome = await race;
        if (outcome === "timeout") {
          // Provider did not answer in time: end the session on this device
          // locally so the app never stays in a signed-in state.
          clearAuthTokens();
        }
      } finally {
        if (!signedOutByListenerRef.current) setSignOutCount((c) => c + 1);
        setUser(null);
        setStatus("unauthenticated");
        setSigningOut(false);
        redirectOnce(to === "/auth" ? "/auth" : "/auth?next=%2F");
      }
    })();

    signOutInFlightRef.current = run;
    void run.finally(() => {
      signOutInFlightRef.current = null;
    });
    return run;
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, signingOut, signInCount, signOutCount, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}