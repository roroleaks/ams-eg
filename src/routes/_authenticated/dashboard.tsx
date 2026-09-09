import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Star, Trash2, History, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyProfile,
  listSearchHistory,
  listFavorites,
  deleteSearchHistory,
  toggleFavorite,
} from "@/lib/profile.functions";
import { completeSignOut } from "@/lib/auth-actions";
import { useSessionTracker } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My Dashboard — AMS Product Advisor" },
      {
        name: "description",
        content:
          "Your saved AMS searches, favourite products and generated clinical reports in one place.",
      },
      { property: "og:title", content: "My Dashboard — AMS Product Advisor" },
      {
        property: "og:description",
        content: "Resume previous complaint searches and review your favourite AMS products.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileFn = useServerFn(getMyProfile);
  const historyFn = useServerFn(listSearchHistory);
  const favFn = useServerFn(listFavorites);
  const delFn = useServerFn(deleteSearchHistory);
  const toggleFn = useServerFn(toggleFavorite);

  const profile = useQuery({ queryKey: ["profile"], queryFn: () => profileFn() });
  const history = useQuery({ queryKey: ["history"], queryFn: () => historyFn() });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => favFn() });

  const removeHistory = useMutation({
    mutationFn: (id?: string) => delFn({ data: id ? { id } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });
  const removeFav = useMutation({
    mutationFn: (v: { item_type: "product" | "complaint" | "report"; item_key: string }) =>
      toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  useEffect(() => {
    document.title = "My Dashboard — AMS Product Advisor";
  }, []);

  useSessionTracker(true);

  const p = profile.data?.profile as any;

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await completeSignOut();
    navigate({ to: "/", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/ams-wordmark.png" alt="America Medic & Science" className="h-9 w-auto" />
            <div>
              <h1 className="text-lg font-semibold">My Dashboard</h1>
              <p className="text-xs text-muted-foreground">Saved searches, reports & favourites</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-1 h-4 w-4" /> Search
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="mr-1 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Card className="flex flex-wrap items-center gap-4 p-5">
          {p?.avatar_url ? (
            <img src={p.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-lg font-semibold">
              {(p?.full_name ?? p?.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-[180px] flex-1">
            <p className="font-semibold">{p?.full_name ?? "Registered user"}</p>
            <p className="text-sm text-muted-foreground">{p?.email}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Member since {p?.created_at ? new Date(p.created_at).toLocaleDateString() : "—"} ·
              Last login {p?.last_login_at ? new Date(p.last_login_at).toLocaleString() : "—"}
            </p>
          </div>
          <div className="flex gap-6 text-center">
            <div>
              <p className="text-2xl font-semibold">{p?.search_count ?? 0}</p>
              <p className="text-xs text-muted-foreground">Searches</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{p?.report_count ?? 0}</p>
              <p className="text-xs text-muted-foreground">Reports</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{favorites.data?.favorites.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Favourites</p>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Star className="h-4 w-4 text-primary" /> Favourites
            </h2>
          </div>
          {favorites.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !favorites.data?.favorites.length ? (
            <p className="text-sm text-muted-foreground">
              Star a product or complaint while searching to save it here.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {favorites.data.favorites.map((f: any) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs"
                >
                  <Badge variant="secondary" className="text-[10px]">
                    {f.item_type}
                  </Badge>
                  {f.item_type === "complaint" ? (
                    <Link to="/" search={{ q: f.item_key }} className="hover:underline">
                      {f.label ?? f.item_key}
                    </Link>
                  ) : (
                    <span>{f.label ?? f.item_key}</span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove favourite"
                    onClick={() =>
                      removeFav.mutate({ item_type: f.item_type, item_key: f.item_key })
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" /> Recent searches
            </h2>
            {!!history.data?.history.length && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeHistory.mutate(undefined)}
                className="h-7 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>
          {history.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !history.data?.history.length ? (
            <p className="text-sm text-muted-foreground">No saved searches yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.data.history.map((h: any) => (
                <li key={h.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      to="/"
                      search={{ q: h.query }}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {h.query}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()} · {h.result_count} product
                      {h.result_count === 1 ? "" : "s"}
                      {h.report_markdown ? " · report saved" : ""}
                    </p>
                    {!!h.products?.length && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.products.slice(0, 5).map((n: string) => (
                          <span
                            key={n}
                            className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label="Delete search"
                    onClick={() => removeHistory.mutate(h.id)}
                    className="mt-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
