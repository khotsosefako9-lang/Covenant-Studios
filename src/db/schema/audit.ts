// Deterministic website audits. No AI writes to these tables.
import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./common";
import { auditBlockReason, auditStatus, findingSeverity, findingStatus, findingVerdict } from "./enums";
import { companies } from "./identity";
import { evidence, sourceRecords } from "./provenance";

export const audits = pgTable(
  "audits",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    targetUrl: text("target_url").notNull(),
    status: auditStatus("status").notNull().default("QUEUED"),
    // Version of the deterministic check set, so findings from different sets are comparable.
    checkSetVersion: text("check_set_version").notNull(),
    blockReason: auditBlockReason("block_reason"),
    // The retrieval that proved the block (e.g. robots.txt), kept as provenance.
    blockSourceRecordId: uuid("block_source_record_id").references(() => sourceRecords.id, { onDelete: "restrict" }),
    errorCode: text("error_code"),
    errorDetail: text("error_detail"),
    traceId: text("trace_id").notNull(),
    startedAt: tstz("started_at"),
    completedAt: tstz("completed_at"),
    ...timestamps(),
  },
  (t) => [
    index("audits_company_created").on(t.companyId, t.createdAt),
    index("audits_status").on(t.status),
    check(
      "audits_blocked_has_reason",
      sql`(${t.status} = 'SOURCE_BLOCKED') = (${t.blockReason} is not null)`,
    ),
    check(
      "audits_blocked_has_proof",
      sql`${t.status} <> 'SOURCE_BLOCKED' or ${t.blockSourceRecordId} is not null`,
    ),
    check("audits_failed_has_error", sql`${t.status} <> 'FAILED' or ${t.errorCode} is not null`),
    check(
      "audits_terminal_completed_at",
      sql`${t.status} not in ('COMPLETED', 'SOURCE_BLOCKED', 'FAILED') or ${t.completedAt} is not null`,
    ),
  ],
);

export const auditFindings = pgTable(
  "audit_findings",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    checkKey: text("check_key").notNull(),
    checkVersion: text("check_version").notNull(),
    status: findingStatus("status").notNull(),
    severity: findingSeverity("severity"),
    detail: text("detail").notNull(),
    observedAt: tstz("observed_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("audit_findings_audit_check").on(t.auditId, t.checkKey),
    index("audit_findings_check_status").on(t.checkKey, t.status),
    check("audit_findings_fail_has_severity", sql`${t.status} <> 'FAIL' or ${t.severity} is not null`),
  ],
);

export const auditFindingEvidence = pgTable(
  "audit_finding_evidence",
  {
    auditFindingId: uuid("audit_finding_id")
      .notNull()
      .references(() => auditFindings.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.auditFindingId, t.evidenceId] }),
    index("audit_finding_evidence_evidence").on(t.evidenceId),
  ],
);

// A human checking a finding against the live site. History is kept; latest row wins.
export const findingVerifications = pgTable(
  "finding_verifications",
  {
    id: id(),
    auditFindingId: uuid("audit_finding_id")
      .notNull()
      .references(() => auditFindings.id, { onDelete: "cascade" }),
    verdict: findingVerdict("verdict").notNull(),
    note: text("note"),
    verifiedBy: text("verified_by").notNull(),
    verifiedAt: tstz("verified_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index("finding_verifications_finding").on(t.auditFindingId, t.verifiedAt)],
);
