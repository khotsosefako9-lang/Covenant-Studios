// "Where did this come from?" Every claim resolves backwards to the retrieval it was
// observed in. Read-only; freshness is computed here, at read time.
import { and, eq, like } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type Freshness, type RefreshWindows, dataClassOf, freshness } from "@/core/freshness";
import { inCompanyCluster } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";

type Db = NodePgDatabase<typeof s>;

export interface FreshnessConfig {
  windows: RefreshWindows;
  recencyFloor: number;
}

export async function loadFreshnessConfig(db: Db): Promise<FreshnessConfig> {
  const rows = await db.select().from(s.settings);
  const get = (k: "freshness_refresh_days" | "confidence_recency_floor") => {
    const row = rows.find((r) => r.key === k);
    if (!row) throw new Error(`Setting ${k} is missing; run npm run db:setup`);
    return row.value;
  };
  return {
    windows: parseSetting("freshness_refresh_days", get("freshness_refresh_days")),
    recencyFloor: parseSetting("confidence_recency_floor", get("confidence_recency_floor")),
  };
}

export interface SourceInfo {
  id: string;
  /** What kind of retrieval: http_fetch, csv_import, manual_entry, operator_statement. */
  method: string;
  /** The URL fetched, or the file name, or "manual entry by X". Never empty. */
  location: string;
  retrievedAt: Date;
  outcome: string;
  httpStatus: number | null;
  attributedTo: string | null;
  contentHash: string | null;
  userAgent: string | null;
  robotsRecordId: string | null;
}

export interface Chain {
  claim: {
    evidenceId: string;
    companyId: string;
    claimKey: string;
    claim: string;
    claimType: string;
    value: string | null;
    excerpt: string | null;
    locator: string | null;
    producer: string;
    confidence: string | null;
    inferenceRule: string | null;
    observedAt: Date;
    supersededById: string | null;
  };
  source: SourceInfo;
  findings: { findingId: string; auditId: string; checkKey: string; status: string; severity: string | null }[];
  freshness: Freshness;
}

export function describeSource(sr: typeof s.sourceRecords.$inferSelect): SourceInfo {
  const location =
    sr.retrievalMethod === "http_fetch"
      ? `${sr.url}${sr.finalUrl && sr.finalUrl !== sr.url ? ` → ${sr.finalUrl}` : ""}`
      : sr.retrievalMethod === "csv_import"
        ? `CSV file "${sr.fileName ?? "(unnamed)"}"`
        : `${sr.retrievalMethod.replace("_", " ")} by ${sr.attributedTo ?? "(unattributed)"}`;
  return {
    id: sr.id,
    method: sr.retrievalMethod,
    location,
    retrievedAt: sr.fetchedAt,
    outcome: sr.fetchOutcome,
    httpStatus: sr.httpStatus,
    attributedTo: sr.attributedTo,
    contentHash: sr.contentHash,
    userAgent: sr.userAgent,
    robotsRecordId: sr.robotsSourceRecordId,
  };
}

/** The full chain for one evidence row. Throws if any link is missing: that is a defect. */
export async function chainForEvidence(db: Db, evidenceId: string, cfg: FreshnessConfig, now = new Date()): Promise<Chain> {
  const [e] = await db.select().from(s.evidence).where(eq(s.evidence.id, evidenceId));
  if (!e) throw new Error(`No evidence ${evidenceId}`);
  const [sr] = await db.select().from(s.sourceRecords).where(eq(s.sourceRecords.id, e.sourceRecordId));
  if (!sr) throw new Error(`Evidence ${evidenceId} points at missing source record ${e.sourceRecordId}`);
  const findings = await db
    .select({
      findingId: s.auditFindings.id,
      auditId: s.auditFindings.auditId,
      checkKey: s.auditFindings.checkKey,
      status: s.auditFindings.status,
      severity: s.auditFindings.severity,
    })
    .from(s.auditFindingEvidence)
    .innerJoin(s.auditFindings, eq(s.auditFindings.id, s.auditFindingEvidence.auditFindingId))
    .where(eq(s.auditFindingEvidence.evidenceId, e.id));
  return {
    claim: {
      evidenceId: e.id,
      companyId: e.companyId,
      claimKey: e.claimKey,
      claim: e.claim,
      claimType: e.claimType,
      value: e.value,
      excerpt: e.excerpt,
      locator: e.locator,
      producer: e.producer,
      confidence: e.confidence,
      inferenceRule: e.inferenceRule,
      observedAt: e.observedAt,
      supersededById: e.supersededById,
    },
    source: describeSource(sr),
    findings,
    freshness: freshness({
      dataClass: dataClassOf(e.claimKey),
      observedAt: e.observedAt,
      lastVerifiedAt: e.lastVerifiedAt,
      now,
      windows: cfg.windows,
      recencyFloor: cfg.recencyFloor,
    }),
  };
}

/** Chains for every evidence row behind one audit finding. */
export async function chainsForFinding(db: Db, findingId: string, cfg: FreshnessConfig, now = new Date()) {
  const [f] = await db.select().from(s.auditFindings).where(eq(s.auditFindings.id, findingId));
  if (!f) throw new Error(`No finding ${findingId}`);
  const links = await db.select().from(s.auditFindingEvidence).where(eq(s.auditFindingEvidence.auditFindingId, findingId));
  return { finding: f, chains: await Promise.all(links.map((l) => chainForEvidence(db, l.evidenceId, cfg, now))) };
}

/** Chains for a company's claims (across its identity cluster), optionally filtered by claim-key prefix. */
export async function chainsForCompany(db: Db, companyId: string, cfg: FreshnessConfig, claimPrefix?: string, now = new Date()) {
  const rows = await db
    .select({ id: s.evidence.id })
    .from(s.evidence)
    .where(and(inCompanyCluster(s.evidence.companyId, companyId), claimPrefix ? like(s.evidence.claimKey, `${claimPrefix}%`) : undefined))
    .orderBy(s.evidence.claimKey, s.evidence.observedAt);
  return Promise.all(rows.map((r) => chainForEvidence(db, r.id, cfg, now)));
}
