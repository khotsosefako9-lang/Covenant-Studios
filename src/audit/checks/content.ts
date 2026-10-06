// Content and commercial-friction checks. Dates are judged against when the page was
// retrieved, never the wall clock, so a re-run of the same record gives the same answer.
import type { Element } from "domhandler";
import { normaliseCompanyName } from "@/core/identity/name";
import { pathOf, resolveHref, textOf, visible } from "../document";
import type { CheckDefinition, EvidenceItem, Probe } from "../types";
import { fail, indeterminate, notApplicable, notEnglish, pass, conf } from "./result";

const V = "1";

const SA_PLACES =
  /\b(gqeberha|port elizabeth|nelson mandela bay|east london|kariega|uitenhage|makhanda|grahamstown|mthatha|eastern cape|western cape|northern cape|free state|kwazulu-natal|kzn|gauteng|limpopo|mpumalanga|north west|cape town|johannesburg|joburg|pretoria|tshwane|durban|bloemfontein|polokwane|mbombela|nelspruit|kimberley|george|knysna|jeffreys bay|stellenbosch|paarl|centurion|sandton|midrand|soweto|pietermaritzburg|rustenburg|south africa)\b/i;
const STREET = /\b\d{1,5}\s+[a-z][a-z'. -]{1,40}\s(street|st|road|rd|avenue|ave|drive|dr|crescent|lane|close|way|boulevard|blvd|place|terrace)\b/i;
const SOCIAL_HOSTS = /^(www\.|m\.|web\.)?(facebook\.com|fb\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com|youtu\.be)$/i;

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
    confidences: {
      confidence_fail: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the FAIL result \"Nothing on the page states who the business is (no title, h1, site name, logo text or copyright line)\"" },
      confidence_pass: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PASS result \"The business name is stated\"" },
    },
    run({ doc, companyName }, cfg) {
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
        return fail("Nothing on the page states who the business is (no title, h1, site name, logo text or copyright line)", conf(cfg, "confidence_fail"), [{ claim: "No identifying element", value: null, locator: "document" }]);
      }
      if (companyName) {
        const want = normaliseCompanyName(companyName);
        const hit = want && candidates.find((c) => normaliseCompanyName(c.value).includes(want));
        if (hit) return pass("The business name is stated", conf(cfg, "confidence_pass"), [{ claim: "Business name on page", value: hit.value, locator: hit.locator }]);
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
    confidences: {
      confidence_pass_1: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the PASS result \"Address in structured data\"" },
      confidence_pass_2: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the PASS result \"A map link or embed is present\"" },
      confidence_pass_3: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the PASS result \"An address element is present\"" },
      confidence_pass_4: { default: 0.8, min: 0.1, max: 1, description: "Confidence of the PASS result \"A location is stated\"" },
      confidence_pass_5: { default: 0.7, min: 0.1, max: 1, description: "Confidence of the PASS result \"A service area is described\"" },
      confidence_fail: { default: 0.65, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No address, place name or service area found\"" },
    },
    run({ doc }, cfg) {
      const ld = doc.$("script[type='application/ld+json']").text();
      if (/"(PostalAddress|address|areaServed)"/.test(ld)) return pass("Address in structured data", conf(cfg, "confidence_pass_1"), [{ claim: "Address structured data", value: null, locator: "script[type=application/ld+json]" }]);
      const map = visible(doc, "a[href], iframe[src]").find((el) => /(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|openstreetmap\.org)/i.test(el.attribs?.href ?? el.attribs?.src ?? ""));
      if (map) return pass("A map link or embed is present", conf(cfg, "confidence_pass_2"), [{ claim: "Map link", value: map.attribs?.href ?? map.attribs?.src ?? null, locator: pathOf(map) }]);
      const address = visible(doc, "address")[0];
      if (address) return pass("An address element is present", conf(cfg, "confidence_pass_3"), [{ claim: "Address", value: textOf(doc.$, address), locator: pathOf(address) }]);
      const place = doc.text.match(SA_PLACES)?.[0] ?? doc.text.match(STREET)?.[0] ?? doc.text.match(/\bP\.?\s?O\.?\s?Box\s+\d+/i)?.[0];
      if (place) return pass("A location is stated", conf(cfg, "confidence_pass_4"), [{ claim: "Location in text", value: place, locator: "body text" }]);
      if (!doc.vocabularyReliable) return notEnglish(doc.lang);
      const area = doc.text.match(/\b(service areas?|areas we (serve|cover)|we (serve|cover|operate in))\b/i)?.[0];
      if (area) return pass("A service area is described", conf(cfg, "confidence_pass_5"), [{ claim: "Service area wording", value: area, locator: "body text" }]);
      return fail("No address, place name or service area found", conf(cfg, "confidence_fail"), [{ claim: "No location matched", value: null, locator: "body" }]);
    },
  },
  {
    key: "content.copyright_year",
    name: "Copyright year current",
    category: "content",
    severity: "low",
    version: V,
    description: "FAIL when the latest copyright year is min_lag_years (default 2) or more years before retrieval. A lagging year is a weak staleness signal, so confidence is low.",
    evidenceRecorded: "The copyright line and its latest year.",
    params: { min_lag_years: { default: 2, min: 1, max: 10, integer: true, description: "FAIL when the copyright year lags retrieval by at least this many years" } },
    confidences: {
      confidence_fail: { default: 0.5, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The copyright year is …\"" },
      confidence_pass: { default: 0.6, min: 0.1, max: 1, description: "Confidence of the PASS result \"Copyright year … is current\"" },
    },
    run({ doc, fetchedAt }, p) {
      const m = [...doc.text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)];
      if (!m.length) return notApplicable("No copyright year on the page");
      const year = Math.max(...m.map((x) => Number(x[1])));
      const now = fetchedAt.getUTCFullYear();
      const ev = [{ claim: "Copyright line", value: String(year), excerpt: m[0]?.[0] ?? null, locator: "body text" }];
      if (year > now) return indeterminate(`Copyright year ${year} is after the retrieval date`, ev);
      if (now - year >= (p.min_lag_years as number)) return fail(`The copyright year is ${year}`, conf(p, "confidence_fail"), ev);
      return pass(`Copyright year ${year} is current`, conf(p, "confidence_pass"), ev);
    },
  },
  {
    key: "content.latest_dated_content",
    name: "Most recent dated content",
    category: "content",
    severity: "low",
    version: V,
    description: "Uses only machine-readable dates (<time datetime>, published/modified meta, JSON-LD). FAIL when the newest is over max_age_months (default 24) before retrieval.",
    evidenceRecorded: "The newest date found and where.",
    params: { max_age_months: { default: 24, min: 6, max: 120, integer: true, description: "FAIL when the newest machine-readable date is older than this many months" } },
    confidences: {
      confidence_fail: { default: 0.7, min: 0.1, max: 1, description: "Confidence of the FAIL result \"The most recent dated content is from …\"" },
      confidence_pass: { default: 0.75, min: 0.1, max: 1, description: "Confidence of the PASS result \"Recently dated content present\"" },
    },
    run({ doc, fetchedAt }, p) {
      const latest = latestDate(doc);
      if (!latest) return notApplicable("The page carries no machine-readable dates");
      const ev = [{ claim: "Most recent machine-readable date", value: latest.date.toISOString().slice(0, 10), excerpt: latest.source, locator: latest.locator }];
      const months = (fetchedAt.getTime() - latest.date.getTime()) / (30.44 * 24 * 3600 * 1000);
      if (months > (p.max_age_months as number)) return fail(`The most recent dated content is from ${latest.date.toISOString().slice(0, 10)}`, conf(p, "confidence_fail"), ev);
      return pass("Recently dated content present", conf(p, "confidence_pass"), ev);
    },
  },
  {
    key: "content.heavy_catalogue",
    name: "Downloadable catalogue size",
    category: "content",
    severity: "medium",
    version: V,
    description: "Requests up to 3 linked PDFs (catalogues first) without downloading them; FAIL when a declared size exceeds max_pdf_bytes (default 10 MB).",
    evidenceRecorded: "Each PDF's URL, link text and declared Content-Length.",
    params: { max_pdf_bytes: { default: 10 * 1024 * 1024, min: 1024 * 1024, max: 500 * 1024 * 1024, integer: true, description: "FAIL when a linked PDF declares more bytes than this" } },
    confidences: {
      confidence_fail: { default: 0.9, min: 0.1, max: 1, description: "Confidence of the FAIL result \"A linked PDF is …\"" },
      confidence_pass: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the PASS result \"Linked PDFs are a manageable size\"" },
    },
    run(ctx, params) {
      if (!ctx.pdfs.length) return notApplicable("No PDF links on the page");
      const ev = ctx.pdfs.map((p) => probeEvidence(p, "Linked PDF"));
      const heavy = ctx.pdfs.filter((p) => p.declaredLength !== null && p.declaredLength > (params.max_pdf_bytes as number));
      if (heavy.length) return fail(`A linked PDF is ${mb(Math.max(...heavy.map((p) => p.declaredLength ?? 0)))}`, conf(params, "confidence_fail"), ev);
      if (ctx.pdfs.every((p) => p.declaredLength !== null)) return pass("Linked PDFs are a manageable size", conf(params, "confidence_pass"), ev);
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
    confidences: {
      confidence_fail: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the FAIL result \"No social profile links\"" },
      confidence_pass: { default: 0.95, min: 0.1, max: 1, description: "Confidence of the PASS result \"… social profile link(s)\"" },
    },
    run({ doc }, cfg) {
      const links = socialLinks(doc);
      if (!links.length) return fail("No social profile links", conf(cfg, "confidence_fail"), [{ claim: "No social profile link", value: null, locator: "body" }]);
      return pass(`${links.length} social profile link(s)`, conf(cfg, "confidence_pass"), links.map((l) => ({ claim: "Social profile link", value: l.url.toString(), locator: pathOf(l.el) })));
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
    confidences: {
      confidence_fail: { default: 0.85, min: 0.1, max: 1, description: "Confidence of the FAIL result \"A linked social profile does not exist\"" },
      confidence_pass: { default: 0.8, min: 0.1, max: 1, description: "Confidence of the PASS result \"Linked social profiles resolve\"" },
    },
    run(ctx, cfg) {
      if (!ctx.social.length) return notApplicable("No social profile links to check");
      const ev = ctx.social.map((p) => probeEvidence(p, "Social profile request"));
      if (ctx.social.some((p) => p.httpStatus === 404 || p.httpStatus === 410)) return fail("A linked social profile does not exist", conf(cfg, "confidence_fail"), ev);
      if (ctx.social.some((p) => p.outcome === "OK")) return pass("Linked social profiles resolve", conf(cfg, "confidence_pass"), ev);
      return indeterminate("The platforms did not allow the profiles to be checked", ev);
    },
  },
];
