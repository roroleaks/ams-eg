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
  ChevronDown,
  Printer,
  Star,
  LayoutDashboard,
  Mic,
  Activity,
  FlaskConical,
  ShieldAlert,
  Pill,
  ClipboardList,
  Link2,
  Microscope,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

const SHORTCUTS: { label: string; hint: string }[] = [
  { label: "Male Infertility", hint: "Andrology workup" },
  { label: "Low sperm count", hint: "Oligozoospermia" },
  { label: "OAT", hint: "Oligo-astheno-teratozoospermia" },
  { label: "Poor sperm motility", hint: "Asthenozoospermia" },
  { label: "PCOS", hint: "Ovulatory dysfunction" },
  { label: "Low AMH", hint: "Diminished reserve" },
  { label: "Heavy menstrual bleeding", hint: "Menorrhagia" },
  { label: "Menopause", hint: "Climacteric support" },
];

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } =>
    typeof s.q === "string" && s.q ? { q: s.q } : {},
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

  const hasQuery = !!query.trim();

  const searchBox = (
    <SearchBox
      query={query}
      setQuery={setQuery}
      ready={ready}
      qVec={qVec}
      embedding={embedding}
      large={!hasQuery}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <WelcomeBanner signedIn={!!session} />

      <header className="sticky top-0 z-30 border-b border-border/70 bg-card/85 backdrop-blur-md print:hidden">
        <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setQuery("")}
            className="flex min-w-0 items-center gap-3 text-left"
          >
            <img
              src="/ams-wordmark.png"
              alt="America Medic & Science"
              className="h-8 w-auto shrink-0 object-contain sm:h-9"
            />
            <span className="hidden h-7 w-px shrink-0 bg-border sm:block" />
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-sm font-semibold tracking-tight text-foreground">
                AMS Product Advisor
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                Clinical decision support
              </span>
            </span>
          </button>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {isAdmin && (
              <Link to="/admin">
                <Button variant="outline" size="sm" className="rounded-full">
                  <ShieldCheck className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Admin</span>
                </Button>
              </Link>
            )}
            {session ? (
              <>
                <Link to="/dashboard">
                  <Button variant="outline" size="sm" className="rounded-full">
                    <LayoutDashboard className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">My dashboard</span>
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
                  className="rounded-full"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setSession(null);
                    setIsAdmin(false);
                    setFavorites(new Set());
                  }}
                  title={session.email}
                >
                  <LogOut className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Sign out</span>
                </Button>
              </>
            ) : (
              <Link to="/auth" search={{ next: "/" }}>
                <Button variant="ghost" size="sm" className="rounded-full">
                  <LogIn className="h-4 w-4 sm:mr-1" />
                  <span className="hidden sm:inline">Sign in</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {!hasQuery ? (
        <main className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
          <section className="animate-fade-in text-center">
            <img
              src="/ams-wordmark.png"
              alt="America Medic & Science"
              className="mx-auto h-16 w-auto object-contain sm:h-20"
            />
            <h1 className="mt-7 text-3xl font-semibold tracking-tight text-foreground sm:text-[2.6rem] sm:leading-tight">
              AMS Product Advisor
            </h1>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Complaint-driven clinical decision support — matched AMS products with official
              indications, indexed monograph evidence and recent peer-reviewed literature.
            </p>

            <div className="mx-auto mt-9 max-w-3xl">{searchBox}</div>

            <label className="mx-auto mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-sm transition-colors hover:bg-accent">
              <input
                type="checkbox"
                checked={useLiterature}
                onChange={(e) => setUseLiterature(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium text-foreground">Include recent literature</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                PubMed · PMC · Europe PMC · last 5y
              </span>
            </label>
          </section>

          <section className="mt-12">
            <h2 className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Quick complaint shortcuts
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {SHORTCUTS.map((s, i) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setQuery(s.label)}
                  style={{ animationDelay: `${i * 35}ms` }}
                  className="surface-card hover-lift animate-fade-in group p-4 text-left hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Activity className="h-4 w-4 text-primary transition-transform group-hover:scale-110" />
                  <p className="mt-3 text-sm font-semibold leading-snug text-foreground">
                    {s.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              All common patient complaints
            </h2>
            <div className="flex flex-wrap justify-center gap-2">
              {COMPLAINTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setQuery(c)}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                >
                  {c}
                </button>
              ))}
            </div>
          </section>
        </main>
      ) : (
        <>
          <div className="border-b border-border/70 bg-card/60 print:hidden">
            <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
              {searchBox}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-sm transition-colors hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={useLiterature}
                    onChange={(e) => setUseLiterature(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  <span className="font-medium text-foreground">Include recent literature</span>
                </label>
                {COMPLAINTS.slice(0, 8).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setQuery(c)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      query === c
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
            {matches.length === 0 ? (
              embedding || !ready ? (
                <LoadingPanel mode="search" />
              ) : (
                <EmptyResults query={query} />
              )
            ) : (
              <>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">
                      {matches.length} product{matches.length === 1 ? "" : "s"} for “{query.trim()}”
                    </h2>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      Matched against the AMS indication database
                      {litLoading && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Searching recent medical
                          literature…
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {session && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 gap-1.5 rounded-full"
                        onClick={() =>
                          onToggleFavorite("complaint", query.trim().toLowerCase(), query.trim())
                        }
                      >
                        <Star
                          className={`h-4 w-4 ${
                            favorites.has(`complaint:${query.trim().toLowerCase()}`)
                              ? "fill-primary text-primary"
                              : ""
                          }`}
                        />
                        {favorites.has(`complaint:${query.trim().toLowerCase()}`)
                          ? "Saved"
                          : "Save complaint"}
                      </Button>
                    )}
                    <Button
                      onClick={handleReport}
                      disabled={reporting}
                      className="bg-gradient-primary h-10 gap-2 rounded-full px-5 font-semibold shadow-md transition-all hover:shadow-lg disabled:opacity-70"
                    >
                      {reporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                      {reporting
                        ? "Building report…"
                        : report
                          ? "Regenerate report"
                          : "Clinical Evidence Report"}
                    </Button>
                  </div>
                </div>

                {reportError && (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    {reportError}
                  </div>
                )}

                {reporting && !report && <LoadingPanel mode="report" />}

                {report && (
                  <ClinicalReport
                    markdown={report}
                    complaint={query.trim()}
                    onDismiss={() => setReport(null)}
                  />
                )}

                <div className="grid gap-5 lg:grid-cols-2">
                  {matches.map((m, i) => (
                    <ProductCard
                      key={m.product}
                      index={i}
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
                  <Collapsible
                    className="mt-8"
                    icon={<BookOpen className="h-4 w-4 text-primary" />}
                    title={`Recent peer-reviewed literature (${literature.length})`}
                    subtitle="PubMed · PMC · Europe PMC · last 5 years"
                  >
                    <ol className="space-y-3">
                      {literature.map((l, i) => (
                        <li
                          key={i}
                          className="rounded-xl border border-border/70 bg-background p-4 transition-colors hover:border-primary/30"
                        >
                          <div className="mb-1.5 flex flex-wrap items-center gap-2">
                            <Badge
                              variant="secondary"
                              className="rounded-full text-[10px] font-medium"
                            >
                              {l.pubType.split(";")[0]}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">{l.year}</span>
                          </div>
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold leading-snug text-foreground hover:text-primary hover:underline"
                          >
                            {l.title}
                          </a>
                          {l.authors && (
                            <p className="mt-1 text-xs text-muted-foreground">{l.authors}</p>
                          )}
                          <p className="mt-0.5 text-xs italic text-muted-foreground">{l.journal}</p>
                          <LitLinks item={l} />
                        </li>
                      ))}
                    </ol>
                  </Collapsible>
                )}
              </>
            )}
          </main>
        </>
      )}
    </div>
  );
}

function SearchBox({
  query,
  setQuery,
  ready,
  qVec,
  embedding,
  large,
}: {
  query: string;
  setQuery: (v: string) => void;
  ready: boolean;
  qVec: Float32Array | null;
  embedding: boolean;
  large: boolean;
}) {
  return (
    <div className="relative">
      <Search
        className={`pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground ${
          large ? "h-5 w-5" : "h-4.5 w-4.5"
        }`}
      />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search by patient complaint, diagnosis, symptom, laboratory finding or product"
        placeholder="Search by patient complaint, diagnosis, symptom, laboratory finding or product..."
        className={`w-full rounded-full border border-border bg-card pl-13 pr-28 text-foreground shadow-[var(--shadow-card)] outline-none transition-all placeholder:text-muted-foreground/80 focus:border-primary/40 focus:ring-4 focus:ring-ring/15 ${
          large ? "h-16 text-base sm:text-[17px]" : "h-13 text-sm sm:text-base"
        }`}
      />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          disabled
          title="Voice search — coming soon"
          aria-label="Voice search (coming soon)"
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground/60"
        >
          <Mic className="h-4 w-4" />
        </button>
        <span
          className={`hidden items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:inline-flex ${
            ready && qVec
              ? "border-primary/25 bg-primary/10 text-primary"
              : "border-border bg-muted text-muted-foreground"
          }`}
        >
          <Sparkles className="h-3 w-3" />
          {ready ? (qVec ? "Semantic" : embedding ? "…" : "Keyword") : "Loading"}
        </span>
      </div>
    </div>
  );
}

const SEARCH_STEPS = [
  "Searching AMS product database…",
  "Reviewing clinical monographs…",
  "Matching official indications…",
];
const REPORT_STEPS = [
  "Reviewing clinical monographs…",
  "Searching recent medical literature…",
  "Synthesising clinical evidence…",
  "Preparing clinical report…",
];

function LoadingPanel({ mode }: { mode: "search" | "report" }) {
  const steps = mode === "report" ? REPORT_STEPS : SEARCH_STEPS;
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % steps.length), 1800);
    return () => clearInterval(t);
  }, [steps.length]);
  return (
    <div className="surface-card animate-fade-in mb-6 p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">{steps[step]}</p>
      <div className="mx-auto mt-5 max-w-md space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 animate-pulse rounded-full bg-muted" />
        ))}
      </div>
    </div>
  );
}

