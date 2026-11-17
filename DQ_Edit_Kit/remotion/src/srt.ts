// SRT -> timed words. Descript gives phrase-level timings; each word gets a share of its
// phrase's time in proportion to its length, which is close enough for word-pop captions.
export type Word = {text: string; start: number; end: number; key: boolean};

const toSec = (s: string) => { const [h, m, rest] = s.trim().split(':'); const [sec, ms] = rest.split(','); return +h * 3600 + +m * 60 + +sec + +ms / 1000; };
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, '');

export function parseSrt(srt: string, keywords: string[]): Word[] {
  const keys = new Set(keywords.map(norm));
  const words: Word[] = [];
  for (const block of srt.trim().split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const tl = lines.find((l) => l.includes('-->')); if (!tl) continue;
    const [a, b] = tl.split('-->').map(toSec);
    const text = lines.slice(lines.indexOf(tl) + 1).join(' ').trim();
    const ws = text.split(/\s+/).filter(Boolean);
    const weights = ws.map((w) => Math.max(2, w.replace(/[^\w]/g, '').length) + 1.5);
    const total = weights.reduce((x, y) => x + y, 0);
    let t = a;
    ws.forEach((w, i) => { const d = (b - a) * weights[i] / total; words.push({text: w, start: t, end: t + d, key: keys.has(norm(w))}); t += d; });
  }
  return words;
}

// Group words into short caption chunks: max 3 words, break after punctuation or a pause.
export function chunk(words: Word[]): Word[][] {
  const out: Word[][] = []; let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const pause = next ? next.start - w.end > 0.25 : true;
    if (cur.length >= 3 || /[.,?!]$/.test(w.text) || pause) { out.push(cur); cur = []; }
  });
  if (cur.length) out.push(cur);
  return out;
}
