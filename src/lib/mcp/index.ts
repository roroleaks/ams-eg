import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchAmsGuidelines from "./tools/search-ams-guidelines";
import searchMedicalLiterature from "./tools/search-medical-literature";
import listAmsProducts from "./tools/list-ams-products";

// The OAuth issuer must be the direct Supabase host; SUPABASE_URL may be
// rewritten to the .lovable.cloud proxy on publish. VITE_SUPABASE_PROJECT_ID
// is inlined by Vite at build time.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "ams-clinical-reference",
  title: "AMS Clinical Reference",
  version: "0.1.0",
  instructions:
    "Tools for grounded clinical answers on America Medic & Science (AMS) products. Use `list_ams_products` to discover product names, `search_ams_guidelines` to retrieve passages from indexed AMS product monographs (with product, section, and page citations), and `search_medical_literature` to pull recent peer-reviewed evidence from Europe PMC. Cite AMS passages by product · section · page, and cite literature by DOI or PMID.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAmsProducts, searchAmsGuidelines, searchMedicalLiterature],
});
