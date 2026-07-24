import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Search, FileText, BookOpen, Sparkles, Wand2, Loader2, X, ShieldCheck, LogIn, LogOut } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  hybridSearch,
  getAllProducts,
  totalChunks,
  loadEmbeddings,
} from "@/lib/search";
import { embedQuery } from "@/lib/embed.functions";
import { summarizeResults } from "@/lib/summarize.functions";
import { searchLiterature, type LiteratureItem } from "@/lib/literature.functions";
import { logSearch } from "@/lib/analytics.functions";
import { isAdmin as isAdminFn } from "@/lib/admin.functions";
import { supabase } from "@/integrations/supabase/client";
import { Highlight } from "@/components/Highlight";
import { getProductImage } from "@/data/product-images";


const COMPLAINTS: string[] = [
  "PCOS",
  "endometriosis",
  "fibroid",
  "irregular periods",
  "heavy menstrual bleeding",
  "painful periods",
  "PMS",
  "infertility",
  "recurrent miscarriage",
  "poor ovarian reserve",
  "anovulation",
  "preconception",
  "menopause",
  "menopausal symptoms",
  "vaginal dryness",
  "low libido",
  "urinary tract infection",
  "recurrent UTI",
  "breast pain",
  "fibrocystic breast",
  "low sperm count",
  "poor sperm motility",
  "erectile dysfunction",
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AMS Product Reference — Search for Clinicians" },
      {
        name: "description",
        content:
          "Searchable clinical reference for America Medic & Science (AMS) fertility and health supplements. Find ingredients, indications, dosing, and trial data instantly.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [qVec, setQVec] = useState<Float32Array | null>(null);
  const [embedsReady, setEmbedsReady] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const embedFn = useServerFn(embedQuery);
  const summarizeFn = useServerFn(summarizeResults);
  const literatureFn = useServerFn(searchLiterature);
  const logFn = useServerFn(logSearch);
  const isAdminServer = useServerFn(isAdminFn);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [literature, setLiterature] = useState<LiteratureItem[]>([]);
  const [useGuidelines, setUseGuidelines] = useState(true);
  const [useLiterature, setUseLiterature] = useState(true);
  const [session, setSession] = useState<{ email?: string } | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const seqRef = useRef(0);
  const lastLoggedRef = useRef<string>("");

  // Track auth session
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setSession({ email: data.user.email });
        isAdminServer().then((r) => setIsAdmin(r.isAdmin)).catch(() => setIsAdmin(false));
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setSession(s?.user ? { email: s.user.email } : null);
        if (s?.user) {
          isAdminServer().then((r) => setIsAdmin(r.isAdmin)).catch(() => setIsAdmin(false));
        } else {
          setIsAdmin(false);
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [isAdminServer]);



  // Preload embedding matrix once
  useEffect(() => {
    loadEmbeddings()
      .then(() => setEmbedsReady(true))
      .catch(() => setEmbedsReady(false));
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

  const products = useMemo(() => getAllProducts(), []);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const r = hybridSearch(query, embedsReady ? qVec : null, 80);
    return productFilter ? r.filter((x) => x.product === productFilter) : r;
  }, [query, productFilter, qVec, embedsReady]);

  // Reset summary when query/filter changes
  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    setLiterature([]);
  }, [query, productFilter]);

  // Log searches (debounced, no dupes)
  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 2) return;
    const handle = setTimeout(() => {
      const key = `${q}|${results.length}`;
      if (lastLoggedRef.current === key) return;
      lastLoggedRef.current = key;
      const mode = embedsReady && qVec ? "hybrid" : "keyword";
      logFn({ data: { query: q, result_count: results.length, mode } }).catch(() => {});
    }, 900);
    return () => clearTimeout(handle);
  }, [query, results.length, embedsReady, qVec, logFn]);


  async function handleSummarize() {
    if (summarizing) return;
    if (!useGuidelines && !useLiterature) {
      setSummaryError("Enable at least one evidence source.");
      return;
    }
    if (useGuidelines && !results.length && !useLiterature) return;
    setSummarizing(true);
    setSummaryError(null);
    try {
      const passages = useGuidelines
        ? results.slice(0, 20).map((r) => ({
            product: r.product,
            section: r.section,
            page: r.page,
            sourceName: r.sourceName ?? null,
            text: r.text.slice(0, 900),
          }))
        : [];

      let lit: LiteratureItem[] = [];
      if (useLiterature) {
        try {
          const { items } = await literatureFn({ data: { query, yearsBack: 5, limit: 10 } });
          lit = items;
          setLiterature(items);
        } catch (e) {
          console.warn("literature search failed", e);
          setLiterature([]);
        }
      } else {
        setLiterature([]);
      }

      const { markdown } = await summarizeFn({
        data: {
          query,
          passages,
          literature: lit.map((l) => ({
            title: l.title,
            authors: l.authors,
            journal: l.journal,
            year: l.year,
            doi: l.doi,
            pmid: l.pmid,
            pubType: l.pubType,
          })),
          useGuidelines,
          useLiterature,
        },
      });
      setSummary(markdown);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Failed to summarize");
    } finally {
      setSummarizing(false);
    }
  }


  const terms = useMemo(
    () =>
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[^a-z0-9\-]/gi, ""))
        .filter((t) => t.length > 1),
    [query]
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-primary ring-1 ring-primary/20">
                <img
                  src="/ams-logo.png"
                  alt="AMS"
                  width={40}
                  height={40}
                  className="h-full w-full object-contain"
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  AMS Clinical Reference
                </h1>
                <p className="text-sm text-muted-foreground">
                  Searchable product knowledge for healthcare professionals
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Link to="/admin">
                  <Button variant="outline" size="sm">
                    <ShieldCheck className="h-4 w-4 mr-1" /> Admin
                  </Button>
                </Link>
              )}
              {session ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setSession(null);
                    setIsAdmin(false);
                  }}
                  title={session.email}
                >
                  <LogOut className="h-4 w-4 mr-1" /> Sign out
                </Button>
              ) : (
                <Link to="/auth">
                  <Button variant="ghost" size="sm">
                    <LogIn className="h-4 w-4 mr-1" /> Sign in
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 hover:bg-accent">
              <input
                type="checkbox"
                checked={useGuidelines}
                onChange={(e) => setUseGuidelines(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium">Search Guideline Library</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 hover:bg-accent">
              <input
                type="checkbox"
                checked={useLiterature}
                onChange={(e) => setUseLiterature(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="font-medium">Search Recent Medical Literature</span>
              <span className="text-xs text-muted-foreground">(PubMed · Europe PMC, last 5y)</span>
            </label>
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by concept or keyword — e.g. 'low ovarian reserve', 'poor responder', 'D-mannose UTI'"
              className="h-14 rounded-xl border-input pl-12 pr-32 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  embedsReady && qVec
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground"
                }`}
                title={
                  embedsReady
                    ? qVec
                      ? "Semantic + keyword search active"
                      : embedding
                      ? "Computing semantic vector…"
                      : "Keyword search"
                    : "Loading semantic index…"
                }
              >
                <Sparkles className="h-3 w-3" />
                {embedsReady
                  ? qVec
                    ? "Semantic"
                    : embedding
                    ? "…"
                    : "Keyword"
                  : "Loading"}
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={productFilter === null ? "default" : "outline"}
              onClick={() => setProductFilter(null)}
              className="h-8"
            >
              All products
            </Button>
            {products.map((p) => {
              const img = getProductImage(p);
              const active = productFilter === p;
              return (
                <Button
                  key={p}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setProductFilter(p)}
                  className="h-9 gap-2 pl-1.5 pr-3"
                >
                  {img ? (
                    <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-border">
                      <img
                        src={img}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-contain"
                      />
                    </span>
                  ) : null}
                  <span>{p}</span>
                </Button>
              );
            })}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Common complaints
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMPLAINTS.map((c) => {
                const active = query === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setQuery(c)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {!query.trim() ? (
          <EmptyState onPick={setQuery} />
        ) : results.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No passages found in the guideline library for{" "}
                <span className="font-medium text-foreground">"{query}"</span>
                {productFilter ? ` in ${productFilter}` : ""}.
              </p>
              {useLiterature && (
                <Button
                  size="sm"
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="mt-4 h-8 gap-1.5"
                >
                  {summarizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  {summarizing ? "Searching literature…" : "Search recent literature"}
                </Button>
              )}
            </div>
            {summaryError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {summaryError}
              </div>
            )}
            {summary && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                <div className="prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-h2:text-base prose-h2:font-semibold">
                  <ReactMarkdown>{summary}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {results.length} passage{results.length === 1 ? "" : "s"} found
              </span>
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="h-8 gap-1.5"
                >
                  {summarizing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5" />
                  )}
                  {summarizing ? "Summarizing…" : summary ? "Regenerate summary" : "Summary"}
                </Button>
                <span className="text-xs">
                  Searched {totalChunks()} passages
                </span>
              </div>
            </div>

            {summaryError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {summaryError}
              </div>
            )}

            {summary && (
              <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <Sparkles className="h-4 w-4" />
                    AI Clinical Briefing
                  </div>
                  <button
                    type="button"
                    onClick={() => setSummary(null)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Dismiss summary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-foreground prose-h2:text-base prose-h2:font-semibold prose-p:text-foreground/90 prose-li:text-foreground/90 prose-strong:text-foreground">
                  <ReactMarkdown>{summary}</ReactMarkdown>
                </div>
                <p className="mt-4 border-t border-primary/10 pt-3 text-[11px] text-muted-foreground">
                  AI-generated from the ranked passages below. Always verify against the cited sources.
                </p>
              </div>
            )}

            {literature.length > 0 && (
              <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Recent peer-reviewed literature ({literature.length})
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    PubMed · Europe PMC · last 5 years
                  </span>
                </div>
                <ol className="space-y-3">
                  {literature.map((l, i) => (
                    <li key={i} className="rounded-md border border-border/60 bg-background p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono font-medium text-primary">
                          L{i + 1}
                        </span>
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
                      {l.authors && (
                        <p className="mt-1 text-xs text-muted-foreground">{l.authors}</p>
                      )}
                      <p className="mt-1 text-xs italic text-muted-foreground">
                        {l.journal}
                        {l.doi && <> · DOI: <span className="font-mono">{l.doi}</span></>}
                        {l.pmid && <> · PMID: <span className="font-mono">{l.pmid}</span></>}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <ol className="space-y-3">
              {results.map((r, i) => {
                const img = getProductImage(r.product);
                return (
                  <li
                    key={i}
                    className="group flex gap-4 rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
                  >
                    {img ? (
                      <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-border">
                        <img
                          src={img}
                          alt={r.product ?? ""}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                        {r.product && (
                          <Badge variant="default" className="font-medium">
                            {r.product}
                          </Badge>
                        )}
                        <span className="ml-auto text-muted-foreground/70">
                          relevance {r.score.toFixed(2)}
                        </span>
                      </div>
                      <p className="text-[15px] leading-relaxed text-foreground">
                        <Highlight text={r.text} terms={terms} />
                      </p>
                      {(r.sourceName || r.section || r.page != null) && (
                        <a
                          href={
                            r.sourceFile
                              ? `${r.sourceFile}${r.page != null ? `#page=${r.page}` : ""}`
                              : "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex flex-wrap items-center gap-1.5 text-xs text-primary hover:underline"
                          title="Open source PDF at this page"
                        >
                          <BookOpen className="h-3 w-3" />
                          <span className="font-medium">
                            {r.sourceName ?? "Source"}
                          </span>
                          {r.section && r.section !== r.text && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-foreground/80">{r.section}</span>
                            </>
                          )}
                          {r.page != null && (
                            <>
                              <span className="text-muted-foreground">·</span>
                              <span className="inline-flex items-center gap-1">
                                <FileText className="h-3 w-3" /> p. {r.page}
                              </span>
                            </>
                          )}
                        </a>
                      )}

                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </main>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  const examples = [
    "PCOS",
    "NAC ovulation",
    "CoQ10 motility",
    "endometriosis",
    "D-mannose UTI",
    "fibroid",
    "preconception",
    "L-carnitine",
  ];
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <Search className="mx-auto h-8 w-8 text-muted-foreground" />
      <h2 className="mt-4 text-base font-medium text-foreground">
        Start searching the AMS catalog
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Type any keyword — ingredient, condition, dose, or trial author — and
        we'll return the exact passages, ranked by relevance.
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
