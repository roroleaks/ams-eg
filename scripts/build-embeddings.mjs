// Generate semantic embeddings for all chunks.
// Output: public/embeddings.bin (packed Float32, L2-normalized), src/data/embeddings-meta.json
import fs from "node:fs";
import path from "node:path";

const KEY = process.env.LOVABLE_API_KEY;
if (!KEY) throw new Error("LOVABLE_API_KEY missing");

const MODEL = "openai/text-embedding-3-small";
const DIMS = 512;
const BATCH = 96;

const chunks = JSON.parse(fs.readFileSync("src/data/chunks.json", "utf8"));
console.log("chunks:", chunks.length);

function inputFor(c) {
  const parts = [c.product, c.section, c.text].filter(Boolean);
  return parts.join(" — ").slice(0, 4000);
}

const all = new Float32Array(chunks.length * DIMS);

async function embed(batch) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: batch, dimensions: DIMS }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`embed ${res.status}: ${t.slice(0, 500)}`);
  }
  const j = await res.json();
  return j.data.map((d) => d.embedding);
}

for (let i = 0; i < chunks.length; i += BATCH) {
  const slice = chunks.slice(i, i + BATCH).map(inputFor);
  let vecs;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      vecs = await embed(slice);
      break;
    } catch (e) {
      console.warn(`retry ${attempt + 1}:`, e.message);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (!vecs) throw new Error("giving up");
  for (let k = 0; k < vecs.length; k++) {
    const v = vecs[k];
    // L2 normalize
    let n = 0;
    for (let d = 0; d < DIMS; d++) n += v[d] * v[d];
    n = Math.sqrt(n) || 1;
    const off = (i + k) * DIMS;
    for (let d = 0; d < DIMS; d++) all[off + d] = v[d] / n;
  }
  console.log(`  ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
}

fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/embeddings.bin", Buffer.from(all.buffer));
fs.writeFileSync(
  "src/data/embeddings-meta.json",
  JSON.stringify({ model: MODEL, dims: DIMS, count: chunks.length }, null, 2)
);
console.log("wrote public/embeddings.bin", all.byteLength, "bytes");
