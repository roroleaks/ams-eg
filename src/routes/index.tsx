import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  FileText,
  BookOpen,
  Sparkles,
  Wand2,
  Loader2,
  X,
  ShieldCheck,
  LogIn,
  LogOut,
  Stethoscope,
  ChevronDown,
  Printer,
  Star,
  LayoutDashboard,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadEmbeddings } from "@/lib/search";
import { matchProducts, loadComplaintEmbeddings, type ProductMatch } from "@/lib/complaint-match";
import { embedQuery } from "@/lib/embed.functions";
import { summarizeProductReport } from "@/lib/product-report.functions";
import { searchLiterature, type LiteratureItem } from "@/lib/literature.functions";
import { logSearch, recordGuestEvent } from "@/lib/analytics.functions";
import {
  touchProfile,
  saveSearchHistory,
  attachReportToHistory,
  toggleFavorite,
  listFavorites,
} from "@/lib/profile.functions";
import { WelcomeBanner } from "@/components/WelcomeBanner";
import { getAnonId } from "@/lib/guest";
import { isAdmin as isAdminFn } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { getProductImage } from "@/data/product-images";

const COMPLAINTS: string[] = [
  "Low AMH",
  "Poor ovarian reserve",
  "PCOS",
  "Insulin resistance",
  "Irregular menstrual cycle",
  "Heavy menstrual bleeding",
  "Endometriosis",
  "Dysmenorrhea",
  "Uterine fibroid",
  "Pelvic pain",
  "Recurrent miscarriage",
  "Advanced maternal age",
  "Egg freezing",
  "Preterm labor",
  "Breast pain",
  "Fibrocystic breast changes",
  "Male infertility",
  "Low sperm count",
  "Poor sperm motility",
  "High DNA fragmentation",
  "Erectile dysfunction",
  "Recurrent UTI",
];

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>) => ({
    q: typeof s.q === "string" ? s.q : "",
  }),
  head: () => ({
    meta: [
      { title: "AMS Product Advisor — Complaint-Based Clinical Decision Support" },
      {
        name: "description",
        content:
          "Enter a patient complaint and get matched America Medic & Science products with official indications, indexed guideline evidence and recent peer-reviewed literature.",
      },
      { property: "og:title", content: "AMS Product Advisor — Clinical Decision Support" },
      {
        property: "og:description",
        content:
          "Complaint-driven product recommendations for clinicians, backed by indexed monographs and recent peer-reviewed evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { q: initialQuery } = Route.useSearch();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [qVec, setQVec] = useState<Float32Array | null>(null);
  const [ready, setReady] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const embedFn = useServerFn(embedQuery);
  const reportFn = useServerFn(summarizeProductReport);
  const literatureFn = useServerFn(searchLiterature);
  const logFn = useServerFn(logSearch);
  const isAdminServer = useServerFn(isAdminFn);
  const guestEventFn = useServerFn(recordGuestEvent);
  const touchProfileFn = useServerFn(touchProfile);
  const saveHistoryFn = useServerFn(saveSearchHistory);
  const attachReportFn = useServerFn(attachReportToHistory);
  const toggleFavoriteFn = useServerFn(toggleFavorite);
  const listFavoritesFn = useServerFn(listFavorites);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const historyIdRef = useRef<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [literature, setLiterature] = useState<LiteratureItem[]>([]);
  const [litLoading, setLitLoading] = useState(false);
  const [useLiterature, setUseLiterature] = useState(true);
  const [session, setSession] = useState<{
    email?: string;
    name?: string;
    avatar?: string;
  } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const seqRef = useRef(0);
  const lastLoggedRef = useRef<string>("");

  useEffect(() => {
    const apply = (user: { email?: string | null; user_metadata?: Record<string, any> } | null) => {
      if (!user) {
        setSession(null);
        setIsAdmin(false);
        setFavorites(new Set());
        return;
      }
      const meta = user.user_metadata ?? {};
      setSession({
        email: user.email ?? undefined,
        name: meta.full_name ?? meta.name,
        avatar: meta.avatar_url ?? meta.picture,
      });
      isAdminServer().then((r) => setIsAdmin(r.isAdmin)).catch(() => setIsAdmin(false));
      touchProfileFn().catch(() => {});
      listFavoritesFn()
        .then(({ favorites: f }) =>
          setFavorites(new Set(f.map((x: any) => `${x.item_type}:${x.item_key}`))),
        )
        .catch(() => {});
    };
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) apply(data.user as any);
      else guestEventFn({ data: { anon_id: getAnonId(), event: "visit" } }).catch(() => {});
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        apply((s?.user as any) ?? null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [isAdminServer, touchProfileFn, listFavoritesFn, guestEventFn]);

  // Preload both embedding matrices
  useEffect(() => {
    Promise.all([loadComplaintEmbeddings(), loadEmbeddings().catch(() => null)])
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, []);

  // Debounced query embedding
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setQVec(null);
      return;
    }
    const mySeq = ++seqRef.current;
    setEmbedding(true);
    const handle = setTimeout(async () => {
      try {
        const { vec } = await embedFn({ data: { query: q } });
        if (mySeq === seqRef.current) setQVec(new Float32Array(vec));
      } catch {
        if (mySeq === seqRef.current) setQVec(null);
      } finally {
        if (mySeq === seqRef.current) setEmbedding(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, embedFn]);

  const matches: ProductMatch[] = useMemo(() => {
    if (!query.trim()) return [];
    return matchProducts(query, ready ? qVec : null);
  }, [query, qVec, ready]);

  // Reset report on new complaint
  useEffect(() => {
    setReport(null);
    setReportError(null);
  }, [query]);

  // Fetch recent literature for the complaint (cached server-side)
  useEffect(() => {
    const q = query.trim();
    if (!q || !useLiterature || matches.length === 0) {
      setLiterature([]);
      return;
    }
    let cancelled = false;
    setLitLoading(true);
    const handle = setTimeout(() => {
      literatureFn({ data: { query: q, yearsBack: 5, limit: 12 } })
        .then(({ items }) => {
          if (!cancelled) setLiterature(items);
        })
        .catch(() => {
          if (!cancelled) setLiterature([]);
        })
        .finally(() => {
          if (!cancelled) setLitLoading(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, useLiterature, matches.length, literatureFn]);

  // Analytics (guests included) + persistent history for registered users
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) return;
    const handle = setTimeout(() => {
      const key = `${q}|${matches.length}`;
      if (lastLoggedRef.current === key) return;
      lastLoggedRef.current = key;
      logFn({
        data: {
          query: q,
          result_count: matches.length,
          mode: qVec ? "hybrid" : "keyword",
          anon_id: session ? undefined : getAnonId(),
        },
      }).catch(() => {});
      if (session) {
        saveHistoryFn({
          data: {
            query: q,
            products: matches.map((m) => m.product),
            result_count: matches.length,
          },
        })
          .then(({ id }) => {
            historyIdRef.current = id;
          })
          .catch(() => {});
      } else {
        historyIdRef.current = null;
      }
    }, 1200);
    return () => clearTimeout(handle);
  }, [query, matches, qVec, logFn, session, saveHistoryFn]);

  async function onToggleFavorite(
    item_type: "product" | "complaint",
    item_key: string,
    label?: string,
  ) {
    if (!session) return;
    const k = `${item_type}:${item_key}`;
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    try {
      await toggleFavoriteFn({ data: { item_type, item_key, label: label ?? item_key } });
    } catch {
      /* optimistic UI is close enough */
    }
  }

  async function handleReport() {
    if (reporting || !matches.length) return;
    setReporting(true);
    setReportError(null);
    try {
      let lit = literature;
      if (useLiterature && lit.length === 0) {
        try {
          const { items } = await literatureFn({ data: { query, yearsBack: 5, limit: 10 } });
          lit = items;
          setLiterature(items);
        } catch {
          lit = [];
        }
      }
      const { markdown } = await reportFn({
        data: {
          complaint: query.trim(),
          products: matches.slice(0, 6).map((m) => ({
            name: m.product,
            matchedIndications: m.matchedIndications,
            otherIndications: m.otherIndications,
            passages: m.passages.slice(0, 6).map((p) => ({
              section: p.section,
              page: p.page,
              sourceName: p.sourceName ?? null,
              text: p.text.slice(0, 800),
            })),
          })),
          literature: (useLiterature ? lit : []).slice(0, 10).map((l) => ({
            title: l.title,
            authors: l.authors,
            journal: l.journal,
            year: l.year,
            doi: l.doi,
            pmid: l.pmid,
            pmcid: l.pmcid ?? null,
            pubType: l.pubType,
          })),
        },
      });
      setReport(markdown);
      if (session && historyIdRef.current) {
        attachReportFn({
          data: { id: historyIdRef.current, report_markdown: markdown.slice(0, 60000) },
        }).catch(() => {});
      } else if (!session) {
        guestEventFn({ data: { anon_id: getAnonId(), event: "report" } }).catch(() => {});
      }
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Failed to generate report");
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <WelcomeBanner signedIn={!!session} />
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/ams-wordmark.png"
                alt="America Medic & Science"
                className="h-11 w-auto shrink-0 object-contain"
              />
              <div className="hidden h-8 w-px bg-border sm:block" />
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  AMS Product Advisor
                </h1>
                <p className="text-sm text-muted-foreground">
                  Enter a patient complaint — get matched products with evidence
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Link to="/admin">
                  <Button variant="outline" size="sm">
                    <ShieldCheck className="mr-1 h-4 w-4" /> Admin
                  </Button>
                </Link>
              )}
              {session ? (
                <>
                  <Link to="/dashboard">
                    <Button variant="outline" size="sm">
                      <LayoutDashboard className="mr-1 h-4 w-4" /> My dashboard
                    </Button>
                  </Link>
                  {session.avatar ? (
                    <img
                      src={session.avatar}
                      alt={session.name ?? session.email ?? "Account"}
                      title={session.email}
                      className="h-8 w-8 rounded-full object-cover ring-1 ring-border"
                    />
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setSession(null);
                      setIsAdmin(false);
                      setFavorites(new Set());
                    }}
                    title={session.email}
                  >
                    <LogOut className="mr-1 h-4 w-4" /> Sign out
                  </Button>
                </>
              ) : (
                <Link to="/auth" search={{ next: "/" }}>
                  <Button variant="ghost" size="sm">
                    <LogIn className="mr-1 h-4 w-4" /> Sign in
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="relative mt-6">
            <Stethoscope className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Patient complaint, diagnosis or scenario — e.g. 'low AMH', 'heavy menstrual bleeding', 'poor sperm motility'"
              className="h-14 rounded-xl border-input pl-12 pr-32 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  ready && qVec
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                {ready ? (qVec ? "Semantic" : embedding ? "…" : "Keyword") : "Loading"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 hover:bg-accent">
              <input
                type="checkbox"
                checked={useLiterature}
                onChange={(e) => setUseLiterature(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium">Include recent peer-reviewed literature</span>
              <span className="text-xs text-muted-foreground">
                (PubMed · PMC · Europe PMC · CrossRef, last 5y)
              </span>
            </label>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Common patient complaints
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMPLAINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setQuery(c)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    query === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-accent"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {!query.trim() ? (
          <EmptyState onPick={setQuery} />
        ) : matches.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No AMS product is indicated for{" "}
              <span className="font-medium text-foreground">"{query}"</span> in the complaint
              database. Try a related clinical term.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{matches.length}</span> product
                {matches.length === 1 ? "" : "s"} indicated for{" "}
                <span className="font-medium text-foreground">"{query}"</span>
                {litLoading && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" /> loading literature…
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                {session && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => onToggleFavorite("complaint", query.trim().toLowerCase(), query.trim())}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        favorites.has(`complaint:${query.trim().toLowerCase()}`)
                          ? "fill-primary text-primary"
                          : ""
                      }`}
                    />
                    {favorites.has(`complaint:${query.trim().toLowerCase()}`)
                      ? "Saved complaint"
                      : "Save complaint"}
                  </Button>
                )}
              <Button onClick={handleReport} disabled={reporting} className="h-9 gap-1.5">
                {reporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
                {reporting
                  ? "Building report…"
                  : report
                  ? "Regenerate report"
                  : "Clinical Product Report"}
              </Button>
              </div>
            </div>

            {reportError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {reportError}
              </div>
            )}

            {report && (
              <div
                id="clinical-report"
                className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-6 shadow-sm print:m-0 print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none"
              >
                <div className="mb-3 flex items-center justify-between print:hidden">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Sparkles className="h-4 w-4" /> Clinical Product Report
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.print()}
                      className="h-8 gap-1.5"
                    >
                      <Printer className="h-4 w-4" /> Export PDF
                    </Button>
                    <button
                      type="button"
                      onClick={() => setReport(null)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Dismiss report"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mb-4 hidden items-center gap-3 border-b pb-3 print:flex">
                  <img src="/ams-wordmark.png" alt="America Medic & Science" className="h-10 w-auto" />
                </div>
                <div className="max-w-none text-sm leading-relaxed text-foreground/90 [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h1: (p) => (
                        <h1 className="mb-2 text-xl font-bold tracking-tight text-foreground" {...p} />
                      ),
                      h2: (p) => (
                        <h2
                          className="mt-7 mb-3 border-b border-primary/15 pb-1.5 text-base font-semibold uppercase tracking-wide text-primary"
                          {...p}
                        />
                      ),
                      h3: (p) => (
                        <h3 className="mt-5 mb-1.5 text-[15px] font-semibold text-foreground" {...p} />
                      ),
                      h4: (p) => (
                        <h4 className="mt-4 mb-1 text-sm font-semibold text-foreground" {...p} />
                      ),
                      p: (p) => <p className="my-2.5" {...p} />,
                      ul: (p) => <ul className="my-2.5 list-disc space-y-1 pl-5" {...p} />,
                      ol: (p) => <ol className="my-2.5 list-decimal space-y-1 pl-5" {...p} />,
                      hr: () => <hr className="my-6 border-border" />,
                      a: (p) => (
                        <a
                          className="text-primary underline underline-offset-2"
                          target="_blank"
                          rel="noopener noreferrer"
                          {...p}
                        />
                      ),
                      table: (p) => (
                        <div className="my-4 overflow-x-auto rounded-lg border border-border">
                          <table className="w-full border-collapse text-xs" {...p} />
                        </div>
                      ),
                      thead: (p) => <thead className="bg-muted/60" {...p} />,
                      th: (p) => (
                        <th
                          className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                          {...p}
                        />
                      ),
                      td: (p) => (
                        <td className="border-b border-border/60 px-3 py-2 align-top" {...p} />
                      ),
                      blockquote: (p) => (
                        <blockquote className="my-3 border-l-2 border-primary/40 pl-3 italic" {...p} />
                      ),
                    }}
                  >
                    {report}
                  </ReactMarkdown>
                </div>

                <p className="mt-4 border-t border-primary/10 pt-3 text-[11px] text-muted-foreground">
                  AI-generated from the indexed documents and literature below. Always verify against
                  the cited sources.
                </p>
              </div>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              {matches.map((m) => (
                <ProductCard
                  key={m.product}
                  match={m}
                  complaint={query}
                  literature={literature}
                  canFavorite={!!session}
                  favorited={favorites.has(`product:${m.product}`)}
                  onToggleFavorite={() => onToggleFavorite("product", m.product, m.product)}
                />
              ))}
            </div>

            {literature.length > 0 && (
              <div className="mt-8 rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Recent peer-reviewed literature ({literature.length})
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    PubMed · PMC · Europe PMC · last 5 years
                  </span>
                </div>
                <ol className="space-y-3">
                  {literature.map((l, i) => (
                    <li key={i} className="rounded-md border border-border/60 bg-background p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          {l.pubType.split(";")[0]}
                        </span>
                        <span className="text-muted-foreground">{l.year}</span>
                      </div>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {l.title}
                      </a>
                      {l.authors && <p className="mt-1 text-xs text-muted-foreground">{l.authors}</p>}
                      <p className="mt-1 text-xs italic text-muted-foreground">{l.journal}</p>
                      <LitLinks item={l} />
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function LitLinks({ item }: { item: LiteratureItem }) {
  return (
    <p className="mt-1 flex flex-wrap gap-3 text-xs not-italic">
      {item.pmid && (
        <a
          href={`https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          PubMed
        </a>
      )}
      {item.pmcid && (
        <a
          href={`https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          PMC
        </a>
      )}
      {item.doi && (
        <a
          href={`https://doi.org/${item.doi}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          Publisher
        </a>
      )}
      {item.doi && (
        <a
          href={`https://search.crossref.org/?q=${encodeURIComponent(item.doi)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          CrossRef
        </a>
      )}
    </p>
  );
}

function ProductCard({
  match,
  complaint,
  literature,
  canFavorite,
  favorited,
  onToggleFavorite,
}: {
  match: ProductMatch;
  complaint: string;
  literature: LiteratureItem[];
  canFavorite: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
}) {
  const [open, setOpen] = useState(false);
  const img = getProductImage(match.product);

  const rationale = match.passages[0]?.text ?? null;
  const relevantLit = useMemo(() => {
    const terms = [complaint, ...match.matchedIndications]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 3);
    const scored = literature.map((l) => {
      const hay = `${l.title} ${l.abstract}`.toLowerCase();
      const hits = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { l, hits };
    });
    scored.sort((a, b) => b.hits - a.hits || a.l.evidenceRank - b.l.evidenceRank);
    return scored.slice(0, 2).map((s) => s.l);
  }, [literature, complaint, match.matchedIndications]);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <div className="flex gap-4 border-b border-border/60 bg-muted/30 p-5">
        {img && (
          <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-border">
            <img src={img} alt={match.product} loading="lazy" className="h-full w-full object-contain" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-foreground">{match.product}</h3>
            {canFavorite && (
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                title={favorited ? "Remove from favorites" : "Add to favorites"}
                className="shrink-0 text-muted-foreground hover:text-primary"
              >
                <Star className={`h-4 w-4 ${favorited ? "fill-primary text-primary" : ""}`} />
              </button>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {match.matchedIndications.slice(0, 4).map((ind) => (
              <Badge key={ind} variant="default" className="text-[11px] font-medium">
                {ind}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Match confidence {Math.round(match.score * 100)}% · {match.passages.length} indexed
            passage{match.passages.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5 text-sm">
        <Section title="Official indications">
          <ul className="ml-4 list-disc space-y-0.5 text-foreground/90">
            {match.allIndications.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Section>

        <Section title="Effect on this complaint">
          <p className="text-foreground/90">
            {match.matchedIndications.length
              ? `Officially indicated for ${match.matchedIndications
                  .slice(0, 3)
                  .join(", ")
                  .toLowerCase()} — directly addressing "${complaint}".`
              : `Indicated for related conditions in the AMS complaint database.`}
            {rationale ? ` ${rationale.slice(0, 220).trim()}…` : ""}
          </p>
        </Section>

        {relevantLit.length > 0 && (
          <Section title="Evidence & literature rationale">
            <ul className="space-y-1.5">
              {relevantLit.map((l, i) => (
                <li key={i} className="text-xs text-foreground/90">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    {l.title.slice(0, 120)}
                  </a>
                  <span className="text-muted-foreground">
                    {" "}
                    — {l.journal}, {l.year}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {match.otherIndications.length > 0 && (
          <Section title="Other recommended indications">
            <div className="flex flex-wrap gap-1">
              {match.otherIndications.map((i) => (
                <span
                  key={i}
                  className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {i}
                </span>
              ))}
            </div>
          </Section>
        )}

        {match.passages.length > 0 && (
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full gap-1.5"
              onClick={() => setOpen((o) => !o)}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
              {open ? "Hide full evidence" : "View full evidence"}
            </Button>
            {open && (
              <ol className="mt-3 space-y-3">
                {match.passages.map((p, i) => (
                  <li key={i} className="rounded-md border border-border/60 bg-background p-3">
                    <p className="text-[13px] leading-relaxed text-foreground/90">{p.text}</p>
                    {(p.sourceName || p.section || p.page != null) && (
                      <a
                        href={p.sourceFile ? `${p.sourceFile}${p.page != null ? `#page=${p.page}` : ""}` : "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex flex-wrap items-center gap-1.5 text-[11px] text-primary hover:underline"
                      >
                        <BookOpen className="h-3 w-3" />
                        <span className="font-medium">{p.sourceName ?? "Source"}</span>
                        {p.section && p.section !== p.text && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="text-foreground/80">{p.section}</span>
                          </>
                        )}
                        {p.page != null && (
                          <>
                            <span className="text-muted-foreground">·</span>
                            <span className="inline-flex items-center gap-1">
                              <FileText className="h-3 w-3" /> p. {p.page}
                            </span>
                          </>
                        )}
                      </a>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  const examples = [
    "Low AMH",
    "PCOS",
    "Endometriosis",
    "Heavy menstrual bleeding",
    "Male infertility",
    "Recurrent UTI",
  ];
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <Search className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-4 text-base font-medium text-foreground">
        Start with your patient's complaint
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Type a symptom, diagnosis or clinical scenario. We match it against the AMS indication
        database, then attach indexed guideline evidence and recent peer-reviewed literature.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {examples.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-accent"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
