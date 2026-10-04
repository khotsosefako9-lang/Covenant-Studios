// The check set, the pure evaluator and the probe planner. No I/O here.
import { type Params, resolveParams } from "@/core/params";
import { capacityChecks } from "./checks/capacity";
import { conversionChecks } from "./checks/conversion";
import { contentChecks, pdfLinks, socialLinks } from "./checks/content";
import { technicalChecks } from "./checks/technical";
import { type PageDoc, resolveHref, sameSite, visible } from "./document";
import type { AuditContext, CheckDefinition, CheckResult, Severity } from "./types";

/** Bump when any check's logic changes, so findings from different sets are not compared blindly. */
export const CHECK_SET_VERSION = "m0.2";

export const ALL_CHECKS: readonly CheckDefinition[] = [...technicalChecks, ...conversionChecks, ...contentChecks, ...capacityChecks];

/** Statuses each kind of check may return; anything else is reported as ERROR. */
const ALLOWED_STATUS: Record<"capacity" | "weakness", ReadonlySet<string>> = {
  capacity: new Set(["PRESENT", "ABSENT", "NOT_APPLICABLE", "INDETERMINATE"]),
  weakness: new Set(["PASS", "FAIL", "NOT_APPLICABLE", "INDETERMINATE"]),
};

/** Resolved parameters for every check: stored values (audit_checks.params) over code defaults. Throws on an invalid row. */
export function resolveCheckParams(stored: Readonly<Record<string, unknown>> = {}): Record<string, Params> {
  return Object.fromEntries(ALL_CHECKS.map((c) => [c.key, resolveParams(c.params, stored[c.key], `audit check ${c.key}`)]));
}

export interface EvaluatedCheck {
  check: CheckDefinition;
  result: CheckResult | { status: "ERROR"; confidence: 0; detail: string; evidence: [] };
  /** Severity of a FAIL (the check's default, or a lower override); null otherwise. */
  severity: Severity | null;
}

const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };

/**
 * Runs every enabled check. One check throwing never stops the others. `params` holds
 * resolved parameters per check key (see resolveCheckParams); a check without an entry
 * runs on its code defaults.
 */
export function evaluate(ctx: AuditContext, enabled: ReadonlySet<string> | null = null, params: Readonly<Record<string, Params>> = {}): EvaluatedCheck[] {
  return ALL_CHECKS.filter((c) => !enabled || enabled.has(c.key)).map((check) => {
    try {
      const result = check.run(ctx, params[check.key] ?? resolveParams(check.params, undefined, check.key));
      const kind = check.category === "capacity" ? "capacity" : "weakness";
      if (!ALLOWED_STATUS[kind].has(result.status)) throw new Error(`a ${kind} check may not return ${result.status}`);
      const override = result.severity && RANK[result.severity] <= RANK[check.severity] ? result.severity : check.severity;
      return { check, result, severity: result.status === "FAIL" ? override : null };
    } catch (e) {
      return {
        check,
        result: { status: "ERROR" as const, confidence: 0 as const, detail: `Check failed to run: ${e instanceof Error ? e.message : String(e)}`, evidence: [] as [] },
        severity: null,
      };
    }
  });
}

const ASSET = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|xml|txt)$/i;

export interface ProbePlan {
  links: string[];
  pdfs: string[];
  social: string[];
}

/** Which extra URLs the audit will request, chosen deterministically from the page. */
export function planProbes(doc: PageDoc, limits = { links: 5, pdfs: 3, social: 4 }): ProbePlan {
  const links: string[] = [];
  for (const el of visible(doc, "a[href]")) {
    const u = resolveHref(doc, el.attribs?.href);
    if (!u || !/^https?:$/.test(u.protocol) || !sameSite(u, doc.url) || ASSET.test(u.pathname)) continue;
    u.hash = "";
    const s = u.toString();
    if (s === doc.url.toString() || links.includes(s)) continue;
    links.push(s);
    if (links.length >= limits.links) break;
  }
  return {
    links,
    pdfs: pdfLinks(doc).slice(0, limits.pdfs).map((p) => p.url.toString()),
    social: socialLinks(doc).slice(0, limits.social).map((s) => s.url.toString()),
  };
}

/** Sitemap URLs declared in robots.txt ("Sitemap:" lines). */
export function sitemapsFromRobots(robotsTxt: string | null): string[] {
  if (!robotsTxt) return [];
  return [...robotsTxt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1] as string);
}
