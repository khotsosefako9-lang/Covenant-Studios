// Company-name normalisation and similarity. Pure: no I/O.
// Normalised names are for matching only; they never decide a merge.

// South African and common legal-form suffixes, longest first so "(pty) ltd" wins over "ltd".
const LEGAL_SUFFIXES = [
  "proprietary limited",
  "pty ltd",
  "pty limited",
  "soc ltd",
  "soc limited",
  "public limited",
  "limited",
  "ltd",
  "npc",
  "inc",
  "cc",
  "rf",
  "llc",
  "plc",
] as const;

/** Split "Legal Name (Pty) Ltd t/a Trading Name" into its two names. */
export function splitTradingAs(input: string): { name: string; tradingAs: string | null } {
  const m = input.match(/^(.*?)\s+(?:t\/a|ta|trading\s+as)\s+(.+)$/i);
  if (!m) return { name: input.trim(), tradingAs: null };
  return { name: (m[1] as string).trim(), tradingAs: (m[2] as string).trim() };
}

/**
 * Lower case, strip diacritics, "&" → "and", drop punctuation, collapse whitespace,
 * drop a leading "the" and trailing legal-form suffixes. Words such as "group",
 * "digital" or "marketing" are kept: they are what tells similar businesses apart.
 */
export function normaliseCompanyName(input: string): string {
  let s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s === suffix) break;
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
        break;
      }
    }
  }
  if (s.startsWith("the ") && s.length > 4) s = s.slice(4);
  return s;
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.split(" ").filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Trigram similarity in [0, 1] (Jaccard, pg_trgm-style word padding) of two normalised names. */
export function nameSimilarity(a: string, b: string): number {
  if (a === b) return a === "" ? 0 : 1;
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}
