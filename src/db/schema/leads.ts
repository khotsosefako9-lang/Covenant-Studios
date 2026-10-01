// The pursuit of a company: intent gate, scores and human judgement, each kept separate.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { audits } from "./audit";
import { id, timestamps, tstz } from "./common";
import { disqualifiers, icpSegments, weightSets } from "./config";
import {
  channelSuitability,
  intentGateBasis,
  intentGateStatus,
  judgementContext,
  judgementReason,
  leadState,
  leadStatus,
  scoreDimension,
  segmentFit,
  verdict,
} from "./enums";
import { companies } from "./identity";
import { evidence } from "./provenance";

export const leads = pgTable(
  "leads",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    icpSegmentId: uuid("icp_segment_id").references(() => icpSegments.id, { onDelete: "set null" }),
    status: leadStatus("status").notNull().default("open"),
    owner: text("owner"),
    // The intent gate is stored on its own, never folded into the score.
    leadState: leadState("lead_state").notNull().default("PENDING_EVALUATION"),
    intentGateStatus: intentGateStatus("intent_gate_status").notNull().default("NOT_EVALUATED"),
    intentGateBasis: intentGateBasis("intent_gate_basis"),
    intentGateEvaluatedAt: tstz("intent_gate_evaluated_at"),
    intentGateOverrideBy: text("intent_gate_override_by"),
    intentGateOverrideReason: text("intent_gate_override_reason"),
    // Channel suitability is not client suitability (benchmark category 15).
    segmentFit: segmentFit("segment_fit").notNull().default("unknown"),
    outreachChannelSuitability: channelSuitability("outreach_channel_suitability").notNull().default("unknown"),
    channelSuitabilityReason: text("channel_suitability_reason"),
    currentScoreId: uuid("current_score_id").references((): AnyPgColumn => scores.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("leads_one_open_per_company").on(t.companyId).where(sql`${t.status} = 'open'`),
    index("leads_state").on(t.leadState),
    // Weakness alone can never qualify a lead: these states require a passed gate.
    check(
      "leads_qualified_requires_gate",
      sql`${t.leadState} not in ('COMMERCIAL_OPPORTUNITY', 'OUTREACH_READY') or ${t.intentGateStatus} = 'PASSED'`,
    ),
    check("leads_gate_passed_has_basis", sql`(${t.intentGateStatus} = 'PASSED') = (${t.intentGateBasis} is not null)`),
    check(
      "leads_gate_evaluated_at",
      sql`(${t.intentGateStatus} = 'NOT_EVALUATED') = (${t.intentGateEvaluatedAt} is null)`,
    ),
    check(
      "leads_override_has_reason",
      sql`${t.intentGateBasis} is distinct from 'human_override' or (${t.intentGateOverrideBy} is not null and ${t.intentGateOverrideReason} is not null)`,
    ),
    check(
      "leads_channel_disallowed_has_reason",
      sql`${t.outreachChannelSuitability} <> 'cold_outreach_disallowed' or ${t.channelSuitabilityReason} is not null`,
    ),
  ],
);

// A disqualifier fires only on evidence; absence of information is UNKNOWN, not a rejection.
export const leadDisqualifications = pgTable(
  "lead_disqualifications",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    disqualifierId: uuid("disqualifier_id")
      .notNull()
      .references(() => disqualifiers.id, { onDelete: "restrict" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    recordedBy: text("recorded_by").notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("lead_disqualifications_unique").on(t.leadId, t.disqualifierId, t.evidenceId)],
);

const unit = (name: string) => numeric(name, { precision: 5, scale: 4 });

// A dated, immutable score run. Score, confidence and evidence quality are separate columns.
export const scores = pgTable(
  "scores",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    weightSetId: uuid("weight_set_id")
      .notNull()
      .references(() => weightSets.id, { onDelete: "restrict" }),
    // The audit this score was computed against (stale-score invariant).
    auditId: uuid("audit_id").references(() => audits.id, { onDelete: "restrict" }),
    total: numeric("total", { precision: 5, scale: 2 }).notNull(),
    opportunityAxis: numeric("opportunity_axis", { precision: 5, scale: 2 }),
    intentAxis: numeric("intent_axis", { precision: 5, scale: 2 }),
    confidence: unit("confidence").notNull(),
    evidenceQuality: unit("evidence_quality").notNull(),
    computedAt: tstz("computed_at").notNull().defaultNow(),
    traceId: text("trace_id"),
    ...timestamps(),
  },
  (t) => [
    unique("scores_id_lead").on(t.id, t.leadId),
    index("scores_lead_computed").on(t.leadId, t.computedAt),
    check("scores_total_range", sql`${t.total} between 0 and 100`),
    check("scores_axes_range", sql`coalesce(${t.opportunityAxis}, 0) between 0 and 100 and coalesce(${t.intentAxis}, 0) between 0 and 100`),
    check("scores_confidence_range", sql`${t.confidence} between 0 and 1`),
    check("scores_evidence_quality_range", sql`${t.evidenceQuality} between 0 and 1`),
  ],
);

