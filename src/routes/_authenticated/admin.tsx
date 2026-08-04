import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Upload,
  Trash2,
  RefreshCw,
  Download,
  Loader2,
  LogOut,
  ShieldCheck,
  ArrowLeft,
  FileText,
  Users as UsersIcon,
  Activity,
  BarChart3,
  UserCircle2,
} from "lucide-react";
import {
  listDocuments,
  createDocument,
  deleteDocument,
  replaceDocumentVersion,
  reindexDocument,
  listUsers,
  setUserRole,
  setUserPermissions,
  deleteUser,
  listIndexingLogs,
  listSearchAnalytics,
  exportUsageReport,
  isAdmin as isAdminFn,
  listRegisteredUsers,
  userAnalytics,
  exportRegisteredUsers,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — AMS" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const isAdminServer = useServerFn(isAdminFn);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    isAdminServer()
      .then((r) => {
        setAllowed(r.isAdmin);
        setReady(true);
      })
      .catch(() => {
        setAllowed(false);
        setReady(true);
      });
  }, [isAdminServer]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card className="p-8 max-w-md text-center">
          <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-lg font-semibold mb-2">Admin access required</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Your account doesn't have admin permissions.
          </p>
          <Link to="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to search
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/ams-logo.png" alt="AMS" className="h-8 w-8" />
            <div>
              <h1 className="text-lg font-semibold">Admin Dashboard</h1>
              <p className="text-xs text-muted-foreground">AMS Clinical Reference</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1" /> Search
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Tabs defaultValue="documents">
          <TabsList className="mb-6">
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 mr-1" /> Documents
            </TabsTrigger>
            <TabsTrigger value="users">
              <UsersIcon className="h-4 w-4 mr-1" /> Users
            </TabsTrigger>
            <TabsTrigger value="registered">
              <UserCircle2 className="h-4 w-4 mr-1" /> Registered users
            </TabsTrigger>
            <TabsTrigger value="logs">
              <Activity className="h-4 w-4 mr-1" /> Indexing logs
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="h-4 w-4 mr-1" /> Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <DocumentsTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="registered">
            <RegisteredUsersTab />
          </TabsContent>
          <TabsContent value="logs">
            <LogsTab />
          </TabsContent>
          <TabsContent value="analytics">
            <AnalyticsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ============ Documents Tab ============

function DocumentsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDocuments);
  const createFn = useServerFn(createDocument);
  const deleteFn = useServerFn(deleteDocument);
  const replaceFn = useServerFn(replaceDocumentVersion);
  const reindexFn = useServerFn(reindexDocument);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-docs"],
    queryFn: () => listFn(),
  });

  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadPdf(f: File, path: string): Promise<string> {
    const { error } = await supabase.storage.from("pdfs").upload(path, f, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !title.trim()) return;
    setError(null);
    setUploading(true);
    try {
      const path = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await uploadPdf(file, path);
      const { document: doc } = await createFn({
        data: { title: title.trim(), filename: file.name, storage_path: path },
      });
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
      setTitle("");
      setFile(null);
      // Auto reindex
      setBusyId(doc.id);
      await reindexFn({ data: { id: doc.id } });
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setBusyId(null);
    }
  }

  async function onReindex(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await reindexFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-index failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this PDF and its indexed content?")) return;
    setBusyId(id);
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onReplaceFile(id: string, f: File) {
    setBusyId(id);
    setError(null);
    try {
      const path = `${Date.now()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      await uploadPdf(f, path);
      await replaceFn({ data: { id, filename: f.name, storage_path: path } });
      await reindexFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["admin-docs"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replace failed");
    } finally {
      setBusyId(null);
      setReplaceTargetId(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="font-semibold mb-4">Upload PDF</h2>
        <form onSubmit={onUpload} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <Label htmlFor="title">Document title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. WFS Plus Monograph 2024"
              required
            />
          </div>
          <div>
            <Label htmlFor="file">PDF file</Label>
            <Input
              id="file"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
          <Button type="submit" disabled={uploading}>
            {uploading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-1" />
            )}
            Upload & index
          </Button>
        </form>
        {error && <p className="text-sm text-destructive mt-3">{error}</p>}
      </Card>

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Documents ({data?.documents.length ?? 0})</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Chunks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Indexed</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.documents.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground">{d.filename}</div>
                  </TableCell>
                  <TableCell>v{d.version}</TableCell>
                  <TableCell>{d.page_count ?? "—"}</TableCell>
                  <TableCell>{d.chunk_count}</TableCell>
                  <TableCell>
                    <StatusBadge status={d.status} message={d.status_message} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.indexed_at ? new Date(d.indexed_at).toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === d.id}
                        onClick={() => onReindex(d.id)}
                      >
                        {busyId === d.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReplaceTargetId(d.id);
                          replaceFileRef.current?.click();
                        }}
                      >
                        <Upload className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => onDelete(d.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.documents.length && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No documents yet. Upload one above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
      <input
        ref={replaceFileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && replaceTargetId) onReplaceFile(replaceTargetId, f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function StatusBadge({ status, message }: { status: string; message?: string }) {
  const map: Record<string, string> = {
    indexed: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
    processing: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    pending: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
    failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  };
  return (
    <div>
      <Badge variant="outline" className={map[status] ?? ""}>
        {status}
      </Badge>
      {status === "failed" && message && (
        <div className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={message}>
          {message}
        </div>
      )}
    </div>
  );
}

// ============ Users Tab ============

function UsersTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsers);
  const roleFn = useServerFn(setUserRole);
  const permsFn = useServerFn(setUserPermissions);
  const delFn = useServerFn(deleteUser);
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });
  const [editingUser, setEditingUser] = useState<any | null>(null);

  async function toggleAdmin(u: any) {
    const isAdmin = u.roles.includes("admin");
    await roleFn({ data: { user_id: u.id, role: "admin", grant: !isAdmin } });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function onDelete(u: any) {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    await delFn({ data: { user_id: u.id } });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <Card>
      <div className="p-4 border-b">
        <h2 className="font-semibold">Users ({data?.users.length ?? 0})</h2>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading…</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Confirmed</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.users.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>
                  {u.confirmed ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-700">
                      Yes
                    </Badge>
                  ) : (
                    <Badge variant="outline">No</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={u.roles.includes("admin")}
                      onCheckedChange={() => toggleAdmin(u)}
                    />
                    <span className="text-xs">
                      {u.roles.includes("admin") ? "admin" : "user"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {u.permissions ? (
                    <div className="space-x-1">
                      {u.permissions.can_search && (
                        <Badge variant="secondary" className="text-[10px]">
                          search
                        </Badge>
                      )}
                      {u.permissions.can_summarize && (
                        <Badge variant="secondary" className="text-[10px]">
                          summary
                        </Badge>
                      )}
                      {u.permissions.can_download && (
                        <Badge variant="secondary" className="text-[10px]">
                          download
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">default</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditingUser(u)}>
                      Permissions
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => onDelete(u)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PermissionsDialog
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSave={async (perms) => {
          await permsFn({
            data: {
              user_id: editingUser.id,
              can_search: perms.can_search,
              can_summarize: perms.can_summarize,
              can_download: perms.can_download,
              notes: perms.notes,
            },
          });
          qc.invalidateQueries({ queryKey: ["admin-users"] });
          setEditingUser(null);
        }}
      />
    </Card>
  );
}

function PermissionsDialog({
  user,
  onClose,
  onSave,
}: {
  user: any | null;
  onClose: () => void;
  onSave: (p: {
    can_search: boolean;
    can_summarize: boolean;
    can_download: boolean;
    notes: string;
  }) => Promise<void>;
}) {
  const [can_search, setSearch] = useState(true);
  const [can_summarize, setSummarize] = useState(true);
  const [can_download, setDownload] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) {
      const p = user.permissions;
      setSearch(p?.can_search ?? true);
      setSummarize(p?.can_summarize ?? true);
      setDownload(p?.can_download ?? true);
      setNotes(p?.notes ?? "");
    }
  }, [user]);

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permissions — {user?.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <PermRow label="Can search" checked={can_search} onChange={setSearch} />
          <PermRow label="Can generate summaries" checked={can_summarize} onChange={setSummarize} />
          <PermRow label="Can download PDFs" checked={can_download} onChange={setDownload} />
          <div>
            <Label>Notes</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ can_search, can_summarize, can_download, notes });
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// ============ Logs Tab ============

function LogsTab() {
  const listFn = useServerFn(listIndexingLogs);
  const { data, isLoading } = useQuery({ queryKey: ["admin-logs"], queryFn: () => listFn() });
  return (
    <Card>
      <div className="p-4 border-b">
        <h2 className="font-semibold">Indexing logs</h2>
      </div>
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading…</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.logs.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(l.created_at).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{l.action}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      l.status === "success"
                        ? "bg-green-500/10 text-green-700"
                        : "bg-red-500/10 text-red-700"
                    }
                  >
                    {l.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{l.message ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {l.duration_ms ? `${(l.duration_ms / 1000).toFixed(1)}s` : "—"}
                </TableCell>
              </TableRow>
            ))}
            {!data?.logs.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  No logs yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

// ============ Analytics Tab ============

function AnalyticsTab() {
  const listFn = useServerFn(listSearchAnalytics);
  const exportFn = useServerFn(exportUsageReport);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: () => listFn(),
  });
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      const { csv, filename } = await exportFn();
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total searches (recent)" value={data?.total ?? 0} />
        <StatCard label="Zero-result queries" value={data?.zero ?? 0} />
        <StatCard
          label="Zero-result rate"
          value={data?.total ? `${Math.round((data.zero / data.total) * 100)}%` : "—"}
        />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={onExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-1" />
          )}
          Export usage report (CSV)
        </Button>
      </div>

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Top queries</h2>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Query</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.top.map((t: any) => (
                <TableRow key={t.query}>
                  <TableCell>{t.query}</TableCell>
                  <TableCell className="text-right">{t.count}</TableCell>
                </TableRow>
              ))}
              {!data?.top.length && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                    No searches yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="p-4 border-b">
          <h2 className="font-semibold">Recent searches</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Query</TableHead>
              <TableHead>Results</TableHead>
              <TableHead>Mode</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.rows.slice(0, 50).map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(r.created_at).toLocaleString()}
                </TableCell>
                <TableCell>{r.query}</TableCell>
                <TableCell>{r.result_count}</TableCell>
                <TableCell className="text-xs">{r.mode ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
    </Card>
  );
}


// ============ Registered Users Tab ============

function RegisteredUsersTab() {
  const listFn = useServerFn(listRegisteredUsers);
  const statsFn = useServerFn(userAnalytics);
  const exportFn = useServerFn(exportRegisteredUsers);

  const { data, isLoading } = useQuery({
    queryKey: ["registered-users"],
    queryFn: () => listFn(),
  });
  const stats = useQuery({ queryKey: ["user-analytics"], queryFn: () => statsFn() });

  async function download() {
    const { csv, filename } = await exportFn();
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total guests" value={s?.totalGuests ?? "—"} />
        <Stat label="Registered users" value={s?.totalRegistered ?? "—"} />
        <Stat label="New today" value={s?.newToday ?? "—"} />
        <Stat label="Daily active" value={s?.dau ?? "—"} />
        <Stat label="Monthly active" value={s?.mau ?? "—"} />
        <Stat label="Total searches" value={s?.totalSearches ?? "—"} />
        <Stat label="Avg searches / user" value={s?.avgSearchesPerUser ?? "—"} />
        <Stat label="Reports generated" value={s?.totalReports ?? "—"} />
        <Stat label="Avg reports / user" value={s?.avgReportsPerUser ?? "—"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Most searched complaints</h3>
          {!s?.topComplaints?.length ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.topComplaints.map((c) => (
                <li key={c.query} className="flex justify-between gap-3">
                  <span className="truncate">{c.query}</span>
                  <span className="text-muted-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Most recommended products</h3>
          {!s?.topProducts?.length ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.topProducts.map((c) => (
                <li key={c.product} className="flex justify-between gap-3">
                  <span className="truncate">{c.product}</span>
                  <span className="text-muted-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Registered users</h3>
          <Button variant="outline" size="sm" onClick={download}>
            <Download className="mr-1 h-4 w-4" /> Export registered users
          </Button>
        </div>
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : !data?.users.length ? (
          <p className="text-sm text-muted-foreground">No registered users yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Searches</TableHead>
                  <TableHead>Reports</TableHead>
                  <TableHead>Favourites</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs">
                            {(u.full_name ?? u.email ?? "?").slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm">{u.full_name ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{u.email ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell>{u.search_count}</TableCell>
                    <TableCell>{u.report_count}</TableCell>
                    <TableCell className="max-w-[220px] text-xs">
                      {u.favorites.length ? u.favorites.join(", ") : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.roles.includes("admin") ? "default" : "secondary"}>
                        {u.roles.includes("admin") ? "Admin" : u.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
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
