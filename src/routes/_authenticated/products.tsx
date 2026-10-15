import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Pill } from "lucide-react";
import { PRODUCT_DB, complaintsFor } from "@/data/complaints";
import { PRODUCT_INGREDIENTS, wikiUrl } from "@/data/product-ingredients";
import { getProductImage } from "@/data/product-images";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/products")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Products — AMS Product Advisor" },
      {
        name: "description",
        content:
          "Every AMS product with its photo, active ingredients and clinical indications.",
      },
      { property: "og:title", content: "Products — AMS Product Advisor" },
      {
        property: "og:description",
        content:
          "Every AMS product with its photo, active ingredients and clinical indications.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/">
            <Button variant="ghost" size="sm" className="rounded-full">
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Back to advisor</span>
            </Button>
          </Link>
          <img
            src="/ams-wordmark.png"
            alt="America Medic & Science"
            className="h-7 w-auto object-contain sm:h-8"
          />
          <span className="hidden h-6 w-px bg-border sm:block" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
              AMS Products
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Photos, active ingredients and indications
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_DB.map((product) => {
            const image = getProductImage(product.name);
            const ingredients = PRODUCT_INGREDIENTS[product.name] ?? [];
            const indications = complaintsFor(product.name);
            return (
              <article
                key={product.name}
                className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-center bg-muted/40 p-6">
                  {image ? (
                    <img
                      src={image}
                      alt={product.name}
                      className="h-40 w-auto object-contain drop-shadow-sm"
                      loading="lazy"
                    />
                  ) : (
                    <Pill className="h-16 w-16 text-muted-foreground/40" />
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-4 p-5">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">
                    {product.name}
                  </h2>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Active ingredients
                    </h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {ingredients.map((i) => (
                        <li key={i.name}>
                          <a
                            href={wikiUrl(i)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                            title={`${i.name} on Wikipedia`}
                          >
                            {i.name}
                            <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="mt-auto">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Indications
                    </h3>
                    <ul className="list-disc space-y-1 pl-4 text-sm text-foreground/90">
                      {indications.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Ingredient names link to their Wikipedia reference articles. Always confirm
          composition against the official product literature.
        </p>
      </main>
    </div>
  );
}
