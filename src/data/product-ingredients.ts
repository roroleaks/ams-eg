// Active ingredients per AMS product. Each ingredient links to its Wikipedia
// article (botanical/compound reference). Verify against the official
// product literature and correct here if a formula differs.

export interface Ingredient {
  /** Display name shown to clinicians. */
  name: string;
  /** Wikipedia article title used for the hyperlink. */
  wiki: string;
}

const ing = (name: string, wiki?: string): Ingredient => ({ name, wiki: wiki ?? name });

export const PRODUCT_INGREDIENTS: Record<string, Ingredient[]> = {
  "Ova-Max": [
    ing("Melatonin"),
    ing("Coenzyme Q10", "Coenzyme_Q10"),
    ing("Myo-inositol", "Inositol"),
    ing("Folic acid", "Folic_acid"),
    ing("Vitamin E", "Vitamin_E"),
    ing("Vitamin D", "Vitamin_D"),
  ],
  "WFS Plus": [
    ing("Myo-inositol", "Inositol"),
    ing("D-chiro-inositol", "D-chiro-Inositol"),
    ing("Folic acid", "Folic_acid"),
    ing("Chromium", "Chromium"),
    ing("Vitamin D", "Vitamin_D"),
  ],
  "Preconception Plus": [
    ing("Folic acid", "Folic_acid"),
    ing("Iron", "Iron_supplement"),
    ing("Iodine", "Iodine"),
    ing("Vitamin D", "Vitamin_D"),
    ing("DHA (omega-3)", "Docosahexaenoic_acid"),
    ing("Vitamin B12", "Vitamin_B12"),
  ],
  "FibroMed": [
    ing("Green tea extract (EGCG)", "Epigallocatechin_gallate"),
    ing("Vitamin D", "Vitamin_D"),
    ing("Berberine", "Berberine"),
    ing("Curcumin", "Curcumin"),
  ],
  "MetrioMed": [
    ing("N-acetylcysteine", "Acetylcysteine"),
    ing("Curcumin", "Curcumin"),
    ing("Resveratrol", "Resveratrol"),
    ing("Green tea extract (EGCG)", "Epigallocatechin_gallate"),
    ing("Quercetin", "Quercetin"),
  ],
  "Polysitol": [
    ing("Myo-inositol", "Inositol"),
    ing("D-chiro-inositol", "D-chiro-Inositol"),
    ing("Folic acid", "Folic_acid"),
    ing("Chromium", "Chromium"),
  ],
  "Breast-Well": [
    ing("Iodine", "Iodine"),
    ing("Diindolylmethane (DIM)", "Diindolylmethane"),
    ing("Green tea extract (EGCG)", "Epigallocatechin_gallate"),
    ing("Vitamin D", "Vitamin_D"),
  ],
  "Uticyst": [
    ing("D-mannose", "Mannose"),
    ing("Cranberry extract (PACs)", "Proanthocyanidin"),
  ],
  "MFS Plus": [
    ing("L-carnitine", "Carnitine"),
    ing("Coenzyme Q10", "Coenzyme_Q10"),
    ing("Zinc", "Zinc"),
    ing("Selenium", "Selenium"),
    ing("Vitamin C", "Vitamin_C"),
    ing("Vitamin E", "Vitamin_E"),
    ing("Folic acid", "Folic_acid"),
  ],
  "Motility Max": [
    ing("L-carnitine", "Carnitine"),
    ing("Acetyl-L-carnitine", "Acetylcarnitine"),
    ing("Coenzyme Q10", "Coenzyme_Q10"),
    ing("Vitamin B12", "Vitamin_B12"),
    ing("Zinc", "Zinc"),
  ],
  "PenaMax": [
    ing("L-arginine", "Arginine"),
    ing("Tribulus terrestris", "Tribulus_terrestris"),
    ing("Panax ginseng", "Panax_ginseng"),
    ing("Maca (Lepidium meyenii)", "Lepidium_meyenii"),
    ing("Zinc", "Zinc"),
  ],
  "Q-Well 200mg": [ing("Coenzyme Q10 (ubiquinone)", "Coenzyme_Q10")],
};

export function wikiUrl(ingredient: Ingredient): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(ingredient.wiki)}`;
}
