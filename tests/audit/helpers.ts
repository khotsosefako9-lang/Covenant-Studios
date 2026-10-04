// Builds AuditContexts from fixture HTML, with realistic "healthy" probe results by default.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "@/audit/document";
import { evaluate, planProbes } from "@/audit/registry";
import type { AuditContext, Probe } from "@/audit/types";

export const FIXTURES = join(__dirname, "fixtures");
export const fixture = (path: string) => readFileSync(join(FIXTURES, path), "utf8");

export const FETCHED_AT = new Date("2026-10-01T10:00:00Z");

export const probe = (url: string, over: Partial<Probe> = {}): Probe => ({
  url,
  outcome: "OK",
  httpStatus: 200,
  finalUrl: url,
  contentType: "text/html; charset=utf-8",
  declaredLength: null,
  sourceRecordId: null,
  detail: null,
  ...over,
});

export function ctxFor(html: string, over: Partial<AuditContext> & { url?: string } = {}): AuditContext {
  const url = over.url ?? "https://example.co.za/";
  const doc = parseDocument(html, url);
  const plan = planProbes(doc);
  const origin = new URL(url).origin;
  return {
    doc,
    fetchedAt: FETCHED_AT,
    pageSourceRecordId: null,
    responseMs: 420,
    headers: { "content-type": "text/html; charset=utf-8" },
    companyName: null,
    https: { outcome: "OK", detail: null, sourceRecordId: null },
    httpVariant: probe(url.replace("https://", "http://"), { finalUrl: url }),
    sitemap: probe(`${origin}/sitemap.xml`, { contentType: "application/xml" }),
    links: plan.links.map((l) => probe(l)),
    pdfs: plan.pdfs.map((p) => probe(p, { outcome: "UNSUPPORTED_CONTENT_TYPE", contentType: "application/pdf", declaredLength: 2_400_000 })),
    // Social platforms refuse automated access: realistic default.
    social: plan.social.map((s) => probe(s, { outcome: "SOURCE_BLOCKED", httpStatus: null, finalUrl: null, contentType: null })),
    ...over,
    ...(over.url ? {} : {}),
  };
}

export const run = (html: string, over: Parameters<typeof ctxFor>[1] = {}) => evaluate(ctxFor(html, over));

export const statusOf = (results: ReturnType<typeof run>, key: string) => {
  const r = results.find((x) => x.check.key === key);
  if (!r) throw new Error(`no result for ${key}`);
  return r.result.status;
};
