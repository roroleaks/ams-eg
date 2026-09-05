import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2, ShieldCheck, Trash2, TrendingUp, Users } from "lucide-react";
import {
  activityDashboard,
  getRetention,
  setRetention,
  purgeActivity,
  userActivityProfile,
} from "@/lib/activity.functions";
import { listUsers } from "@/lib/admin.functions";
import { downloadCsv } from "@/lib/csv";
import { EVENT_LABELS } from "@/components/activity/event-labels";
import { RETENTION_OPTIONS } from "@/lib/activity.schemas";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export function ActivityAnalyticsTab() {
  const qc = useQueryClient();
  const [days, setDays] = useState("30");
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const dashFn = useServerFn(activityDashboard);
  const retFn = useServerFn(getRetention);
  const setRetFn = useServerFn(setRetention);
  const purgeFn = useServerFn(purgeActivity);
  const profileFn = useServerFn(userActivityProfile);
  const usersFn = useServerFn(listUsers);

  const dash = useQuery({
    queryKey: ["activity-dashboard", days],
    queryFn: () => dashFn({ data: { days: Number(days) } }),
  });
  const retention = useQuery({ queryKey: ["activity-retention"], queryFn: () => retFn() });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => usersFn() });
  const profile = useQuery({
    queryKey: ["activity-user-profile", selectedUser],
    queryFn: () => profileFn({ data: { user_id: selectedUser! } }),
    enabled: !!selectedUser,
  });

  const saveRetention = useMutation({
    mutationFn: (d: number) => setRetFn({ data: { days: d } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity-retention"] }),
  });
  const purge = useMutation({
    mutationFn: () => purgeFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["activity-dashboard"] }),
  });

  const d = dash.data;

  function exportSummary() {
    if (!d) return;
    const rows = [
      ...d.topComplaints.map((r) => ({ report: "Complaint searches", item: r.label, count: r.count })),
      ...d.topProductsOpened.map((r) => ({ report: "Product views", item: r.label, count: r.count })),
      ...d.topProductsFavorited.map((r) => ({ report: "Product favourites", item: r.label, count: r.count })),
      ...d.noResult.map((r) => ({ report: "No-result searches", item: r.label, count: r.count })),
      { report: "Evidence engagement", item: "Evidence reports opened", count: d.evidence.evidenceReports },
      { report: "Evidence engagement", item: "Scientific references opened", count: d.evidence.references },
      { report: "Evidence engagement", item: "Monographs opened", count: d.evidence.monographs },
    ];
    downloadCsv(`ams-usage-analytics-${days}d.csv`, rows);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dash.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <Button variant="outline" size="sm" onClick={exportSummary} disabled={!d}>
          <Download className="mr-1 h-4 w-4" /> Export analytics (CSV)
        </Button>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Aggregated operational usage data. Exported files contain usage information only — no
        patient data — and should be handled securely.
      </p>

      {!d ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Registered users" value={d.totals.totalUsers} />
            <Stat label="Active users (30d)" value={d.totals.activeUsers} />
            <Stat label="Searches today" value={d.totals.searchesToday} />
            <Stat label="Searches this week" value={d.totals.searchesWeek} />
            <Stat label="Searches this month" value={d.totals.searchesMonth} />
            <Stat label="Reports generated (selected range)" value={d.totals.reports} />
            <Stat label="Unique products viewed (selected range)" value={d.totals.productsViewed} />
            <Stat label="Evidence opened (selected range)" value={d.totals.evidenceOpened} />
            <Stat label="Favourites (selected range)" value={d.totals.favorites} />
            <Stat label="Exports (selected range)" value={d.totals.exports} />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="h-4 w-4 text-primary" /> Product search &amp; engagement trends
            </h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.trend}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="searches" stroke="hsl(var(--primary))" dot={false} />
                  <Line type="monotone" dataKey="views" stroke="#0ea5e9" dot={false} />
                  <Line type="monotone" dataKey="reports" stroke="#10b981" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Most searched complaints" data={d.topComplaints} />
            <ChartCard title="Most viewed products" data={d.topProductsOpened} />
            <ChartCard title="Products matched by search" data={d.topProductsMatched} />
            <ChartCard title="Most favourited products" data={d.topProductsFavorited} />
          </div>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Evidence engagement</h3>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Evidence reports opened" value={d.evidence.evidenceReports} />
              <Stat label="References opened" value={d.evidence.references} />
              <Stat label="Monographs opened" value={d.evidence.monographs} />
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Searches with no useful match</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              {d.noResultTotal} searches returned no product. These highlight missing complaints,
              synonyms, products or evidence.
            </p>
            {d.noResult.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unmatched searches in this period.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.noResult.map((r) => (
                  <Badge key={r.label} variant="secondary" className="rounded-full">
                    {r.label} — {r.count}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          {/* User activity profile */}
          <Card className="p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Users className="h-4 w-4 text-primary" /> User activity profile
            </h3>
            <Select value={selectedUser ?? ""} onValueChange={(v) => setSelectedUser(v)}>
              <SelectTrigger className="h-9 w-full max-w-sm">
                <SelectValue placeholder="Select a registered user" />
              </SelectTrigger>
              <SelectContent>
                {(users.data?.users ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.email ?? u.full_name ?? u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedUser && profile.data?.profile && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-semibold">{profile.data.profile.full_name ?? "—"}</span>
                  <span className="text-muted-foreground">{profile.data.profile.email}</span>
                  {profile.data.roles.map((r: string) => (
                    <Badge key={r} variant="outline" className="rounded-full text-[10px]">
                      {r}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Registered{" "}
                  {profile.data.profile.created_at
                    ? new Date(profile.data.profile.created_at).toLocaleDateString()
                    : "—"}{" "}
                  · Last login{" "}
                  {profile.data.profile.last_login_at
                    ? new Date(profile.data.profile.last_login_at).toLocaleString()
                    : "—"}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Searches" value={profile.data.stats.searches} />
                  <Stat label="Reports" value={profile.data.stats.reports} />
                  <Stat label="Unique products viewed" value={profile.data.stats.productsViewed} />
                  <Stat label="Favourites" value={profile.data.stats.favorites} />
                </div>
                <ul className="max-h-64 divide-y divide-border/70 overflow-auto text-sm">
                  {profile.data.recent.map((e: any) => (
                    <li key={e.id} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate">
                        {EVENT_LABELS[e.event_type] ?? e.event_type}
                        {(e.product_id || e.complaint_id) && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {e.product_id ?? e.complaint_id}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv(
                      `ams-user-activity-${selectedUser}.csv`,
                      profile.data!.recent.map((e: any) => ({
                        timestamp: e.created_at,
                        event: e.event_type,
                        category: e.category,
                        complaint: e.complaint_id ?? "",
                        product: e.product_id ?? "",
                      })),
                    )
                  }
                >
                  <Download className="mr-1 h-4 w-4" /> Export user activity
                </Button>
              </div>
            )}
          </Card>

          {/* Retention */}
          <Card className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Activity log retention</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Ordinary activity records older than the retention period can be removed. Sign-in and
              other security/audit records are never deleted by this routine, and are not affected
              when a user clears their own history.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={String(retention.data?.days ?? 90)}
                onValueChange={(v) => saveRetention.mutate(Number(v))}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((o) => (
                    <SelectItem key={o} value={String(o)}>
                      {o === 365 ? "1 year" : `${o} days`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => purge.mutate()}
                disabled={purge.isPending}
              >
                {purge.isPending ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-4 w-4" />
                )}
                Apply retention now
              </Button>
              {purge.data && (
                <span className="text-xs text-muted-foreground">
                  Removed {purge.data.removed} records older than {purge.data.days} days.
                </span>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function ChartCard({ title, data }: { title: string; data: { label: string; count: number }[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No data for this period.</p>
      ) : (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
