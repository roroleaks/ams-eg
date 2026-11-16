import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

export const Route = createFileRoute("/api/public/cloud-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const url = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!url || !publishableKey) {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }

        const authHealth = await fetch(`${url}/auth/v1/health`, {
          headers: { apikey: publishableKey },
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);

        if (!authHealth?.ok) {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );
        const { error } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .limit(0);

        if (error) {
          return Response.json({ status: "unavailable" }, { status: 503 });
        }

        return Response.json({ status: "ok" });
      },
    },
  },
});