// Per-dimension decomposition: s_d, w_d, k_d, contribution, and the confidence inputs.
export const scoreDimensions = pgTable(
  "score_dimensions",
  {
    scoreId: uuid("score_id")
      .notNull()
      .references(() => scores.id, { onDelete: "cascade" }),
    dimension: scoreDimension("dimension").notNull(),
    value: unit("value").notNull(),
    weight: unit("weight").notNull(),
    decay: unit("decay").notNull(),
    contribution: numeric("contribution", { precision: 5, scale: 2 }).notNull(),
    coverage: unit("coverage").notNull(),
    recency: unit("recency").notNull(),
    verifiability: unit("verifiability").notNull(),
    explanation: text("explanation"),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.scoreId, t.dimension] }),
    check(
      "score_dimensions_unit_range",
      sql`least(${t.value}, ${t.weight}, ${t.decay}, ${t.coverage}, ${t.recency}, ${t.verifiability}) >= 0
        and greatest(${t.value}, ${t.weight}, ${t.decay}, ${t.coverage}, ${t.recency}, ${t.verifiability}) <= 1`,
    ),
    check("score_dimensions_contribution_range", sql`${t.contribution} between 0 and 100`),
  ],
);

// The evidence behind each dimension: what the UI shows under each contribution, and
// the evidence snapshot a judgement or benchmark record points back to.
export const scoreDimensionEvidence = pgTable(
  "score_dimension_evidence",
  {
    scoreId: uuid("score_id").notNull(),
    dimension: scoreDimension("dimension").notNull(),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.scoreId, t.dimension, t.evidenceId] }),
    foreignKey({ columns: [t.scoreId, t.dimension], foreignColumns: [scoreDimensions.scoreId, scoreDimensions.dimension] }).onDelete(
      "cascade",
    ),
  ],
);

// Operator verdict: evaluation data, not CRM notes.
export const judgements = pgTable(
  "judgements",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    context: judgementContext("context").notNull(),
    // The score the verdict was made against. Null only for blind benchmark capture,
    // where the operator judges before any system output is shown.
    scoreId: uuid("score_id"),
    verdict: verdict("verdict").notNull(),
    reasonCode: judgementReason("reason_code").notNull(),
    notes: text("notes"),
    actor: text("actor").notNull(),
    judgedAt: tstz("judged_at").notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    unique("judgements_id_context").on(t.id, t.context),
    index("judgements_lead").on(t.leadId, t.judgedAt),
    // The snapshot score must belong to the same lead.
    foreignKey({ columns: [t.scoreId, t.leadId], foreignColumns: [scores.id, scores.leadId] }).onDelete("restrict"),
    check("judgements_review_has_score", sql`${t.context} <> 'review' or ${t.scoreId} is not null`),
    check("judgements_blind_has_no_score", sql`${t.context} <> 'benchmark_blind' or ${t.scoreId} is null`),
    check("judgements_other_has_notes", sql`${t.reasonCode} <> 'other' or ${t.notes} is not null`),
  ],
);

// The evidence state the operator was looking at when they judged.
export const judgementEvidence = pgTable(
  "judgement_evidence",
  {
    judgementId: uuid("judgement_id")
      .notNull()
      .references(() => judgements.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.judgementId, t.evidenceId] })],
);
