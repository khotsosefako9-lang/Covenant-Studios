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
// Fetch outcomes are data states, not errors. SOURCE_BLOCKED (robots disallow) is never
// retried; BLOCKED_BY_SERVER covers 403 and 429. HTTP_ERROR is any other non-2xx status
// (404, 5xx after retries); NOT_APPLICABLE is for non-network sources such as a CSV.
export const fetchOutcome = pgEnum("fetch_outcome", [
  "OK",
  "SOURCE_BLOCKED",
  "BLOCKED_BY_SERVER",
  "HTTP_ERROR",
  "TIMEOUT",
  "UNREACHABLE",
  "TLS_ERROR",
  "TOO_LARGE",
  "REDIRECT_LOOP",
  "NOT_APPLICABLE",
  "UNSUPPORTED_CONTENT_TYPE",
]);

export const fetchPurpose = pgEnum("fetch_purpose", ["robots", "page"]);

// --- Audits ---------------------------------------------------------------

// Whole-audit results. RENDER_REQUIRED (client-rendered shell), SHARED_PLATFORM (the
// target is a Facebook/Linktree-style page, not the company's own site) and NO_CONTENT
// (an empty document) all carry zero findings: auditing them would only produce false ones.
export const auditStatus = pgEnum("audit_status", [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "SOURCE_BLOCKED",
  "FAILED",
  "RENDER_REQUIRED",
  "SHARED_PLATFORM",
  "NO_CONTENT",
]);

// capacity (Phase 9): markers of operating scale. They feed commercial potential, never a
// weakness and never Intent.
export const auditCheckCategory = pgEnum("audit_check_category", ["technical", "conversion", "content", "capacity", "commercial"]);

export const auditBlockReason = pgEnum("audit_block_reason", [
  "robots_disallow",
  "http_forbidden",
  "login_required",
  "other",
]);

// INDETERMINATE is a first-class result: the page does not give a clear answer.
// ERROR means the check itself threw; it is never shown as a finding about the site.
// PRESENT/ABSENT are capacity-check results (Phase 9): a marker of operating scale was or
// was not on the page. Neither is a weakness, and neither carries a severity.
export const findingStatus = pgEnum("finding_status", [
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "INDETERMINATE",
  "ERROR",
  "PRESENT",
  "ABSENT",
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

// Why a lead's state changed (Phase 10). Every transition is recorded with one of these.
export const leadTransitionCause = pgEnum("lead_transition_cause", [
  "created",
  "evaluation",
  "human_override",
  "override_cleared",
  "merge",
  "unmerge",
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