function EmptyResults({ query }: { query: string }) {
  return (
    <div className="surface-card animate-fade-in p-12 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted">
        <Microscope className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-foreground">
        No matching products were identified.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Nothing in the AMS indication database matches “{query.trim()}”. Try another complaint or
        use different keywords.
      </p>
    </div>
  );
}

function Collapsible({
  title,
  subtitle,
  icon,
  children,
  className = "",
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`surface-card overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/60"
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          {subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="animate-fade-in border-t border-border/70 p-5">{children}</div>}
    </section>
  );
}

function LitLinks({ item }: { item: LiteratureItem }) {
  const links = [
    item.pmid && { label: "PubMed", href: `https://pubmed.ncbi.nlm.nih.gov/${item.pmid}/` },
    item.pmcid && { label: "PMC", href: `https://pmc.ncbi.nlm.nih.gov/articles/${item.pmcid}/` },
    item.doi && { label: "Publisher", href: `https://doi.org/${item.doi}` },
    item.doi && {
      label: "CrossRef",
      href: `https://search.crossref.org/?q=${encodeURIComponent(item.doi)}`,
    },
  ].filter(Boolean) as { label: string; href: string }[];
  if (!links.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <Link2 className="h-3 w-3" />
          {l.label}
        </a>
      ))}
    </div>
  );
}

