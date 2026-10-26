/** Deterministic, conservative clinical evidence rules shared with regression tests. */
export interface EvidenceCandidate {
  title: string;
  abstract: string;
  pubType: string;
  year: string;
  doi?: string | null;
  pmid?: string | null;
  pmcid?: string | null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[‐‑–—]/g, "-").replace(/[^a-z0-9]+/g, " ").trim();
export function mentions(text: string, phrase: string): boolean {
  const p = normalize(phrase);
  return !!p && (` ${normalize(text)} `).includes(` ${p} `);
}

const NOTICE = /\b(retract(?:ed|ion)|erratum|corrigendum|expression of concern|author'?s? reply|study protocol)\b|^(?:correction|comment|letter|reply)\b/i;
const PRECLINICAL = /\b(mice|mouse|murine|rats?|rodents?|zebrafish|rabbits?|chickens?|roosters?|poultry|broilers?|heifers?|bovine|porcine|livestock|cell lines?|cell culture|granulosa cells|animal model|in vitro study|in vitro experiment)\b/i;
const SYSTEMATIC = /\b(systematic (?:review|literature review)|meta[ -]analys(?:is|es)|practice guideline|consensus statement)\b/i;
const TRIAL = /\b(randomi[sz]ed(?: controlled)? (?:clinical )?(?:trial|study)|randomi[sz]ed[ ,\w-]{0,50}(?:placebo|double[ -]blind|controlled)|placebo[ -]controlled|double[ -]blind)\b/i;

export function evidenceTier(i: EvidenceCandidate): number {
  if (NOTICE.test(i.title) || /\b(protocol|preprint|editorial|letter|comment|retracted publication|retraction of publication)\b/i.test(i.pubType)) return 9;
  if (PRECLINICAL.test(i.title) || PRECLINICAL.test(i.abstract)) return 9;
  // A narrative review is not an RCT just because it discusses randomized trials.
  if (/\b(narrative|scoping|umbrella) review\b/i.test(i.title)) return 9;
  if (SYSTEMATIC.test(i.title) || /^(?:.*;\s*)?(?:Guideline|Practice Guideline|Consensus Development Conference|Systematic Review|Meta-Analysis)(?:;|$)/i.test(i.pubType)) return 1;
  const methods = i.abstract.match(/\b(?:materials and methods|methods?|methodology|study design|design)\s*[:.]?\s*([\s\S]*?)(?=\b(?:results?|conclusions?)\s*[:.]|$)/i)?.[1] ?? "";
  if (/\b(non[ -]randomi[sz]ed|observational|retrospective|single[ -]arm)\b/i.test(`${i.title} ${methods}`)) return 9;
  if (PRECLINICAL.test(methods)) return 9;
  if (/\breview\b/i.test(i.pubType) || /\b(?:literature|narrative|scoping) review\b/i.test(methods)) {
    return /\bsystematic\b/i.test(methods) && /\b(search|database|studies|trials)\b/i.test(methods) ? 1 : 9;
  }
  if (/\brandomi[sz]ed controlled trial\b/i.test(i.pubType) || TRIAL.test(i.title)) return 2;
  if (/\bsystematic\b/i.test(methods) && /\b(search|database|review)\b/i.test(methods)) return 1;
  // Require the paper's own allocation/design, not background references to RCTs.
  if (TRIAL.test(methods) || /\b(?:patients|women|men|participants|subjects)\b[^.!?]{0,120}\b(?:randomly assigned|randomi[sz]ed|randomly allocated)\b/i.test(i.abstract)) return 2;
  return 9;
}

export function qualifiesEvidence(i: EvidenceCandidate, phrases: string[], core: string[], ingredients: string[], from: number, to: number): boolean {
  const year = Number(i.year);
  if (!/^\d{4}$/.test(i.year) || year < from || year > to || i.abstract.length <= 50 || !i.title.trim()) return false;
  if (!i.doi && !i.pmid && !i.pmcid) return false;
  if (NOTICE.test(i.title) || evidenceTier(i) > 2) return false;
  const topic = (text: string) => phrases.some(p => mentions(text, p)) || (core.length > 0 && core.every(t => mentions(text, t)));
  // Both must occur in the abstract: a wrongly associated publisher abstract must
  // never inherit evidence strength or relevance from its unrelated title.
  if (!topic(i.abstract) || !ingredients.some(t => mentions(i.abstract, t))) return false;
  // Biomarker/prevalence surveys are not evidence of administering the ingredient.
  if (!/\b(supplement(?:s|ation|ed)?|treat(?:ment|ed|ing)?|therap(?:y|ies|eutic)|administ(?:ered|ration)|intervention|efficacy|placebo|prophylaxis|prevention|safety|adverse)\b/i.test(i.abstract)) return false;
  const sentences = i.abstract.split(/(?<=[.!?])\s+|\n/);
  return sentences.some(s => topic(s) && ingredients.some(t => mentions(s, t))) ||
    (topic(i.title) && ingredients.some(t => mentions(i.title, t)));
}

export function dedupeEvidenceRaw(list: Record<string, unknown>[]): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  const ids = (r: Record<string, unknown>) => [
    r.doi ? `doi:${String(r.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase().trim()}` : "",
    r.pmid ? `pmid:${r.pmid}` : "",
    r.pmcid ? `pmc:${r.pmcid}` : "",
    r.title ? `title:${normalize(String(r.title))}` : "",
  ].filter(Boolean);
  const quality = (r: Record<string, unknown>) =>
    (r.source === "Europe PMC" || r.source === "PubMed" ? 100000 : r.source === "Semantic Scholar" ? 10000 : r.source === "OpenAlex" ? 5000 : 0) + Math.min(String(r.abstractText ?? "").length, 4000);
  for (const r of list) {
    if (!r.title) continue;
    const keys = ids(r);
    const matches = entries.filter(e => ids(e).some(k => keys.includes(k)));
    const copies = [r, ...matches].sort((a,b) => quality(b) - quality(a));
    const best = copies[0];
    if (!best) continue;
    const merged = { ...best };
    for (const copy of copies) for (const key of ["doi", "pmid", "pmcid"]) if (!merged[key] && copy[key]) merged[key] = copy[key];
    for (const match of matches) entries.splice(entries.indexOf(match), 1);
    entries.push(merged);
  }
  return entries;
}