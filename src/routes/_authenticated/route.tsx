import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { completeSignOut } from "@/lib/auth-actions";

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
    const { data, error } = await supabase.auth.getUser();
    const dest =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : "/";
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { next: dest !== "/auth" ? dest : "/" } });
    }
    return { user: data.user };
  },
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
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
        await completeSignOut();
        return;
      }
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, [user.id, navigate]);

  if (!ready) return <AuthLoading />;
  return <Outlet />;
}