import { pgEnum } from "drizzle-orm/pg-core";

// Claim taxonomy (Phase 0, "The provenance rule"). UNKNOWN = sought and not found.
export const claimType = pgEnum("claim_type", ["VERIFIED", "INFERRED", "REPORTED", "UNKNOWN"]);

// Which layer wrote an evidence row. audit/ produces facts, ai/ produces interpretations,
// and the two never write the same rows.
export const evidenceProducer = pgEnum("evidence_producer", ["audit", "ingest", "operator", "ai"]);

// --- Identity -------------------------------------------------------------

export const companyStatus = pgEnum("company_status", ["active", "merged"]);

export const companyCreatedVia = pgEnum("company_created_via", ["manual", "csv"]);

export const companyAliasKind = pgEnum("company_alias_kind", [
  "legal_name",
  "trading_name",
  "former_name",
  "former_domain",
  "merged_identity",
  "merged_domain",
]);

export const duplicateMatchBasis = pgEnum("duplicate_match_basis", [
  "domain",
  "normalised_name",
  "phone",
  "email",
]);

// Name similarity only ever proposes; a human confirms, rejects or defers.
export const duplicateCandidateStatus = pgEnum("duplicate_candidate_status", [
  "proposed",
  "confirmed_duplicate",
  "rejected",
  "deferred",
]);

export const duplicateResolutionAction = pgEnum("duplicate_resolution_action", ["confirm", "reject", "defer", "unmerge"]);

export const channelKind = pgEnum("channel_kind", ["email", "phone", "whatsapp", "profile_url"]);

export const channelVerification = pgEnum("channel_verification", ["unverified", "verified", "invalid"]);

// --- Sources and provenance -----------------------------------------------

export const sourceKind = pgEnum("source_kind", [
  "website_fetch",
  "csv_import",
  "manual_entry",
  "human_operator",
]);

export const retrievalMethod = pgEnum("retrieval_method", [
  "http_fetch",
  "csv_import",
  "manual_entry",
  "operator_statement",
]);

// SOURCE_BLOCKED states are valid results, not errors to retry around.
export const fetchOutcome = pgEnum("fetch_outcome", [
  "ok",
  "blocked_by_robots",
  "http_forbidden",
  "http_error",
  "timeout",
  "network_error",
  "tls_error",
  "too_large",
  "redirect_loop",
  "not_applicable",
]);

// --- Audits ---------------------------------------------------------------

export const auditStatus = pgEnum("audit_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "SOURCE_BLOCKED",
  "FAILED",
]);

export const auditBlockReason = pgEnum("audit_block_reason", [
  "robots_disallow",
  "http_forbidden",
  "login_required",
  "other",
]);

export const findingStatus = pgEnum("finding_status", [
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "INCONCLUSIVE",
  "ERROR",
]);

export const findingSeverity = pgEnum("finding_severity", ["info", "low", "medium", "high"]);

// Human check of a finding against the live site; feeds finding accuracy and FP rate.
export const findingVerdict = pgEnum("finding_verdict", ["confirmed_true", "false_positive", "unclear"]);

// --- Commercial configuration ---------------------------------------------

export const revenueModel = pgEnum("revenue_model", ["one_off", "recurring", "hybrid"]);

export const serviceUnit = pgEnum("service_unit", ["project", "add_on", "per_piece", "retainer", "bundle"]);

export const billingPeriod = pgEnum("billing_period", ["once", "monthly"]);

export const opportunityTypeOrigin = pgEnum("opportunity_type_origin", ["service_catalogue", "case_study"]);

export const signalKind = pgEnum("signal_kind", ["documented_trigger", "friction"]);

export const scoreAxis = pgEnum("score_axis", ["intent", "opportunity"]);

// --- Signals and opportunities --------------------------------------------

export const signalDetectedBy = pgEnum("signal_detected_by", ["rule", "operator"]);

export const signalStatus = pgEnum("signal_status", ["active", "retracted"]);

// --- Leads, gate and scoring ----------------------------------------------

export const leadStatus = pgEnum("lead_status", ["open", "closed"]);

export const leadState = pgEnum("lead_state", [
  "PENDING_EVALUATION",
  "WATCH_WEAKNESS_ONLY",
  "COMMERCIAL_OPPORTUNITY",
  "OUTREACH_READY",
  "DISQUALIFIED",
]);

export const intentGateStatus = pgEnum("intent_gate_status", ["NOT_EVALUATED", "PASSED", "FAILED"]);

export const intentGateBasis = pgEnum("intent_gate_basis", [
  "buying_signal",
  "commercial_potential_floor",
  "human_override",
]);

export const segmentFit = pgEnum("segment_fit", ["fit", "potentially_valid", "not_fit", "unknown"]);

export const channelSuitability = pgEnum("outreach_channel_suitability", [
  "cold_outreach_allowed",
  "cold_outreach_disallowed",
  "unknown",
]);

export const scoreDimension = pgEnum("score_dimension", [
  "buying_signal",
  "icp_fit",
  "digital_opportunity",
  "service_fit",
  "commercial_potential",
  "contactability",
  "evidence_quality",
]);

// --- Human judgement ------------------------------------------------------

export const verdict = pgEnum("verdict", ["YES", "MAYBE", "NO"]);

export const judgementContext = pgEnum("judgement_context", ["benchmark_blind", "review"]);

export const benchmarkOutcome = pgEnum("benchmark_outcome", [
  "agreement",
  "false_positive",
  "false_negative",
  "partial_disagreement",
]);

// --- Operations -----------------------------------------------------------

export const aiRunStatus = pgEnum("ai_run_status", ["succeeded", "invalid_output", "needs_human", "failed"]);

export const logLevel = pgEnum("log_level", ["debug", "info", "warn", "error"]);

// --- AI opportunity brief -------------------------------------------------

// The six fields of the required brief shape (handover brief, "The opportunity brief").
export const briefField = pgEnum("brief_field", [
  "commercial_friction",
  "evidence",
  "likely_opportunity",
  "covenant_capability",
  "confidence",
  "needs_verification",
]);

// --- Configuration provenance ---------------------------------------------

// Where a configuration value came from: a source document, an operator-adjustable
// default agreed with Covenant, or an operator's own edit.
export const configOrigin = pgEnum("config_origin", ["documented", "default", "operator"]);

// --- Ingestion ------------------------------------------------------------

export const csvRowStatus = pgEnum("csv_row_status", ["imported", "matched_existing", "invalid", "failed"]);
