import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";

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
  /** Increments on real sign-in events, never on restores/refreshes. */
  signInCount: number;
  /** Increments on real sign-out events. */
  signOutCount: number;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  signInCount: 0,
  signOutCount: 0,
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
  const [signInCount, setSignInCount] = useState(0);
  const [signOutCount, setSignOutCount] = useState(0);
  const startedRef = useRef(false);

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
      if (event === "SIGNED_OUT") setSignOutCount((c) => c + 1);
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

  return (
    <AuthContext.Provider value={{ status, user, signInCount, signOutCount }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}