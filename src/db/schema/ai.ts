// AI runs, cost logging and the evidence-bound opportunity brief.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { opportunities } from "./commercial";
import { id, timestamps, tstz } from "./common";
import { covenantServices } from "./config";
import { aiRunStatus, briefField, claimType, logLevel } from "./enums";
import { companies } from "./identity";
import { leads } from "./leads";
import { evidence } from "./provenance";

// Model identifiers and per-token prices are configuration rows, not constants.
// Prices stay null until supplied; cost for a run on an unpriced model is not estimated.
export const aiModels = pgTable(
  "ai_models",
  {
    id: id(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    tier: text("tier").notNull(),
    inputUsdPerMtok: numeric("input_usd_per_mtok", { precision: 10, scale: 4 }),
    outputUsdPerMtok: numeric("output_usd_per_mtok", { precision: 10, scale: 4 }),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_models_provider_model").on(t.provider, t.modelId)],
);

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: id(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    taskKey: text("task_key").notNull(),
    promptName: text("prompt_name").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    status: aiRunStatus("status").notNull(),
    attempt: smallint("attempt").notNull().default(1),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    // Null when the model has no configured price.
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    errorDetail: text("error_detail"),
    traceId: text("trace_id").notNull(),
    startedAt: tstz("started_at").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("ai_runs_started").on(t.startedAt),
    index("ai_runs_company").on(t.companyId),
    index("ai_runs_trace").on(t.traceId),
    check("ai_runs_non_negative", sql`coalesce(${t.inputTokens}, 0) >= 0 and coalesce(${t.outputTokens}, 0) >= 0 and coalesce(${t.costUsd}, 0) >= 0`),
  ],
);

// The closed evidence packet sent to the model on a run.
export const aiRunPacketEvidence = pgTable(
  "ai_run_packet_evidence",
  {
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.aiRunId, t.evidenceId] })],
);

export const opportunityBriefs = pgTable(
  "opportunity_briefs",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "restrict" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    covenantServiceId: uuid("covenant_service_id").references(() => covenantServices.id, { onDelete: "restrict" }),
    // "Insufficient evidence for a recommendation" is a successful run.
    insufficientEvidence: boolean("insufficient_evidence").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("opportunity_briefs_id_run").on(t.id, t.aiRunId), index("opportunity_briefs_company").on(t.companyId)],
);

export const briefClaims = pgTable(
  "brief_claims",
  {
    id: id(),
    briefId: uuid("brief_id").notNull(),
    aiRunId: uuid("ai_run_id").notNull(),
    field: briefField("field").notNull(),
    position: smallint("position").notNull().default(1),
    text: text("text").notNull(),
    claimType: claimType("claim_type").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("brief_claims_id_run").on(t.id, t.aiRunId),
    foreignKey({ columns: [t.briefId, t.aiRunId], foreignColumns: [opportunityBriefs.id, opportunityBriefs.aiRunId] }).onDelete(
      "cascade",
    ),
  ],
);

// Evidence-id binding, enforced mechanically: a claim may only cite evidence that was
// in the packet sent on the same run (composite FK into ai_run_packet_evidence).
export const briefClaimEvidence = pgTable(
  "brief_claim_evidence",
  {
    briefClaimId: uuid("brief_claim_id").notNull(),
    aiRunId: uuid("ai_run_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.briefClaimId, t.evidenceId] }),
    foreignKey({ columns: [t.briefClaimId, t.aiRunId], foreignColumns: [briefClaims.id, briefClaims.aiRunId] }).onDelete(
      "cascade",
    ),
    foreignKey({
      columns: [t.aiRunId, t.evidenceId],
      foreignColumns: [aiRunPacketEvidence.aiRunId, aiRunPacketEvidence.evidenceId],
    }).onDelete("restrict"),
  ],
);

// Structured operational log; one trace per company through the pipeline.
export const systemEvents = pgTable(
  "system_events",
  {
    id: id(),
    occurredAt: tstz("occurred_at").notNull().defaultNow(),
    level: logLevel("level").notNull(),
    traceId: text("trace_id"),
    stage: text("stage").notNull(),
    event: text("event").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    message: text("message"),
    context: jsonb("context"),
    ...timestamps(),
  },
  (t) => [index("system_events_trace").on(t.traceId), index("system_events_occurred").on(t.occurredAt)],
);
