// finding → signal → opportunity type → Covenant service, as stored interpretations.
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, primaryKey, smallint, text, uuid } from "drizzle-orm/pg-core";
import { auditFindings } from "./audit";
import { id, timestamps, tstz } from "./common";
import { covenantServices, opportunityTypes, signalTypes } from "./config";
import { claimType, signalDetectedBy, signalStatus } from "./enums";
import { companies } from "./identity";
import { evidence } from "./provenance";

export const signals = pgTable(
  "signals",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    signalTypeId: uuid("signal_type_id")
      .notNull()
      .references(() => signalTypes.id, { onDelete: "restrict" }),
    // Strength at observation. Decay is computed at read time from observed_at and the
    // signal type's decay_days (src/core/freshness.ts); it is never stored.
    strength: numeric("strength", { precision: 4, scale: 3 }).notNull(),
    observedAt: tstz("observed_at").notNull(),
    detectedBy: signalDetectedBy("detected_by").notNull(),
    // Rule key for detected_by = rule; operator name for detected_by = operator.
    detectorRef: text("detector_ref").notNull(),
    status: signalStatus("status").notNull().default("active"),
    ...timestamps(),
  },
  (t) => [
    index("signals_company_type").on(t.companyId, t.signalTypeId, t.observedAt),
    check("signals_strength_range", sql`${t.strength} between 0 and 1`),
  ],
);

export const signalEvidence = pgTable(
  "signal_evidence",
  {
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.signalId, t.evidenceId] })],
);

export const signalFindings = pgTable(
  "signal_findings",
  {
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    auditFindingId: uuid("audit_finding_id")
      .notNull()
      .references(() => auditFindings.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.signalId, t.auditFindingId] })],
);

// A commercial interpretation: this company may need this opportunity type, served by
// this Covenant service. Always INFERRED unless an operator reports it.
export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    opportunityTypeId: uuid("opportunity_type_id")
      .notNull()
      .references(() => opportunityTypes.id, { onDelete: "restrict" }),
    // Chosen service from the type's configured mapping. Validated by trigger.
    covenantServiceId: uuid("covenant_service_id").references(() => covenantServices.id, { onDelete: "restrict" }),
    rank: smallint("rank").notNull(),
    relevance: numeric("relevance", { precision: 4, scale: 3 }),
    claimType: claimType("claim_type").notNull().default("INFERRED"),
    rationale: text("rationale").notNull(),
    inferenceRule: text("inference_rule").notNull(),
    derivedAt: tstz("derived_at").notNull().defaultNow(),
    supersededAt: tstz("superseded_at"),
    ...timestamps(),
  },
  (t) => [
    index("opportunities_company").on(t.companyId, t.derivedAt),
    check("opportunities_rank", sql`${t.rank} >= 1`),
    check("opportunities_relevance_range", sql`${t.relevance} is null or ${t.relevance} between 0 and 1`),
    check("opportunities_interpretation", sql`${t.claimType} in ('INFERRED', 'REPORTED')`),
  ],
);

export const opportunityFindings = pgTable(
  "opportunity_findings",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    auditFindingId: uuid("audit_finding_id")
      .notNull()
      .references(() => auditFindings.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.auditFindingId] })],
);

export const opportunitySignals = pgTable(
  "opportunity_signals",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.signalId] })],
);
