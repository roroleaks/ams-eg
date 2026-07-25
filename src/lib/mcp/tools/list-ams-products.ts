import { defineTool } from "@lovable.dev/mcp-js";

const PRODUCTS = [
  "WFS Plus",
  "Ova-Max",
  "Polysitol",
  "Preconception Plus",
  "MetrioMed",
  "FibroMed",
  "Breast-Well",
  "Uticyst",
  "MFS Plus",
  "Motility Max",
  "PenaMax",
  "Q-Well 200mg",
];

export default defineTool({
  name: "list_ams_products",
  title: "List AMS products",
  description:
    "List the America Medic & Science (AMS) products covered by this knowledge base. Use before search_ams_guidelines when you need the exact product name to filter by.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: () => ({
    content: [{ type: "text", text: PRODUCTS.map((p) => `- ${p}`).join("\n") }],
    structuredContent: { products: PRODUCTS },
  }),
});
