// Product images sourced from the official AMS (America Medic & Science) site.
// Keys must match the `product` field used in src/data/chunks.json.

const BASE = "https://americamedic.com/storage/catalogues/";

export const PRODUCT_IMAGES: Record<string, string> = {
  "Breast-Well": BASE + "1742212550_cf5a42661a5e4d327ba1068fe119163d.png",
  "Ova-Max": BASE + "1665047173_19fea38d542ac9893850a0873637252d.png",
  "WFS Plus": BASE + "1665047924_1545a166f8d257d50fc1df96e00cae36.png",
  "Polysitol": BASE + "1665047886_3defca1f94e5b80c21345b8478ace5db.png",
  "Preconception Plus": BASE + "1665047820_46ca12de61bdd6a6faf6062d91f89091.png",
  "MetrioMed": BASE + "1665047758_a32cd339000c1ea75431306ca907fc10.png",
  "FibroMed": BASE + "1665048079_ed656a1ddb950715b90ce7b2e79777be.png",
  "MFS Plus": BASE + "1665048090_829e5911c91f0341c226de8f5c8d4da6.png",
  "Uticyst": BASE + "1754470472_ec2b1f6f6e171be4a8cca140361d2b01.png",
  "Motility Max": BASE + "1665048228_9d52dfbc1a8be0fa9a078a0b9ebdaabb.png",
  "PenaMax": BASE + "1665048550_faafef2b83d882c268189cd2635f3d6c.png",
  "Q-Well 200mg": BASE + "1665050137_ad5a36bc4490b6466ff52a3f362c8ce0.png",
};

export function getProductImage(product: string | null | undefined): string | null {
  if (!product) return null;
  return PRODUCT_IMAGES[product] ?? null;
}