/* ---------- Clinical report ---------- */

const REPORT_SECTION_ICONS: { test: RegExp; icon: React.ReactNode }[] = [
  { test: /executive/i, icon: <ClipboardList className="h-4 w-4 text-primary" /> },
  { test: /guideline/i, icon: <ShieldCheck className="h-4 w-4 text-primary" /> },
  { test: /medication|product summary/i, icon: <Pill className="h-4 w-4 text-primary" /> },
  { test: /interpretation|evidence/i, icon: <FlaskConical className="h-4 w-4 text-primary" /> },
  { test: /takeaway/i, icon: <Sparkles className="h-4 w-4 text-primary" /> },
  { test: /reference/i, icon: <BookOpen className="h-4 w-4 text-primary" /> },
  { test: /link/i, icon: <Link2 className="h-4 w-4 text-primary" /> },
];

function sectionIcon(title: string) {
  return (
    REPORT_SECTION_ICONS.find((s) => s.test.test(title))?.icon ?? (
      <FileText className="h-4 w-4 text-primary" />
    )
  );
}

function splitReport(markdown: string) {
  const lines = markdown.split("\n");
  const intro: string[] = [];
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line.trim());
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1].replace(/[#*]/g, "").trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push(current);
  return { intro: intro.join("\n").trim(), sections };
}

function ClinicalReport({
  markdown,
  complaint,
  onDismiss,
}: {
  markdown: string;
  complaint: string;
  onDismiss: () => void;
}) {
  const { intro, sections } = useMemo(() => splitReport(markdown), [markdown]);
  const introTitle = intro.replace(/^#\s*/, "").split("\n")[0]?.replace(/[#*]/g, "").trim();

  return (
    <div id="clinical-report" className="animate-fade-in mb-10 print:m-0">
      <div className="surface-card overflow-hidden print:rounded-none print:border-0 print:shadow-none">
        <div className="bg-gradient-primary flex flex-wrap items-center justify-between gap-3 px-6 py-5 print:hidden">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary-foreground">
              <Sparkles className="h-4 w-4" /> Clinical Evidence Report
            </p>
            <p className="mt-0.5 truncate text-xs text-primary-foreground/80">
              {introTitle && introTitle.length < 90 ? introTitle : complaint}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.print()}
              className="h-9 gap-1.5 rounded-full"
            >
              <Printer className="h-4 w-4" /> Export PDF
            </Button>
            <button
              type="button"
              onClick={onDismiss}
              className="grid h-9 w-9 place-items-center rounded-full text-primary-foreground/80 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
              aria-label="Dismiss report"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mb-4 hidden items-center gap-3 border-b pb-3 print:flex">
          <img src="/ams-wordmark.png" alt="America Medic & Science" className="h-10 w-auto" />
        </div>

        <div className="space-y-4 bg-muted/30 p-4 sm:p-6 print:bg-white print:p-0">
          {sections.length === 0 ? (
            <article className="surface-card p-5 sm:p-6">
              <Markdown>{markdown}</Markdown>
            </article>
          ) : (
            sections.map((s) =>
              /reference|link/i.test(s.title) ? (
                <Collapsible
                  key={s.title}
                  icon={sectionIcon(s.title)}
                  title={s.title}
                  subtitle="Expand to view full list"
                >
                  <Markdown>{s.body.join("\n")}</Markdown>
                </Collapsible>
              ) : (
                <article key={s.title} className="surface-card p-5 sm:p-6">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
                    {sectionIcon(s.title)}
                    {s.title}
                  </h3>
                  <Markdown>{s.body.join("\n")}</Markdown>
                </article>
              ),
            )
          )}

          <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
            AI-generated from the indexed documents and literature below. Always verify against the
            cited sources.
          </p>
        </div>
      </div>
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="max-w-none text-sm leading-relaxed text-foreground/90 [&_em]:italic [&_strong]:font-semibold [&_strong]:text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (p) => (
            <h1 className="mb-2 text-lg font-bold tracking-tight text-foreground" {...p} />
          ),
          h2: (p) => (
            <h2 className="mt-6 mb-2 text-base font-semibold text-foreground" {...p} />
          ),
          h3: (p) => <h3 className="mt-4 mb-1.5 text-[15px] font-semibold text-foreground" {...p} />,
          h4: (p) => <h4 className="mt-3 mb-1 text-sm font-semibold text-foreground" {...p} />,
          p: (p) => <p className="my-2.5" {...p} />,
          ul: (p) => <ul className="my-2.5 list-disc space-y-1.5 pl-5" {...p} />,
          ol: (p) => <ol className="my-2.5 list-decimal space-y-1.5 pl-5" {...p} />,
          hr: () => <hr className="my-6 border-border" />,
          a: (p) => (
            <a
              className="font-medium text-primary underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...p}
            />
          ),
          table: (p) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-xs" {...p} />
            </div>
          ),
          thead: (p) => (
            <thead
              className="sticky top-0 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/70"
              {...p}
            />
          ),
          tbody: (p) => <tbody className="[&_tr:nth-child(even)]:bg-muted/30" {...p} />,
          th: (p) => (
            <th
              className="border-b border-border px-3.5 py-2.5 text-left font-semibold text-foreground"
              {...p}
            />
          ),
          td: (p) => (
            <td className="border-b border-border/60 px-3.5 py-2.5 align-top" {...p} />
          ),
          blockquote: (p) => (
            <blockquote
              className="my-3 rounded-r-lg border-l-2 border-primary/40 bg-muted/40 py-2 pl-3 italic"
              {...p}
            />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/* ---------- Product card ---------- */

function evidenceLevel(match: ProductMatch) {
  const n = match.passages.length;
  if (match.score >= 0.75 && n >= 3)
    return { label: "Strong evidence", cls: "border-transparent bg-success/15 text-success" };
  if (n >= 1)
    return { label: "Moderate evidence", cls: "border-transparent bg-warning/20 text-warning-foreground" };
  return { label: "Clinical recommendation", cls: "border-border bg-muted text-muted-foreground" };
}

function ProductCard({
  match,
  complaint,
  literature,
  canFavorite,
  favorited,
  onToggleFavorite,
  index,
}: {
  match: ProductMatch;
  complaint: string;
  literature: LiteratureItem[];
  canFavorite: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const img = getProductImage(match.product);
  const evidence = evidenceLevel(match);

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
    <article
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
      className="surface-card hover-lift animate-fade-in flex flex-col overflow-hidden hover:border-primary/30"
    >
      <div className="flex gap-4 border-b border-border/70 bg-[var(--gradient-surface)] p-5">
        {img && (
          <div className="grid h-24 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-card p-1.5 ring-1 ring-border">
            <img
              src={img}
              alt={match.product}
              loading="lazy"
              className="h-full w-full object-contain"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight text-foreground">
              {match.product}
            </h3>
            {canFavorite && (
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                title={favorited ? "Remove from favorites" : "Add to favorites"}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-primary"
              >
                <Star className={`h-4 w-4 ${favorited ? "fill-primary text-primary" : ""}`} />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${evidence.cls}`}
            >
              <ShieldCheck className="h-3 w-3" />
              {evidence.label}
            </span>
            {relevantLit.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                <BookOpen className="h-3 w-3" /> Recent literature
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {Math.round(match.score * 100)}% match
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {match.matchedIndications.slice(0, 4).map((ind) => (
              <Badge key={ind} className="rounded-full text-[11px] font-medium">
                {ind}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 p-5 text-sm">
        <Section title="Official indications" icon={<ClipboardList className="h-3.5 w-3.5" />}>
          <ul className="ml-4 list-disc space-y-1 text-foreground/90">
            {match.allIndications.slice(0, 6).map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Section>

        <Section title="Why it matches this complaint" icon={<Activity className="h-3.5 w-3.5" />}>
          <p className="leading-relaxed text-foreground/90">
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
          <Section title="Evidence & literature rationale" icon={<FlaskConical className="h-3.5 w-3.5" />}>
            <ul className="space-y-2">
              {relevantLit.map((l, i) => (
                <li key={i} className="text-xs leading-relaxed text-foreground/90">
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
          <Section title="Related complaints" icon={<Pill className="h-3.5 w-3.5" />}>
            <div className="flex flex-wrap gap-1.5">
              {match.otherIndications.map((i) => (
                <span
                  key={i}
                  className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {i}
                </span>
              ))}
            </div>
          </Section>
        )}
      </div>

      {match.passages.length > 0 && (
        <div className="border-t border-border/70 p-4">
          <Button
            variant="outline"
            size="sm"
            className="h-10 w-full gap-1.5 rounded-full"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
            {open ? "Hide details" : "View details"}
          </Button>
          {open && (
            <ol className="animate-fade-in mt-3 space-y-3">
              {match.passages.map((p, i) => (
                <li key={i} className="rounded-xl border border-border/70 bg-background p-3.5">
                  <p className="text-[13px] leading-relaxed text-foreground/90">{p.text}</p>
                  {(p.sourceName || p.section || p.page != null) && (
                    <a
                      href={
                        p.sourceFile
                          ? `${p.sourceFile}${p.page != null ? `#page=${p.page}` : ""}`
                          : "#"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2.5 inline-flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
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
    </article>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
