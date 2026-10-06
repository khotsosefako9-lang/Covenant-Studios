// The pursuit of a company: intent gate, scores and human judgement, each kept separate.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
import { disqualifiers, icpSegments, judgementReasons, weightSets } from "./config";
import {
  channelSuitability,
  intentGateBasis,
  intentGateStatus,
  judgementContext,
  leadState,
  leadStatus,
  leadTransitionCause,
  scoreDimension,
  segmentFit,
  verdict,
} from "./enums";
import { companies, companyMerges } from "./identity";
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
    // The effective state: the human override when there is one, else the system's.
    leadState: leadState("lead_state").notNull().default("PENDING_EVALUATION"),
    // What the state machine computed (Phase 10), kept beside any human override.
    systemLeadState: leadState("system_lead_state").notNull().default("PENDING_EVALUATION"),
    stateOverride: leadState("state_override"),
    stateOverrideBy: text("state_override_by"),
    stateOverrideReason: text("state_override_reason"),
    stateOverrideAt: tstz("state_override_at"),
    // The intent gate is stored on its own, never folded into the score. These columns
    // are the effective gate; system_gate_* is what the system computed.
    intentGateStatus: intentGateStatus("intent_gate_status").notNull().default("NOT_EVALUATED"),
    intentGateBasis: intentGateBasis("intent_gate_basis"),
    intentGateEvaluatedAt: tstz("intent_gate_evaluated_at"),
    intentGateOverrideBy: text("intent_gate_override_by"),
    intentGateOverrideReason: text("intent_gate_override_reason"),
    systemGateStatus: intentGateStatus("system_gate_status").notNull().default("NOT_EVALUATED"),
    systemGateBasis: intentGateBasis("system_gate_basis"),
    lastEvaluationId: uuid("last_evaluation_id").references((): AnyPgColumn => leadEvaluations.id, { onDelete: "set null" }),
    // Channel suitability is not client suitability (benchmark category 15).
    segmentFit: segmentFit("segment_fit").notNull().default("unknown"),
    outreachChannelSuitability: channelSuitability("outreach_channel_suitability").notNull().default("unknown"),
    channelSuitabilityReason: text("channel_suitability_reason"),
    channelSuitabilitySetBy: text("channel_suitability_set_by"),
    channelSuitabilitySetAt: tstz("channel_suitability_set_at"),
    // A closed lead keeps its history. 'merged': its business merged into another whose lead
    // now carries the pursuit (merged_into_lead_id); an unmerge reopens it.
    closedAt: tstz("closed_at"),
    closedReason: text("closed_reason"),
    mergedIntoLeadId: uuid("merged_into_lead_id").references((): AnyPgColumn => leads.id, { onDelete: "set null" }),
    closedByMergeId: uuid("closed_by_merge_id").references(() => companyMerges.id, { onDelete: "restrict" }),
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
    // Phase 10: the effective state is the override when present, else the system's.
    check("leads_effective_state", sql`${t.leadState} = coalesce(${t.stateOverride}, ${t.systemLeadState})`),
    check(
      "leads_state_override_complete",
      sql`(${t.stateOverride} is null) = (${t.stateOverrideBy} is null) and (${t.stateOverride} is null) = (${t.stateOverrideReason} is null) and (${t.stateOverride} is null) = (${t.stateOverrideAt} is null)`,
    ),
    // Nothing reaches OUTREACH_READY automatically: it needs a human YES (Phase 13).
    check("leads_system_never_outreach_ready", sql`${t.systemLeadState} <> 'OUTREACH_READY'`),
    check("leads_system_qualified_requires_gate", sql`${t.systemLeadState} <> 'COMMERCIAL_OPPORTUNITY' or ${t.systemGateStatus} = 'PASSED'`),
    check(
      "leads_system_gate_basis",
      sql`(${t.systemGateStatus} = 'PASSED') = (${t.systemGateBasis} is not null) and ${t.systemGateBasis} is distinct from 'human_override'`,
    ),
    check("leads_closed", sql`(${t.status} = 'closed') = (${t.closedAt} is not null) and (${t.closedAt} is null or ${t.closedReason} is not null)`),
    check("leads_merge_closure", sql`(${t.mergedIntoLeadId} is null and ${t.closedByMergeId} is null) or ${t.closedReason} = 'merged'`),
  ],
);

// One run of the state machine for a lead (Phase 10). Immutable: what the system decided,
// on what, and why. leads.system_* always equals the latest row here.
export const leadEvaluations = pgTable(
  "lead_evaluations",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: "cascade" }),
    // The latest completed audit of the identity cluster the evaluation read, if any.
    auditId: uuid("audit_id").references(() => audits.id, { onDelete: "restrict" }),
    evaluatedAt: tstz("evaluated_at").notNull(),
    systemState: leadState("system_state").notNull(),
    gateStatus: intentGateStatus("gate_status").notNull(),
    gateBasis: intentGateBasis("gate_basis"),
    // Entry price of the best mapped opportunity, when the capacity profile evidences it.
    commercialPotentialZar: integer("commercial_potential_zar"),
    rule: text("rule").notNull(),
    reasons: jsonb("reasons").notNull(),
    // The inputs: intent signals, capacity markers, opportunities, disqualifications (ids and values).
    detail: jsonb("detail").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("lead_evaluations_lead").on(t.leadId, t.evaluatedAt),
    check("lead_evaluations_never_outreach_ready", sql`${t.systemState} <> 'OUTREACH_READY'`),
    check("lead_evaluations_gate_basis", sql`(${t.gateStatus} = 'PASSED') = (${t.gateBasis} is not null)`),
  ],
);

// Every change of a lead's effective state, with its cause, actor and time. Immutable.
export const leadStateTransitions = pgTable(
  "lead_state_transitions",
  {
    id: id(),
    leadId: uuid("lead_id")
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: "cascade" }),
    fromState: leadState("from_state"),
    toState: leadState("to_state").notNull(),
    // The system's state at the time, kept beside the effective one.
    systemState: leadState("system_state").notNull(),
    cause: leadTransitionCause("cause").notNull(),
    evaluationId: uuid("evaluation_id").references(() => leadEvaluations.id, { onDelete: "restrict" }),
    actor: text("actor").notNull(),
    detail: text("detail").notNull(),
    occurredAt: tstz("occurred_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("lead_state_transitions_lead").on(t.leadId, t.occurredAt),
    check("lead_state_transitions_evaluation", sql`${t.cause} <> 'evaluation' or ${t.evaluationId} is not null`),
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
    // Rule-fired disqualifications live and die with the audit that evidenced them; an
    // operator lifts their own with a reason. Lifted rows are kept as history.
    retractedAt: tstz("retracted_at"),
    retractedBy: text("retracted_by"),
    retractionReason: text("retraction_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("lead_disqualifications_unique").on(t.leadId, t.disqualifierId, t.evidenceId),
    check(
      "lead_disqualifications_retraction_complete",
      sql`(${t.retractedAt} is null) = (${t.retractedBy} is null) and (${t.retractedAt} is null) = (${t.retractionReason} is null)`,
    ),
  ],
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
    reasonCode: text("reason_code")
      .notNull()
      .references(() => judgementReasons.key, { onDelete: "restrict", onUpdate: "cascade" }),
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
