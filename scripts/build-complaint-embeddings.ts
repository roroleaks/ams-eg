// Precompute embeddings for every complaint in the Excel-derived product DB.
// Output: public/complaint-embeddings.bin (Float32, L2-normalized, row-major)
import fs from "node:fs";
import { COMPLAINT_INDEX } from "../src/data/complaints";

const KEY = process.env.LOVABLE_API_KEY;
if (!KEY) throw new Error("LOVABLE_API_KEY missing");

const MODEL = "openai/text-embedding-3-small";
const DIMS = 512;

const inputs = COMPLAINT_INDEX.map((c) => `${c.product}: ${c.matchText}`);
console.log("complaints:", inputs.length);

const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ model: MODEL, input: inputs, dimensions: DIMS }),
});
if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 400)}`);
const j = (await res.json()) as { data: { embedding: number[] }[] };

const all = new Float32Array(inputs.length * DIMS);
j.data.forEach((d, i) => {
  const v = d.embedding;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let k = 0; k < DIMS; k++) all[i * DIMS + k] = v[k] / n;
});

fs.writeFileSync("public/complaint-embeddings.bin", Buffer.from(all.buffer));
fs.writeFileSync(
  "src/data/complaint-embeddings-meta.json",
  JSON.stringify({ model: MODEL, dims: DIMS, count: inputs.length }, null, 2),
);
console.log("wrote public/complaint-embeddings.bin", all.byteLength);
