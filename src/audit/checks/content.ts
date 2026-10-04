// Content and commercial-friction checks. Dates are judged against when the page was
// retrieved, never the wall clock, so a re-run of the same record gives the same answer.
import type { Element } from "domhandler";
import { normaliseCompanyName } from "@/core/identity/name";
import { pathOf, resolveHref, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem, Probe } from "../types";
import { fail, indeterminate, notApplicable, notEnglish, pass } from "./result";

const V = "1";

const SA_PLACES =
  /\b(gqeberha|port elizabeth|nelson mandela bay|east london|kariega|uitenhage|makhanda|grahamstown|mthatha|eastern cape|western cape|northern cape|free state|kwazulu-natal|kzn|gauteng|limpopo|mpumalanga|north west|cape town|johannesburg|joburg|pretoria|tshwane|durban|bloemfontein|polokwane|mbombela|nelspruit|kimberley|george|knysna|jeffreys bay|stellenbosch|paarl|centurion|sandton|midrand|soweto|pietermaritzburg|rustenburg|south africa)\b/i;
const STREET = /\b\d{1,5}\s+[a-z][a-z'. -]{1,40}\s(street|st|road|rd|avenue|ave|drive|dr|crescent|lane|close|way|boulevard|blvd|place|terrace)\b/i;
const SOCIAL_HOSTS = /^(www\.|m\.|web\.)?(facebook\.com|fb\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|youtu\.be)$/i;
const CATALOGUE_LIMIT_BYTES = 10 * 1024 * 1024;

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const probeEvidence = (p: Probe, claim: string): EvidenceItem => ({
  claim,
  value: `${p.outcome}${p.httpStatus ? ` ${p.httpStatus}` : ""}${p.declaredLength !== null ? `, ${p.declaredLength} bytes declared` : ""}`,
  excerpt: p.contentType,
  locator: `GET ${p.url}`,
  sourceRecordId: p.sourceRecordId,
});

export function socialLinks(doc: Parameters<typeof visible>[0]): { el: Element; url: URL }[] {
  const out: { el: Element; url: URL }[] = [];
  const seen = new Set<string>();
  for (const el of visible(doc, "a[href]")) {
    const u = resolveHref(doc, el.attribs?.href);
    if (!u || !SOCIAL_HOSTS.test(u.hostname) || u.pathname.replace(/\/+$/, "") === "") continue;
    if (/\/(sharer|share|intent)\b/.test(u.pathname)) continue; // share buttons are not profiles
    const key = `${u.hostname}${u.pathname}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ el, url: u });
  }
  return out;
}

export function pdfLinks(doc: Parameters<typeof visible>[0]): { el: Element; url: URL; label: string }[] {
  const out: { el: Element; url: URL; label: string }[] = [];
  const seen = new Set<string>();
  for (const el of visible(doc, "a[href]")) {
    const u = resolveHref(doc, el.attribs?.href);
    if (!u || !/\.pdf$/i.test(u.pathname) || seen.has(u.toString())) continue;
    seen.add(u.toString());
    out.push({ el, url: u, label: textOf(doc.$, el) });
  }
  // Catalogue-like documents first.
  return out.sort((a, b) => Number(/catalog|brochure|price|product|range/i.test(b.label + b.url.pathname)) - Number(/catalog|brochure|price|product|range/i.test(a.label + a.url.pathname)));
}

function latestDate(doc: Parameters<typeof visible>[0]): { date: Date; source: string; locator: string } | null {
  const found: { date: Date; source: string; locator: string }[] = [];
  const add = (raw: string | undefined, source: string, locator: string) => {
    if (!raw) return;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) found.push({ date: d, source: raw, locator });
  };
  for (const el of doc.$("time[datetime]").toArray() as Element[]) add(el.attribs.datetime, el.attribs.datetime ?? "", pathOf(el));
  for (const prop of ["article:published_time", "article:modified_time", "og:updated_time"]) {
    const el = doc.$(`meta[property='${prop}']`).get(0) as Element | undefined;
    if (el) add(el.attribs.content, `${prop}=${el.attribs.content}`, pathOf(el));
  }
  const ld = doc.$("script[type='application/ld+json']").text();
  for (const m of ld.matchAll(/"(datePublished|dateModified)"\s*:\s*"([^"]+)"/g)) add(m[2], `${m[1]}=${m[2]}`, "script[type=application/ld+json]");
  if (!found.length) return null;
  return found.sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;
}

export const contentChecks: CheckDefinition[] = [
  {
    key: "content.business_identity",
    name: "Business identity clear",
    category: "content",
    severity: "low",
    version: V,
    description: "PASS when the company's name appears in the title, h1, og:site_name, logo alt text or copyright line. FAIL only when none of those elements exist.",
    evidenceRecorded: "The element in which the name was found, or the identifying elements present.",
    run({ doc, companyName }) {
      const $ = doc.$;
      const candidates: { value: string; locator: string }[] = [];
      const push = (value: string | undefined, locator: string) => {
        if (value?.trim()) candidates.push({ value: value.replace(/\s+/g, " ").trim(), locator });
      };
      push($("title").first().text(), "head > title");
      for (const h of visible(doc, "h1")) push(textOf($, h), pathOf(h));
      push($("meta[property='og:site_name']").attr("content"), "meta[property=og:site_name]");
      for (const img of visible(doc, "header img[alt], a img[alt], img[class*='logo' i][alt], img[id*='logo' i][alt]")) push(img.attribs?.alt, pathOf(img));
      const copyright = doc.text.match(/(©|copyright)[^.|\n]{0,80}/i)?.[0];
      push(copyright, "body text (copyright line)");
      if (!candidates.length) {
        return fail("Nothing on the page states who the business is (no title, h1, site name, logo text or copyright line)", 0.85, [{ claim: "No identifying element", value: null, locator: "document" }]);
      }
      if (companyName) {
        const want = normaliseCompanyName(companyName);
        const hit = want && candidates.find((c) => normaliseCompanyName(c.value).includes(want));
        if (hit) return pass("The business name is stated", 0.9, [{ claim: "Business name on page", value: hit.value, locator: hit.locator }]);
      }
      return indeterminate("Identifying elements exist but the recorded company name was not matched (the trading name may differ)", candidates.slice(0, 3).map((c) => ({ claim: "Identifying element", value: c.value, locator: c.locator })));
    },
  },
  {
    key: "content.location_stated",
    name: "Location or service area stated",
    category: "content",
    severity: "low",
    version: V,
    description: "PASS for an address, a South African place name, a service-area statement, postal-address structured data or a maps link.",
    evidenceRecorded: "The place, address or map link found.",
    run({ doc }) {
      const ld = doc.$("script[type='application/ld+json']").text();
      if (/"(PostalAddress|address|areaServed)"/.test(ld)) return pass("Address in structured data", 0.9, [{ claim: "Address structured data", value: null, locator: "script[type=application/ld+json]" }]);
      const map = visible(doc, "a[href], iframe[src]").find((el) => /(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org)/i.test(el.attribs?.href ?? el.attribs?.src ?? ""));
      if (map) return pass("A map link or embed is present", 0.85, [{ claim: "Map link", value: map.attribs?.href ?? map.attribs?.src ?? null, locator: pathOf(map) }]);
      const address = visible(doc, "address")[0];
      if (address) return pass("An address element is present", 0.85, [{ claim: "Address", value: textOf(doc.$, address), locator: pathOf(address) }]);
      const place = doc.text.match(SA_PLACES)?.[0] ?? doc.text.match(STREET)?.[0] ?? doc.text.match(/\bP\.?\s?O\.?\s?Box\s+\d+/i)?.[0];
      if (place) return pass("A location is stated", 0.8, [{ claim: "Location in text", value: place, locator: "body text" }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const area = doc.text.match(/\b(service areas?|areas we (serve|cover)|we (serve|cover|operate in))\b/i)?.[0];
      if (area) return pass("A service area is described", 0.7, [{ claim: "Service area wording", value: area, locator: "body text" }]);
      return fail("No address, place name or service area found", 0.65, [{ claim: "No location matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "content.copyright_year",
    name: "Copyright year current",
    category: "content",
    severity: "low",
    version: V,
    description: "FAIL when the latest copyright year is two or more years before retrieval. A lagging year is a weak staleness signal, so confidence is low.",
    evidenceRecorded: "The copyright line and its latest year.",
    run({ doc, fetchedAt }) {
      const m = [...doc.text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)];
      if (!m.length) return notApplicable("No copyright year on the page");
      const year = Math.max(...m.map((x) => Number(x[1])));
      const now = fetchedAt.getUTCFullYear();
      const ev = [{ claim: "Copyright line", value: String(year), excerpt: m[0]?.[0] ?? null, locator: "body text" }];
      if (year > now) return indeterminate(`Copyright year ${year} is after the retrieval date`, ev);
      if (now - year >= 2) return fail(`The copyright year is ${year}`, 0.5, ev);
      return pass(`Copyright year ${year} is current`, 0.6, ev);
    },
  },
  {
    key: "content.latest_dated_content",
    name: "Most recent dated content",
    category: "content",
    severity: "low",
    version: V,
    description: "Uses only machine-readable dates (<time datetime>, published/modified meta, JSON-LD). FAIL when the newest is over 24 months before retrieval.",
    evidenceRecorded: "The newest date found and where.",
    run({ doc, fetchedAt }) {
      const latest = latestDate(doc);
      if (!latest) return notApplicable("The page carries no machine-readable dates");
      const ev = [{ claim: "Most recent machine-readable date", value: latest.date.toISOString().slice(0, 10), excerpt: latest.source, locator: latest.locator }];
      const months = (fetchedAt.getTime() - latest.date.getTime()) / (30.44 * 24 * 3600 * 1000);
      if (months > 24) return fail(`The most recent dated content is from ${latest.date.toISOString().slice(0, 10)}`, 0.7, ev);
      return pass("Recently dated content present", 0.75, ev);
    },
  },
  {
    key: "content.heavy_catalogue",
    name: "Downloadable catalogue size",
    category: "content",
    severity: "medium",
    version: V,
    description: `Requests up to 3 linked PDFs (catalogues first) without downloading them; FAIL when a declared size exceeds ${CATALOGUE_LIMIT_BYTES / 1024 / 1024} MB.`,
    evidenceRecorded: "Each PDF's URL, link text and declared Content-Length.",
    run(ctx) {
      if (!ctx.pdfs.length) return notApplicable("No PDF links on the page");
      const ev = ctx.pdfs.map((p) => probeEvidence(p, "Linked PDF"));
      const heavy = ctx.pdfs.filter((p) => p.declaredLength !== null && p.declaredLength > CATALOGUE_LIMIT_BYTES);
      if (heavy.length) return fail(`A linked PDF is ${mb(Math.max(...heavy.map((p) => p.declaredLength ?? 0)))}`, 0.9, ev);
      if (ctx.pdfs.every((p) => p.declaredLength !== null)) return pass("Linked PDFs are a manageable size", 0.85, ev);
      return indeterminate("Some linked PDFs did not declare a size or could not be requested", ev);
    },
  },
  {
    key: "content.social_links",
    name: "Social profile links",
    category: "content",
    severity: "info",
    version: V,
    description: "PASS for links to Facebook, Instagram, LinkedIn, X, TikTok or YouTube profiles (share buttons excluded).",
    evidenceRecorded: "The profile URLs found.",
    run({ doc }) {
      const links = socialLinks(doc);
      if (!links.length) return fail("No social profile links", 0.85, [{ claim: "No social profile link", value: null, locator: "body" }]);
      return pass(`${links.length} social profile link(s)`, 0.95, links.map((l) => ({ claim: "Social profile link", value: l.url.toString(), locator: pathOf(l.el) })));
    },
  },
  {
    key: "content.social_links_resolve",
    name: "Social profile links resolve",
    category: "content",
    severity: "low",
    version: V,
    description: "Requests up to 4 linked profiles. FAIL only on 404/410. Platforms that refuse automated access give INDETERMINATE.",
    evidenceRecorded: "Each profile request's outcome.",
    run(ctx) {
      if (!ctx.social.length) return notApplicable("No social profile links to check");
      const ev = ctx.social.map((p) => probeEvidence(p, "Social profile request"));
      if (ctx.social.some((p) => p.httpStatus === 404 || p.httpStatus === 410)) return fail("A linked social profile does not exist", 0.85, ev);
      if (ctx.social.some((p) => p.outcome === "OK")) return pass("Linked social profiles resolve", 0.8, ev);
      return indeterminate("The platforms did not allow the profiles to be checked", ev);
    },
  },
];
