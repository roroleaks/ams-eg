import { useCallback, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Library, Loader2, Play, Square, RefreshCw, Trash2 } from "lucide-react";
import { ALL_COMPLAINTS } from "@/data/complaints";
import { loadEmbeddings } from "@/lib/search";
import { loadComplaintEmbeddings, matchProducts } from "@/lib/complaint-match";
import { embedQuery } from "@/lib/embed.functions";
import { searchLiterature } from "@/lib/literature.functions";
import {
  acquireLibraryLock,
  buildLibraryEntry,
  clearLibrary,
  libraryStatus,
  releaseLibraryLock,
} from "@/lib/library.functions";

export function LibraryTab() {
  const statusFn = useServerFn(libraryStatus);
  const acquireFn = useServerFn(acquireLibraryLock);
  const releaseFn = useServerFn(releaseLibraryLock);
  const buildFn = useServerFn(buildLibraryEntry);
  const clearFn = useServerFn(clearLibrary);
  const embedFn = useServerFn(embedQuery);
  const litFn = useServerFn(searchLiterature);

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const status = useQuery({
    queryKey: ["library-status"],
    queryFn: () => statusFn({ data: undefined }),
    refetchOnWindowFocus: false,
  });

  const built = useMemo(
    () => new Set((status.data?.entries ?? []).filter((e) => e.status === "ok").map((e) => e.complaint)),
    [status.data],
  );

  const addLog = (line: string) => setLog((l) => [line, ...l].slice(0, 200));

  const run = useCallback(
    async (rebuildAll: boolean) => {
      const todo = rebuildAll ? ALL_COMPLAINTS : ALL_COMPLAINTS.filter((c) => !built.has(c));
      if (!todo.length) {
        addLog("Nothing to build — every complaint already has an entry.");
        return;
      }
      stopRef.current = false;
      setRunning(true);
      setDone(0);
      let token = "";
      try {
        await Promise.all([loadComplaintEmbeddings(), loadEmbeddings().catch(() => null)]);
        token = (await acquireFn({ data: { force: rebuildAll } })).token;

        for (const complaint of todo) {
          if (stopRef.current) {
            addLog("Stopped by user.");
            break;
          }
          setCurrent(complaint);
          try {
            let qVec: Float32Array | null = null;
            try {
              const { vec } = await embedFn({ data: { query: complaint } });
              qVec = new Float32Array(vec);
            } catch {
              qVec = null;
            }
            const matches = matchProducts(complaint, qVec);
            const literature = await litFn({ data: { query: complaint, yearsBack: 5, limit: 10 } })
              .then((r) => r.items)
              .catch(() => []);

            const res = await buildFn({
              data: {
                token,
                complaint,
                products: matches.map((m) => ({
                  name: m.product,
                  score: m.score,
                  matchedIndications: m.matchedIndications.slice(0, 30),
                  otherIndications: m.otherIndications.slice(0, 40),
                  passages: m.passages.slice(0, 8).map((p) => ({
                    product: p.product ?? null,
                    section: p.section ?? null,
                    page: p.page ?? null,
                    sourceName: p.sourceName ?? null,
                    text: p.text,
                  })),
                })),
                literature: literature.slice(0, 15).map((l) => ({
                  title: l.title,
                  authors: l.authors,
                  journal: l.journal,
                  year: l.year,
                  doi: l.doi,
                  pmid: l.pmid,
                  pmcid: l.pmcid,
                  pubType: l.pubType,
                })),
              },
            });
            if (res.halt) {
              addLog(`Halted: ${res.error}`);
              break;
            }
            addLog(
              res.ok
                ? `✓ ${complaint} — ${matches.length} product(s), ${literature.length} study(ies)`
                : `⚠ ${complaint} — evidence saved, report failed: ${res.error}`,
            );
          } catch (e) {
            addLog(`✗ ${complaint} — ${e instanceof Error ? e.message : "failed"}`);
          }
          setDone((d) => d + 1);
          // gentle pacing so the AI gateway rate limit is respected
          await new Promise((r) => setTimeout(r, 900));
        }
      } catch (e) {
        addLog(e instanceof Error ? e.message : "Build failed to start");
      } finally {
        if (token) await releaseFn({ data: { token } }).catch(() => {});
        setCurrent(null);
        setRunning(false);
        status.refetch();
      }
    },
    [acquireFn, buildFn, built, embedFn, litFn, releaseFn, status],
  );

  const entries = status.data?.entries ?? [];
  const total = ALL_COMPLAINTS.length;
  const pending = ALL_COMPLAINTS.filter((c) => !built.has(c)).length;

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Library className="h-5 w-5" /> Product library
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Runs every complaint through the matcher, collects the supporting evidence and recent
              studies, generates the clinical report, and stores it for instant lookup.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(false)} disabled={running || pending === 0}>
              {running ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Build library
            </Button>
            <Button variant="outline" onClick={() => run(true)} disabled={running}>
              <RefreshCw className="h-4 w-4 mr-1" /> Rebuild all
            </Button>
            {running && (
              <Button variant="outline" onClick={() => (stopRef.current = true)}>
                <Square className="h-4 w-4 mr-1" /> Stop
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={running || entries.length === 0}
              onClick={async () => {
                if (!confirm("Delete every stored library entry?")) return;
                await clearFn({ data: undefined });
                status.refetch();
              }}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Clear
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
          <Stat label="Complaints" value={total} />
          <Stat label="Stored" value={entries.length} />
          <Stat label="Not built yet" value={pending} />
          <Stat label="Failed" value={entries.filter((e) => e.status !== "ok").length} />
        </div>

        {running && (
          <div className="mt-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {current ? `Building “${current}”` : "Preparing…"} — {done} done
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      {log.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-2">Build log</h3>
          <div className="max-h-64 overflow-auto text-xs font-mono space-y-1 text-muted-foreground">
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Stored entries</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing stored yet.</p>
        ) : (
          <div className="divide-y">
            {entries.map((e) => (
              <div key={e.complaint} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium flex-1 min-w-[12rem]">{e.complaint}</span>
                <Badge variant="secondary">{e.product_count} products</Badge>
                <Badge variant="secondary">{e.evidence_count} passages</Badge>
                <Badge variant="secondary">{e.literature_count} studies</Badge>
                {e.status !== "ok" && <Badge variant="destructive">failed</Badge>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
