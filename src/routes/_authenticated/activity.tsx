import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Activity as ActivityIcon,
  Loader2,
  ShieldCheck,
  Star,
  Trash2,
  History,
} from "lucide-react";
import {
  listSearchHistory,
  deleteSearchHistory,
  listFavorites,
  toggleFavorite,
} from "@/lib/profile.functions";
import { listMyActivity, deleteMyActivity } from "@/lib/activity.functions";
import { EVENT_LABELS } from "@/components/activity/event-labels";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "My Activity — AMS Product Advisor" },
      {
        name: "description",
        content:
          "Review your AMS searches, saved complaints, favourite products and generated clinical reports, and clear them at any time.",
      },
      { property: "og:title", content: "My Activity — AMS Product Advisor" },
      {
        property: "og:description",
        content: "Your personal AMS usage activity, search history and favourites.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyActivity,
});

function MyActivity() {
  const qc = useQueryClient();
  const activityFn = useServerFn(listMyActivity);
  const delActivityFn = useServerFn(deleteMyActivity);
  const historyFn = useServerFn(listSearchHistory);
  const delHistoryFn = useServerFn(deleteSearchHistory);
  const favFn = useServerFn(listFavorites);
  const toggleFn = useServerFn(toggleFavorite);

  const activity = useQuery({ queryKey: ["my-activity"], queryFn: () => activityFn() });
  const history = useQuery({ queryKey: ["history"], queryFn: () => historyFn() });
  const favorites = useQuery({ queryKey: ["favorites"], queryFn: () => favFn() });

  const removeActivity = useMutation({
    mutationFn: (id?: string) => delActivityFn({ data: id ? { id } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-activity"] }),
  });
  const removeHistory = useMutation({
    mutationFn: (id?: string) => delHistoryFn({ data: id ? { id } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["history"] }),
  });
  const removeFav = useMutation({
    mutationFn: (v: { item_type: "product" | "complaint" | "report"; item_key: string }) =>
      toggleFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const s = activity.data?.summary;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/ams-wordmark.png" alt="America Medic & Science" className="h-8 w-auto" />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight">My Activity</h1>
              <p className="truncate text-xs text-muted-foreground">
                Your searches, favourites and reports
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm" className="rounded-full">
                Dashboard
              </Button>
            </Link>
            <Link to="/">
              <Button variant="outline" size="sm" className="rounded-full">
                <ArrowLeft className="mr-1 h-4 w-4" /> Search
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PrivacyNotice />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Searches" value={s?.searches ?? 0} />
          <Stat label="Products viewed" value={s?.products ?? 0} />
          <Stat label="Evidence opened" value={s?.evidence ?? 0} />
          <Stat label="Reports" value={s?.reports ?? 0} />
          <Stat label="Saved items" value={s?.saved ?? 0} />
          <Stat label="Exports" value={s?.exports ?? 0} />
        </div>

        {/* Search history */}
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-primary" /> Search history
            </h2>
            {!!history.data?.history.length && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeHistory.mutate(undefined)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Clear history
              </Button>
            )}
          </div>
          {history.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !history.data?.history.length ? (
            <p className="text-sm text-muted-foreground">No searches saved yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {history.data.history.map((h: any) => (
                <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/"
                      search={{ q: h.query }}
                      className="block truncate text-sm font-medium hover:text-primary hover:underline"
                    >
                      {h.query}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()} · {h.result_count} product
                      {h.result_count === 1 ? "" : "s"} ·{" "}
                      {h.products?.length ? `${h.products.length} viewed` : "0 viewed"} ·{" "}
                      {h.report_markdown ? "report generated" : "no report"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label="Delete history item"
                    onClick={() => removeHistory.mutate(h.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Favorites */}
        <Card className="p-4 sm:p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Star className="h-4 w-4 text-primary" /> My favourites
          </h2>
          {favorites.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !favorites.data?.favorites.length ? (
            <p className="text-sm text-muted-foreground">
              Star a product, complaint or report while searching to save it here.
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
                    <Link to="/" search={{ q: f.item_key }} className="hover:text-primary">
                      {f.label ?? f.item_key}
                    </Link>
                  ) : (
                    <span>{f.label ?? f.item_key}</span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove favourite"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      removeFav.mutate({ item_type: f.item_type, item_key: f.item_key })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Activity timeline */}
        <Card className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ActivityIcon className="h-4 w-4 text-primary" /> Recent activity
            </h2>
            {!!activity.data?.events.length && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => removeActivity.mutate(undefined)}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Clear my activity
              </Button>
            )}
          </div>
          {activity.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : !activity.data?.events.length ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {activity.data.events.map((e: any) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <Badge variant="outline" className="rounded-full text-[10px] capitalize">
                    {e.category}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">
                      {EVENT_LABELS[e.event_type] ?? e.event_type}
                    </span>
                    {(e.product_id || e.complaint_id) && (
                      <span className="text-muted-foreground"> · {e.product_id ?? e.complaint_id}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label="Delete activity entry"
                    disabled={e.category === "auth"}
                    title={
                      e.category === "auth"
                        ? "Sign-in records are kept for security"
                        : "Delete entry"
                    }
                    onClick={() => removeActivity.mutate(e.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Sign-in and sign-out records are kept for security and cannot be deleted here. To
            request anonymisation or deletion of your personal activity data, contact your AMS
            administrator.
          </p>
        </Card>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

export function PrivacyNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p className="text-muted-foreground">
        To improve system performance, evidence coverage and user experience, AMS records certain
        authenticated usage activity such as searches, product views, reports opened and saved
        items. Activity is used for system analytics and governance. Please do not enter
        patient-identifiable information into free-text searches.
      </p>
    </div>
  );
}
