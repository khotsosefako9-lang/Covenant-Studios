// Shapes shared by the checks. Checks are pure functions of an AuditContext: everything
// they need was fetched beforehand by the fetch layer, so they can be tested on fixtures.
import type { Params, ParamSpecs } from "@/core/params";
import type { PageDoc } from "./document";

/**
 * PASS/FAIL judge a website weakness. PRESENT/ABSENT record whether a marker of operating
 * scale is on the page (capacity checks only): absence is an observation, not a failure.
 */
export type CheckStatus = "PASS" | "FAIL" | "PRESENT" | "ABSENT" | "NOT_APPLICABLE" | "INDETERMINATE";
export type Severity = "info" | "low" | "medium" | "high";
/** capacity: evidence of operating scale (feeds commercial potential), never a weakness. */
export type Category = "technical" | "conversion" | "content" | "capacity";

/** The result of one extra request made for the audit (http variant, sitemap, link, PDF, profile). */
export interface Probe {
  url: string;
  /** Fetch outcome, or NOT_FETCHED when the budget/pause stopped it. */
  outcome: string;
  httpStatus: number | null;
  finalUrl: string | null;
  contentType: string | null;
  declaredLength: number | null;
  sourceRecordId: string | null;
  detail: string | null;
}

export interface AuditContext {
  doc: PageDoc;
  /** When the page was retrieved; date-relative checks use this, never the wall clock. */
  fetchedAt: Date;
  pageSourceRecordId: string | null;
  responseMs: number | null;
  /** Allowlisted response headers of the page. */
  headers: Record<string, string>;
  companyName: string | null;
  /** Result of requesting https://<domain>/ (the page itself may have come over http). */
  https: { outcome: string; detail: string | null; sourceRecordId: string | null } | null;
  httpVariant: Probe | null;
  sitemap: Probe | null;
  links: Probe[];
  pdfs: Probe[];
  social: Probe[];
}

export interface EvidenceItem {
  claim: string;
  value: string | null;
  excerpt?: string | null;
  /** Where in the document (CSS path) or which response the evidence comes from. */
  locator: string;
  /** Source record the evidence was observed in; defaults to the page. */
  sourceRecordId?: string | null;
}

export interface CheckResult {
  status: CheckStatus;
  /** 0–1, from the check's own rules. */
  confidence: number;
  detail: string;
  evidence: EvidenceItem[];
  /** A FAIL may be less severe than the check's default (never more). */
  severity?: Severity;
}

export interface CheckDefinition {
  key: string;
  name: string;
  category: Category;
  /** Default severity of a FAIL. */
  severity: Severity;
  version: string;
  description: string;
  evidenceRecorded: string;
  /** Thresholds, configurable per check (audit_checks.params); defaults live here. */
  params?: ParamSpecs;
  run(ctx: AuditContext, params: Params): CheckResult;
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };
