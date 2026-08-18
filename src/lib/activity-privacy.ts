/**
 * Privacy helpers shared by the client tracker and the server logger.
 *
 * The activity layer must never retain patient-identifiable free text. Every
 * complaint value is normalised to a short clinical category before storage.
 */

const PII_PATTERNS: RegExp[] = [
  /[\w.+-]+@[\w-]+\.[\w.]+/g, // e-mail
  /\+?\d[\d\s().-]{6,}\d/g, // phone / MRN / national id
  /\b\d{1,3}\s*(?:y\/?o|yo|year[-\s]?old|yrs?|years?\s+old)\b/gi, // age
  /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/g, // dates
  /\b(mr|mrs|ms|miss|dr|patient|pt)\.?\s+[A-Z][a-z]+\b/g, // named person
  /\b\d{4,}\b/g, // long numbers (MRN, IDs)
];

const STOP = new Set([
  "the","a","an","and","or","of","to","in","for","on","with","by","is","are","be","as","at",
  "from","that","this","it","its","was","were","has","have","had","but","my","patient","case",
  "her","his","she","he","who","old","year","years","woman","man","female","male","presenting",
  "complaining","history","please","need","want","help","about",
]);

/**
 * Turns a free-text clinical query into a short, non-identifying complaint key.
 * Prefers an already-normalised clinical category when one is available.
 */
export function normalizeComplaint(query: string, preferredCategory?: string | null): string {
  const preferred = (preferredCategory ?? "").trim();
  if (preferred) return preferred.toLowerCase().slice(0, 80);

  let text = ` ${query} `;
  for (const p of PII_PATTERNS) text = text.replace(p, " ");
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  return tokens.slice(0, 8).join(" ").slice(0, 80);
}

/** Defence-in-depth scrub applied server-side before anything is persisted. */
export function scrubIdentifier(value?: string | null, max = 120): string | null {
  if (!value) return null;
  let out = value;
  for (const p of PII_PATTERNS) out = out.replace(p, " ");
  out = out.replace(/\s+/g, " ").trim();
  return out ? out.slice(0, max) : null;
}
