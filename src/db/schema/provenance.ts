// Sources, raw retrievals and evidence. Evidence rows are immutable dated observations:
// never edited, only superseded (enforced by trigger in the migration).
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { id, timestamps, tstz } from "./common";
import { claimType, evidenceProducer, fetchOutcome, retrievalMethod, sourceKind } from "./enums";
import { companies } from "./identity";

export const sources = pgTable("sources", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: sourceKind("kind").notNull(),
  // Per-domain politeness for fetch sources; null = fetch layer default.
  minIntervalMs: integer("min_interval_ms"),
  userAgent: text("user_agent"),
  ...timestamps(),
});

// One retrieval: a fetched page, robots.txt, a CSV file, a manual entry or an
// operator statement. Every evidence row points at exactly one of these.
export const sourceRecords = pgTable(
  "source_records",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    // Null for a CSV file that covers many companies.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    retrievalMethod: retrievalMethod("retrieval_method").notNull(),
    url: text("url"),
    finalUrl: text("final_url"),
    fetchedAt: tstz("fetched_at").notNull(),
    fetchOutcome: fetchOutcome("fetch_outcome").notNull(),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    contentHash: text("content_hash"),
    byteSize: bigint("byte_size", { mode: "number" }),
    // Raw retrieved body (HTML, robots.txt, CSV text, operator statement).
    rawContent: text("raw_content"),
    // Original file name for a CSV import.
    fileName: text("file_name"),
    // Operator name for REPORTED operator statements and manual entry.
    attributedTo: text("attributed_to"),
    traceId: text("trace_id"),
    ...timestamps(),
  },
  (t) => [
    index("source_records_company_fetched").on(t.companyId, t.fetchedAt),
    index("source_records_hash").on(t.contentHash),
    check(
      "source_records_fetch_has_url",
      sql`${t.retrievalMethod} <> 'http_fetch' or (${t.url} is not null and ${t.fetchOutcome} <> 'not_applicable')`,
    ),
    check(
      "source_records_human_attributed",
      sql`${t.retrievalMethod} not in ('operator_statement', 'manual_entry') or ${t.attributedTo} is not null`,
    ),
    check("source_records_http_status", sql`${t.httpStatus} is null or ${t.httpStatus} between 100 and 599`),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // The provenance constraint: NOT NULL + FK, enforced by the database.
    sourceRecordId: uuid("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "restrict" }),
    producer: evidenceProducer("producer").notNull(),
    // Stable claim identifier, e.g. "homepage.primary_cta" or "company.industry".
    claimKey: text("claim_key").notNull(),
    // Human-readable statement of what was observed (or sought and not found).
    claim: text("claim").notNull(),
    claimType: claimType("claim_type").notNull(),
    value: text("value"),
    // The exact snippet / attribute / header the claim rests on.
    excerpt: text("excerpt"),
    // Where in the source: CSS selector, header name, CSV row number.
    locator: text("locator"),
    // Required for INFERRED: the stated rule the inference follows.
    inferenceRule: text("inference_rule"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    observedAt: tstz("observed_at").notNull(),
    lastVerifiedAt: tstz("last_verified_at"),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("evidence_company_claim").on(t.companyId, t.claimKey, t.observedAt),
    index("evidence_source_record").on(t.sourceRecordId),
    check("evidence_inferred_has_rule", sql`${t.claimType} <> 'INFERRED' or ${t.inferenceRule} is not null`),
    check("evidence_unknown_has_no_value", sql`${t.claimType} <> 'UNKNOWN' or ${t.value} is null`),
    check("evidence_confidence_range", sql`${t.confidence} is null or ${t.confidence} between 0 and 1`),
    check("evidence_not_self_superseded", sql`${t.supersededById} is distinct from ${t.id}`),
  ],
);

