import { sql } from "drizzle-orm";
import { pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { claimType, evidenceProducer, retrievalMethod } from "./enums";

// Every evidence row with the provenance a reader needs: source URL, retrieval time,
// retrieval method and attribution. The UI and the evidence-quality metric read this.
export const evidenceProvenance = pgView("evidence_provenance", {
  evidenceId: uuid("evidence_id").notNull(),
  companyId: uuid("company_id").notNull(),
  claimKey: text("claim_key").notNull(),
  claim: text("claim").notNull(),
  claimType: claimType("claim_type").notNull(),
  value: text("value"),
  producer: evidenceProducer("producer").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  supersededById: uuid("superseded_by_id"),
  sourceRecordId: uuid("source_record_id").notNull(),
  sourceUrl: text("source_url"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  retrievalMethod: retrievalMethod("retrieval_method").notNull(),
  attributedTo: text("attributed_to"),
}).as(sql`
  select e.id as evidence_id, e.company_id, e.claim_key, e.claim, e.claim_type, e.value,
         e.producer, e.observed_at, e.superseded_by_id, e.source_record_id,
         coalesce(sr.final_url, sr.url) as source_url, sr.fetched_at as retrieved_at,
         sr.retrieval_method, sr.attributed_to
  from evidence e
  join source_records sr on sr.id = e.source_record_id
`);
