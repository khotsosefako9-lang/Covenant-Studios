// Deterministic website audits. No AI writes to these tables.
import { sql } from "drizzle-orm";
import { boolean, check, index, numeric, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./common";
import { auditBlockReason, auditCheckCategory, auditStatus, configOrigin, findingSeverity, findingStatus, findingVerdict } from "./enums";
import { companies } from "./identity";
import { evidence, sourceRecords } from "./provenance";

// The deterministic check registry. Code implements each check; this table switches it on
// or off without a deploy and documents its severity and the evidence it records.
export const auditChecks = pgTable("audit_checks", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  category: auditCheckCategory("category").notNull(),
  severity: findingSeverity("severity").notNull(),
  version: text("version").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  description: text("description").notNull(),
  evidenceRecorded: text("evidence_recorded").notNull(),
  configOrigin: configOrigin("config_origin").notNull().default("documented"),
  ...timestamps(),
});

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
    // Why a whole-audit result was reached (shell detector metrics, platform host, ...).
    statusDetail: text("status_detail"),
    // The page fetch the findings were derived from.
    pageSourceRecordId: uuid("page_source_record_id").references(() => sourceRecords.id, { onDelete: "restrict" }),
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
    // Written without naming the newer statuses: every status but QUEUED and RUNNING is terminal.
    check("audits_terminal_completed_at", sql`${t.status} in ('QUEUED', 'RUNNING') or ${t.completedAt} is not null`),
  ],
);

export const auditFindings = pgTable(
  "audit_findings",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    checkKey: text("check_key")
      .notNull()
      .references(() => auditChecks.key, { onDelete: "restrict", onUpdate: "cascade" }),
    checkVersion: text("check_version").notNull(),
    status: findingStatus("status").notNull(),
    severity: findingSeverity("severity"),
    // How sure the check is of this result, from its own rules. Never from a model.
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
    detail: text("detail").notNull(),
    observedAt: tstz("observed_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("audit_findings_audit_check").on(t.auditId, t.checkKey),
    index("audit_findings_check_status").on(t.checkKey, t.status),
    check("audit_findings_fail_has_severity", sql`${t.status} <> 'FAIL' or ${t.severity} is not null`),
    check("audit_findings_confidence_range", sql`${t.confidence} between 0 and 1`),
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
