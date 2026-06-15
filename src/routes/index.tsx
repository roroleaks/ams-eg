import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, FileText, BookOpen, Pill } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { search, getAllProducts, totalChunks } from "@/lib/search";
import { Highlight } from "@/components/Highlight";
import { getProductImage } from "@/data/product-images";

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

  const products = useMemo(() => getAllProducts(), []);
  const results = useMemo(() => {
    if (!query.trim()) return [];
    const r = search(query, 80);
    return productFilter ? r.filter((x) => x.product === productFilter) : r;
  }, [query, productFilter]);

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
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Pill className="h-5 w-5" />
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

          <div className="relative mt-6">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ingredients, indications, dosing, trials… (e.g. PCOS NAC, CoQ10 motility)"
              className="h-14 rounded-xl border-input pl-12 pr-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring"
            />
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
            {products.map((p) => (
              <Button
                key={p}
                size="sm"
                variant={productFilter === p ? "default" : "outline"}
                onClick={() => setProductFilter(p)}
                className="h-8"
              >
                {p}
              </Button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {!query.trim() ? (
          <EmptyState onPick={setQuery} />
        ) : results.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No passages found for{" "}
              <span className="font-medium text-foreground">"{query}"</span>
              {productFilter ? ` in ${productFilter}` : ""}.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {results.length} passage{results.length === 1 ? "" : "s"} found
              </span>
              <span className="text-xs">
                Searched {totalChunks()} passages · ranked by relevance
              </span>
            </div>
            <ol className="space-y-3">
              {results.map((r, i) => (
                <li
                  key={i}
                  className="group rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    {r.product && (
                      <Badge variant="default" className="font-medium">
                        {r.product}
                      </Badge>
                    )}
                    {r.section && r.section !== r.text && (
                      <Badge variant="secondary" className="font-normal">
                        <BookOpen className="mr-1 h-3 w-3" />
                        {r.section}
                      </Badge>
                    )}
                    {r.page != null && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <FileText className="h-3 w-3" /> Page {r.page}
                      </span>
                    )}
                    <span className="ml-auto text-muted-foreground/70">
                      relevance {r.score.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[15px] leading-relaxed text-foreground">
                    <Highlight text={r.text} terms={terms} />
                  </p>
                </li>
              ))}
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
