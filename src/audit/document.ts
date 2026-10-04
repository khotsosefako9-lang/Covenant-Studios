// The parsed page every check reads. Pure: no I/O. Parsing uses cheerio/slim, which has
// no network code; the audit layer never fetches anything itself.
import { type CheerioAPI, load } from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";

/** Elements whose content is never visible text. */
const NON_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "title", "iframe", "object", "canvas"]);

/** Reading-order offset below which an element is in the "first screen" of markup. */
export const FIRST_SCREEN_CHARS = 700;

const ENGLISH_MARKERS = new Set([
  "the", "and", "to", "of", "for", "our", "we", "you", "your", "with", "in", "is", "a", "are", "on", "us", "contact", "about",
]);

export interface PageDoc {
  $: CheerioAPI;
  url: URL;
  html: string;
  /** All visible text, whitespace-collapsed. */
  text: string;
  /** Visible text outside any link: what a visitor can read but not tap. */
  unlinkedText: string;
  wordCount: number;
  /** Offset in visible, non-navigation text at which each element starts. */
  offsets: Map<Element, number>;
  lang: string | null;
  /**
   * Whether English-vocabulary checks (CTA wording, trust words, ...) can be trusted on this
   * page. False for pages declared or detected as another language: those checks return
   * INDETERMINATE rather than firing on words they cannot read.
   */
  vocabularyReliable: boolean;
}

function isHiddenElement(el: Element): boolean {
  const a = el.attribs ?? {};
  if ("hidden" in a) return true;
  if (a["aria-hidden"] === "true") return true;
  if (el.name === "input" && (a.type ?? "").toLowerCase() === "hidden") return true;
  const style = (a.style ?? "").replace(/\s+/g, "").toLowerCase();
  return style.includes("display:none") || style.includes("visibility:hidden");
}

function isNavigation(el: Element): boolean {
  return el.name === "nav" || el.attribs?.role === "navigation";
}

export function parseDocument(html: string, url: string): PageDoc {
  const $ = load(html);
  const offsets = new Map<Element, number>();
  const parts: string[] = [];
  const unlinked: string[] = [];
  let offset = 0;

  const walk = (node: AnyNode, inNav: boolean, inLink = false): void => {
    if (node.type === "text") {
      const t = (node as unknown as { data: string }).data.replace(/\s+/g, " ");
      if (t.trim()) {
        parts.push(t);
        if (!inLink) unlinked.push(t);
        if (!inNav) offset += t.trim().length + 1;
      }
      return;
    }
    if (node.type !== "tag" && node.type !== "root" && node.type !== "script" && node.type !== "style") return;
    if (node.type === "tag") {
      const el = node as Element;
      if (NON_TEXT.has(el.name) || isHiddenElement(el)) {
        offsets.set(el, offset);
        return;
      }
      offsets.set(el, offset);
      const nav = inNav || isNavigation(el);
      const link = inLink || (el.name === "a" && el.attribs?.href !== undefined);
      for (const child of el.children) walk(child, nav, link);
      if (/^(p|div|li|h[1-6]|section|article|br|tr|td|header|footer)$/.test(el.name)) {
        parts.push(" ");
        unlinked.push(" ");
      }
      return;
    }
    if (node.type === "root") for (const child of (node as unknown as { children: AnyNode[] }).children) walk(child, inNav);
  };
  const body = $("body").get(0);
  if (body) walk(body, false);
  else walk($.root().get(0) as AnyNode, false);

  const text = parts.join("").replace(/\s+/g, " ").trim();
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  const lang = ($("html").attr("lang") ?? "").trim().toLowerCase() || null;
  const englishShare = words.length ? words.filter((w) => ENGLISH_MARKERS.has(w)).length / words.length : 0;
  const vocabularyReliable = lang ? lang.startsWith("en") && englishShare >= 0.03 : words.length < 20 || englishShare >= 0.06;

  const unlinkedText = unlinked.join("").replace(/\s+/g, " ").trim();
  return { $, url: new URL(url), html, text, unlinkedText, wordCount: words.length, offsets, lang, vocabularyReliable };
}

/** A readable CSS path to an element, e.g. "body > header > nav > a:nth-of-type(3)". */
export function pathOf(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.type === "tag" && cur.name !== "html") {
    let part = cur.name;
    if (cur.attribs?.id) {
      parts.unshift(`${part}#${cur.attribs.id}`);
      break;
    }
    const parent = cur.parent as Element | null;
    if (parent && "children" in parent) {
      const same = parent.children.filter((c) => c.type === "tag" && (c as Element).name === cur?.name);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    cur = parent && parent.type === "tag" ? parent : null;
  }
  return parts.join(" > ");
}

/** Outer HTML of an element, shortened for evidence. */
export function excerptOf($: CheerioAPI, el: Element, max = 200): string {
  const h = ($.html(el) ?? "").replace(/\s+/g, " ").trim();
  return h.length > max ? `${h.slice(0, max - 1)}…` : h;
}

export function textOf($: CheerioAPI, el: Element): string {
  return $(el).text().replace(/\s+/g, " ").trim();
}

/** Visible elements matching a selector, in document order. */
export function visible(doc: PageDoc, selector: string): Element[] {
  return doc
    .$(selector)
    .toArray()
    .filter((el): el is Element => el.type === "tag" && doc.offsets.has(el) && !hasHiddenAncestor(el));
}

function hasHiddenAncestor(el: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur.type === "tag") {
    if (isHiddenElement(cur)) return true;
    cur = cur.parent && cur.parent.type === "tag" ? (cur.parent as Element) : null;
  }
  return false;
}

/** Resolve an href against the page; null for javascript:, empty or unparseable values. */
export function resolveHref(doc: PageDoc, href: string | undefined): URL | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("#") || /^javascript:/i.test(h)) return null;
  try {
    return new URL(h, doc.url);
  } catch {
    return null;
  }
}

/** Same site: same host, ignoring a leading "www.". */
export function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.replace(/^www\./, "");
  return strip(a.hostname) === strip(b.hostname);
}

export const SA_PHONE = /(?:\+27|\b0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}\b/;
export const EMAIL = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i;
