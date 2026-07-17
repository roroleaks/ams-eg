// Stylized product icons — one cohesive sage/cream visual language.
import wfsPlus from "@/assets/products/wfs-plus.png";
import ovaMax from "@/assets/products/ova-max.png";
import polysitol from "@/assets/products/polysitol.png";
import preconceptionPlus from "@/assets/products/preconception-plus.png";
import metrioMed from "@/assets/products/metriomed.png";
import fibroMed from "@/assets/products/fibromed.png";
import breastWell from "@/assets/products/breast-well.png";
import uticyst from "@/assets/products/uticyst.png";
import mfsPlus from "@/assets/products/mfs-plus.png";
import motilityMax from "@/assets/products/motility-max.png";
import penaMax from "@/assets/products/penamax.png";
import qWell from "@/assets/products/q-well.png";

export const PRODUCT_IMAGES: Record<string, string> = {
  "WFS Plus": wfsPlus,
  "Ova-Max": ovaMax,
  "Polysitol": polysitol,
  "Preconception Plus": preconceptionPlus,
  "MetrioMed": metrioMed,
  "FibroMed": fibroMed,
  "Breast-Well": breastWell,
  "Uticyst": uticyst,
  "MFS Plus": mfsPlus,
  "Motility Max": motilityMax,
  "PenaMax": penaMax,
  "Q-Well 200mg": qWell,
};

export function getProductImage(product: string | null | undefined): string | null {
  if (!product) return null;
  return PRODUCT_IMAGES[product] ?? null;
}
