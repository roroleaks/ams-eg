import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { AUTH_RESTORE_TIMEOUT_MS, raceWithTimeout } from "@/lib/sign-out";

type SessionOutcome = Awaited<ReturnType<typeof supabase.auth.getSession>>;
type UserOutcome = Awaited<ReturnType<typeof supabase.auth.getUser>>;

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b3d2e]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        <p className="text-sm font-medium text-white/80">Checking your session…</p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Bounded session check so a stalled provider can never leave a protected
    // route frozen on the loading screen — it degrades to the auth page.
    const dest =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    const toAuth = (): never => {
      throw redirect({ to: "/auth", search: { next: dest !== "/auth" ? dest : "/" } });
    };

    const res = await raceWithTimeout<SessionOutcome, "TIMEOUT">(
      supabase.auth.getSession(),
      AUTH_RESTORE_TIMEOUT_MS,
      "TIMEOUT",
    );
    if (res === "TIMEOUT") toAuth();
    const sessionOutcome = res as SessionOutcome;
    if (sessionOutcome.error || !sessionOutcome.data.session) toAuth();

    const userRes = await raceWithTimeout<UserOutcome, "TIMEOUT">(
      supabase.auth.getUser(),
      AUTH_RESTORE_TIMEOUT_MS,
      "TIMEOUT",
    );
    if (userRes === "TIMEOUT") toAuth();
    const userOutcome = userRes as UserOutcome;
    if (userOutcome.error || !userOutcome.data.user) toAuth();
    return { user: userOutcome.data.user! };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  const { signOut } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", user.id)
        .maybeSingle();
      if (!mounted) return;
      // A failed read (e.g. profiles.status does not exist because the schema
      // migration is still pending) must not nuke a valid session.
      if (error) {
        setReady(true);
        return;
      }
      // Only an explicit suspension/deletion blocks access; a missing benign
      // profile row is not a reason to log the user out.
      if (profile && (profile.status === "suspended" || profile.status === "deleted")) {
        void signOut();
        return;
      }
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, [user.id, signOut]);

  if (!ready) return <AuthLoading />;
  return <Outlet />;
}