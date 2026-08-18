import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Loader2, ShieldCheck } from "lucide-react";
import { listAuditLog } from "@/lib/activity.functions";
import { listUsers } from "@/lib/admin.functions";
import { ALL_EVENT_TYPES, EVENT_TYPES } from "@/lib/activity.schemas";
import { CATEGORY_LABELS, EVENT_LABELS } from "@/components/activity/event-labels";
import { downloadCsv } from "@/lib/csv";

const ANY = "__any__";
const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last year" },
];

export function AuditLogTab() {
  const [days, setDays] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState(ANY);
  const [eventType, setEventType] = useState(ANY);
  const [complaint, setComplaint] = useState("");
  const [product, setProduct] = useState("");
  const [role, setRole] = useState(ANY);
  const [userId, setUserId] = useState(ANY);
  const [organization, setOrganization] = useState("");

  const logFn = useServerFn(listAuditLog);
  const usersFn = useServerFn(listUsers);
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => usersFn() });

  const filters = {
    days: Number(days),
    from: from || null,
    to: to || null,
    category: category === ANY ? null : category,
    event_type: eventType === ANY ? null : eventType,
    complaint_id: complaint || null,
    product_id: product || null,
    user_role: role === ANY ? null : role,
    user_id: userId === ANY ? null : userId,
    organization: organization || null,
    limit: 500,
  };

  const log = useQuery({
    queryKey: ["audit-log", filters],
    queryFn: () => logFn({ data: filters }),
  });

  const events = log.data?.events ?? [];
  const eventOptions =
    category === ANY
      ? ALL_EVENT_TYPES
      : ((EVENT_TYPES as Record<string, readonly string[]>)[category] ?? []);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Immutable operational audit records. No patient-identifiable information is stored — search
        entries hold a normalised complaint category only.
      </p>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-9">
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
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </div>
        <Select
          value={category}
          onValueChange={(v) => {
            setCategory(v);
            setEventType(ANY);
          }}
        >
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All categories</SelectItem>
            {Object.keys(CATEGORY_LABELS).map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={eventType} onValueChange={setEventType}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All events</SelectItem>
            {eventOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {EVENT_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Complaint"
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          className="h-9"
        />
        <Input
          placeholder="Product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className="h-9"
        />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="User role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All roles</SelectItem>
            {["guest", "registered", "medical_editor", "owner", "admin"].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All users</SelectItem>
            {(users.data?.users ?? []).map((u: any) => (
              <SelectItem key={u.id} value={u.id}>
                {u.email ?? u.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Organization"
          value={organization}
          onChange={(e) => setOrganization(e.target.value)}
          className="h-9"
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {log.isFetching ? "Loading…" : `${events.length} events`}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!events.length}
          onClick={() =>
            downloadCsv(
              "ams-audit-log.csv",
              events.map((e: any) => ({
                timestamp: e.created_at,
                event: e.event_type,
                category: e.category,
                user_id: e.user_id ?? "guest",
                user_role: e.user_role ?? "",
                session_id: e.session_id ?? "",
                complaint: e.complaint_id ?? "",
                product: e.product_id ?? "",
                report: e.report_id ?? "",
                reference: e.reference_id ?? "",
                organization: e.organization ?? "",
              })),
            )
          }
        >
          <Download className="mr-1 h-4 w-4" /> Export audit log (CSV)
        </Button>
      </div>

      <Card className="overflow-x-auto">
        {log.isLoading ? (
          <div className="p-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Complaint</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {events.map((e: any) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {EVENT_LABELS[e.event_type] ?? e.event_type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">{e.user_role ?? "guest"}</td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-xs">{e.complaint_id ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{e.product_id ?? "—"}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-xs">
                    {e.reference_id ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {(e.session_id ?? "").slice(0, 8) || "—"}
                  </td>
                </tr>
              ))}
              {!events.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No events match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
