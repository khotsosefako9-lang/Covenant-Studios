CREATE TYPE "public"."ai_run_status" AS ENUM('succeeded', 'invalid_output', 'needs_human', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_block_reason" AS ENUM('robots_disallow', 'http_forbidden', 'login_required', 'other');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'SOURCE_BLOCKED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."benchmark_outcome" AS ENUM('agreement', 'false_positive', 'false_negative', 'partial_disagreement');--> statement-breakpoint
CREATE TYPE "public"."billing_period" AS ENUM('once', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."brief_field" AS ENUM('commercial_friction', 'evidence', 'likely_opportunity', 'covenant_capability', 'confidence', 'needs_verification');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('email', 'phone', 'whatsapp', 'profile_url');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel_suitability" AS ENUM('cold_outreach_allowed', 'cold_outreach_disallowed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."channel_verification" AS ENUM('unverified', 'verified', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."claim_type" AS ENUM('VERIFIED', 'INFERRED', 'REPORTED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."company_alias_kind" AS ENUM('legal_name', 'trading_name', 'former_name', 'former_domain', 'merged_identity');--> statement-breakpoint
CREATE TYPE "public"."company_created_via" AS ENUM('manual', 'csv');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'merged');--> statement-breakpoint
CREATE TYPE "public"."duplicate_candidate_status" AS ENUM('proposed', 'confirmed_duplicate', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."duplicate_match_basis" AS ENUM('domain', 'normalised_name', 'phone', 'email');--> statement-breakpoint
CREATE TYPE "public"."evidence_producer" AS ENUM('audit', 'ingest', 'operator', 'ai');--> statement-breakpoint
CREATE TYPE "public"."fetch_outcome" AS ENUM('ok', 'blocked_by_robots', 'http_forbidden', 'http_error', 'timeout', 'network_error', 'tls_error', 'too_large', 'redirect_loop', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('info', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('PASS', 'FAIL', 'NOT_APPLICABLE', 'INCONCLUSIVE', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."finding_verdict" AS ENUM('confirmed_true', 'false_positive', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."intent_gate_basis" AS ENUM('buying_signal', 'commercial_potential_floor', 'human_override');--> statement-breakpoint
CREATE TYPE "public"."intent_gate_status" AS ENUM('NOT_EVALUATED', 'PASSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."judgement_context" AS ENUM('benchmark_blind', 'review');--> statement-breakpoint
CREATE TYPE "public"."judgement_reason" AS ENUM('strong_commercial_opportunity', 'good_service_fit', 'poor_digital_presence', 'too_small', 'no_obvious_budget', 'wrong_industry', 'already_well_served', 'no_urgency', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_state" AS ENUM('PENDING_EVALUATION', 'WATCH_WEAKNESS_ONLY', 'COMMERCIAL_OPPORTUNITY', 'OUTREACH_READY', 'DISQUALIFIED');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('debug', 'info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."opportunity_type_origin" AS ENUM('service_catalogue', 'case_study');--> statement-breakpoint
CREATE TYPE "public"."retrieval_method" AS ENUM('http_fetch', 'csv_import', 'manual_entry', 'operator_statement');--> statement-breakpoint
CREATE TYPE "public"."revenue_model" AS ENUM('one_off', 'recurring', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."score_axis" AS ENUM('intent', 'opportunity');--> statement-breakpoint
CREATE TYPE "public"."score_dimension" AS ENUM('buying_signal', 'icp_fit', 'digital_opportunity', 'service_fit', 'commercial_potential', 'contactability', 'evidence_quality');--> statement-breakpoint
CREATE TYPE "public"."segment_fit" AS ENUM('fit', 'potentially_valid', 'not_fit', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."service_unit" AS ENUM('project', 'add_on', 'per_piece', 'retainer', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."signal_detected_by" AS ENUM('rule', 'operator');--> statement-breakpoint
CREATE TYPE "public"."signal_kind" AS ENUM('documented_trigger', 'friction');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('active', 'retracted');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('website_fetch', 'csv_import', 'manual_entry', 'human_operator');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('YES', 'MAYBE', 'NO');--> statement-breakpoint
CREATE TABLE "covenant_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"unit" "service_unit" NOT NULL,
	"revenue_model" "revenue_model" NOT NULL,
	"billing_period" "billing_period" NOT NULL,
	"price_low_zar" integer,
	"price_high_zar" integer,
	"published" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "covenant_services_key_unique" UNIQUE("key"),
	CONSTRAINT "covenant_services_published_has_price" CHECK (not "covenant_services"."published" or "covenant_services"."price_low_zar" is not null),
	CONSTRAINT "covenant_services_unpublished_no_price" CHECK ("covenant_services"."published" or ("covenant_services"."price_low_zar" is null and "covenant_services"."price_high_zar" is null)),
	CONSTRAINT "covenant_services_price_range" CHECK ("covenant_services"."price_high_zar" is null or ("covenant_services"."price_low_zar" is not null and "covenant_services"."price_high_zar" >= "covenant_services"."price_low_zar")),
	CONSTRAINT "covenant_services_price_positive" CHECK ("covenant_services"."price_low_zar" is null or "covenant_services"."price_low_zar" > 0)
);
--> statement-breakpoint
CREATE TABLE "disqualifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"evidence_requirement" text,
	"detectable_from_website" boolean NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "disqualifiers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "finding_opportunity_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_key" text NOT NULL,
	"opportunity_type_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icp_segment_services" (
	"icp_segment_id" uuid NOT NULL,
	"covenant_service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icp_segment_services_icp_segment_id_covenant_service_id_pk" PRIMARY KEY("icp_segment_id","covenant_service_id")
);
--> statement-breakpoint
CREATE TABLE "icp_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"definition" text NOT NULL,
	"criteria" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "icp_segments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "opportunity_type_services" (
	"opportunity_type_id" uuid NOT NULL,
	"covenant_service_id" uuid NOT NULL,
	"preference" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_type_services_opportunity_type_id_covenant_service_id_pk" PRIMARY KEY("opportunity_type_id","covenant_service_id"),
	CONSTRAINT "opportunity_type_services_preference" CHECK ("opportunity_type_services"."preference" >= 1)
);
--> statement-breakpoint
CREATE TABLE "opportunity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"origin" "opportunity_type_origin" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"description" text NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_type_opportunity_types" (
	"signal_type_id" uuid NOT NULL,
	"opportunity_type_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_type_opportunity_types_signal_type_id_opportunity_type_id_pk" PRIMARY KEY("signal_type_id","opportunity_type_id")
);
--> statement-breakpoint
CREATE TABLE "signal_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "signal_kind" NOT NULL,
	"axis" "score_axis",
	"intent_requires_independent_signal" boolean DEFAULT false NOT NULL,
	"human_only" boolean DEFAULT false NOT NULL,
	"decay_days" integer,
	"detectable_from" text,
	"group" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_types_key_unique" UNIQUE("key"),
	CONSTRAINT "signal_types_decay_positive" CHECK ("signal_types"."decay_days" is null or "signal_types"."decay_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "weight_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" text,
	"w_buying_signal" numeric(5, 4) NOT NULL,
	"w_icp_fit" numeric(5, 4) NOT NULL,
	"w_digital_opportunity" numeric(5, 4) NOT NULL,
	"w_service_fit" numeric(5, 4) NOT NULL,
	"w_commercial_potential" numeric(5, 4) NOT NULL,
	"w_contactability" numeric(5, 4) NOT NULL,
	"w_evidence_quality" numeric(5, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weight_sets_range" CHECK (least("weight_sets"."w_buying_signal", "weight_sets"."w_icp_fit", "weight_sets"."w_digital_opportunity", "weight_sets"."w_service_fit", "weight_sets"."w_commercial_potential", "weight_sets"."w_contactability", "weight_sets"."w_evidence_quality") >= 0
        and greatest("weight_sets"."w_buying_signal", "weight_sets"."w_icp_fit", "weight_sets"."w_digital_opportunity", "weight_sets"."w_service_fit", "weight_sets"."w_commercial_potential", "weight_sets"."w_contactability", "weight_sets"."w_evidence_quality") <= 1),
	CONSTRAINT "weight_sets_sum_to_one" CHECK (abs("weight_sets"."w_buying_signal" + "weight_sets"."w_icp_fit" + "weight_sets"."w_digital_opportunity" + "weight_sets"."w_service_fit" + "weight_sets"."w_commercial_potential" + "weight_sets"."w_contactability" + "weight_sets"."w_evidence_quality" - 1) < 0.0001)
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text,
	"display_name" text NOT NULL,
	"normalised_name" text NOT NULL,
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"merged_into_id" uuid,
	"created_via" "company_created_via" NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_domain_normalised" CHECK ("companies"."domain" is null or ("companies"."domain" = lower("companies"."domain") and "companies"."domain" !~ '^www\.' and "companies"."domain" !~ '[/:@\s]' and "companies"."domain" ~ '\.')),
	CONSTRAINT "companies_merge_consistent" CHECK (("companies"."status" = 'merged') = ("companies"."merged_into_id" is not null) and "companies"."merged_into_id" is distinct from "companies"."id")
);
--> statement-breakpoint
CREATE TABLE "company_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "company_alias_kind" NOT NULL,
	"value" text NOT NULL,
	"normalised_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_duplicate_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_a_id" uuid NOT NULL,
	"company_b_id" uuid NOT NULL,
	"match_basis" "duplicate_match_basis" NOT NULL,
	"matched_value" text NOT NULL,
	"similarity" numeric(4, 3),
	"status" "duplicate_candidate_status" DEFAULT 'proposed' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_duplicate_candidates_ordered" CHECK ("company_duplicate_candidates"."company_a_id" < "company_duplicate_candidates"."company_b_id"),
	CONSTRAINT "company_duplicate_candidates_similarity" CHECK ("company_duplicate_candidates"."similarity" is null or "company_duplicate_candidates"."similarity" between 0 and 1),
	CONSTRAINT "company_duplicate_candidates_resolution" CHECK (("company_duplicate_candidates"."status" = 'proposed') = ("company_duplicate_candidates"."resolved_by" is null and "company_duplicate_candidates"."resolved_at" is null))
);
--> statement-breakpoint
CREATE TABLE "contact_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"kind" "channel_kind" NOT NULL,
	"value" text NOT NULL,
	"normalised_value" text NOT NULL,
	"verification" "channel_verification" DEFAULT 'unverified' NOT NULL,
	"evidence_id" uuid NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"full_name" text,
	"role" text,
	"is_decision_maker" boolean,
	"evidence_id" uuid NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"producer" "evidence_producer" NOT NULL,
	"claim_key" text NOT NULL,
	"claim" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"value" text,
	"excerpt" text,
	"locator" text,
	"inference_rule" text,
	"confidence" numeric(4, 3),
	"observed_at" timestamp with time zone NOT NULL,
	"last_verified_at" timestamp with time zone,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_inferred_has_rule" CHECK ("evidence"."claim_type" <> 'INFERRED' or "evidence"."inference_rule" is not null),
	CONSTRAINT "evidence_unknown_has_no_value" CHECK ("evidence"."claim_type" <> 'UNKNOWN' or "evidence"."value" is null),
	CONSTRAINT "evidence_confidence_range" CHECK ("evidence"."confidence" is null or "evidence"."confidence" between 0 and 1),
	CONSTRAINT "evidence_not_self_superseded" CHECK ("evidence"."superseded_by_id" is distinct from "evidence"."id")
);
--> statement-breakpoint
CREATE TABLE "evidence_derivations" (
	"evidence_id" uuid NOT NULL,
	"derived_from_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_derivations_evidence_id_derived_from_id_pk" PRIMARY KEY("evidence_id","derived_from_id"),
	CONSTRAINT "evidence_derivations_not_self" CHECK ("evidence_derivations"."evidence_id" <> "evidence_derivations"."derived_from_id")
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid,
	"retrieval_method" "retrieval_method" NOT NULL,
	"url" text,
	"final_url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"fetch_outcome" "fetch_outcome" NOT NULL,
	"http_status" integer,
	"content_type" text,
	"content_hash" text,
	"byte_size" bigint,
	"raw_content" text,
	"attributed_to" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_records_fetch_has_url" CHECK ("source_records"."retrieval_method" <> 'http_fetch' or ("source_records"."url" is not null and "source_records"."fetch_outcome" <> 'not_applicable')),
	CONSTRAINT "source_records_human_attributed" CHECK ("source_records"."retrieval_method" not in ('operator_statement', 'manual_entry') or "source_records"."attributed_to" is not null),
	CONSTRAINT "source_records_http_status" CHECK ("source_records"."http_status" is null or "source_records"."http_status" between 100 and 599)
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"min_interval_ms" integer,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "audit_finding_evidence" (
	"audit_finding_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_finding_evidence_audit_finding_id_evidence_id_pk" PRIMARY KEY("audit_finding_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"check_version" text NOT NULL,
	"status" "finding_status" NOT NULL,
	"severity" "finding_severity",
	"detail" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_findings_fail_has_severity" CHECK ("audit_findings"."status" <> 'FAIL' or "audit_findings"."severity" is not null)
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"target_url" text NOT NULL,
	"status" "audit_status" DEFAULT 'QUEUED' NOT NULL,
	"check_set_version" text NOT NULL,
	"block_reason" "audit_block_reason",
	"block_source_record_id" uuid,
	"error_code" text,
	"error_detail" text,
	"trace_id" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audits_blocked_has_reason" CHECK (("audits"."status" = 'SOURCE_BLOCKED') = ("audits"."block_reason" is not null)),
	CONSTRAINT "audits_blocked_has_proof" CHECK ("audits"."status" <> 'SOURCE_BLOCKED' or "audits"."block_source_record_id" is not null),
	CONSTRAINT "audits_failed_has_error" CHECK ("audits"."status" <> 'FAILED' or "audits"."error_code" is not null),
	CONSTRAINT "audits_terminal_completed_at" CHECK ("audits"."status" not in ('COMPLETED', 'SOURCE_BLOCKED', 'FAILED') or "audits"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "finding_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_finding_id" uuid NOT NULL,
	"verdict" "finding_verdict" NOT NULL,
	"note" text,
	"verified_by" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"opportunity_type_id" uuid NOT NULL,
	"covenant_service_id" uuid,
	"rank" smallint NOT NULL,
	"relevance" numeric(4, 3),
	"claim_type" "claim_type" DEFAULT 'INFERRED' NOT NULL,
	"rationale" text NOT NULL,
	"inference_rule" text NOT NULL,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_rank" CHECK ("opportunities"."rank" >= 1),
	CONSTRAINT "opportunities_relevance_range" CHECK ("opportunities"."relevance" is null or "opportunities"."relevance" between 0 and 1),
	CONSTRAINT "opportunities_interpretation" CHECK ("opportunities"."claim_type" in ('INFERRED', 'REPORTED'))
);
--> statement-breakpoint
CREATE TABLE "opportunity_findings" (
	"opportunity_id" uuid NOT NULL,
	"audit_finding_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_findings_opportunity_id_audit_finding_id_pk" PRIMARY KEY("opportunity_id","audit_finding_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_signals" (
	"opportunity_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_signals_opportunity_id_signal_id_pk" PRIMARY KEY("opportunity_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE "signal_evidence" (
	"signal_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_evidence_signal_id_evidence_id_pk" PRIMARY KEY("signal_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "signal_findings" (
	"signal_id" uuid NOT NULL,
	"audit_finding_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_findings_signal_id_audit_finding_id_pk" PRIMARY KEY("signal_id","audit_finding_id")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"signal_type_id" uuid NOT NULL,
	"strength" numeric(4, 3) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"decays_at" timestamp with time zone,
	"detected_by" "signal_detected_by" NOT NULL,
	"detector_ref" text NOT NULL,
	"status" "signal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_strength_range" CHECK ("signals"."strength" between 0 and 1),
	CONSTRAINT "signals_decay_after_observed" CHECK ("signals"."decays_at" is null or "signals"."decays_at" > "signals"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "judgement_evidence" (
	"judgement_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judgement_evidence_judgement_id_evidence_id_pk" PRIMARY KEY("judgement_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "judgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"context" "judgement_context" NOT NULL,
	"score_id" uuid,
	"verdict" "verdict" NOT NULL,
	"reason_code" "judgement_reason" NOT NULL,
	"notes" text,
	"actor" text NOT NULL,
	"judged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judgements_id_context" UNIQUE("id","context"),
	CONSTRAINT "judgements_review_has_score" CHECK ("judgements"."context" <> 'review' or "judgements"."score_id" is not null),
	CONSTRAINT "judgements_blind_has_no_score" CHECK ("judgements"."context" <> 'benchmark_blind' or "judgements"."score_id" is null),
	CONSTRAINT "judgements_other_has_notes" CHECK ("judgements"."reason_code" <> 'other' or "judgements"."notes" is not null)
);
--> statement-breakpoint
CREATE TABLE "lead_disqualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"disqualifier_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"icp_segment_id" uuid,
	"status" "lead_status" DEFAULT 'open' NOT NULL,
	"owner" text,
	"lead_state" "lead_state" DEFAULT 'PENDING_EVALUATION' NOT NULL,
	"intent_gate_status" "intent_gate_status" DEFAULT 'NOT_EVALUATED' NOT NULL,
	"intent_gate_basis" "intent_gate_basis",
	"intent_gate_evaluated_at" timestamp with time zone,
	"intent_gate_override_by" text,
	"intent_gate_override_reason" text,
	"segment_fit" "segment_fit" DEFAULT 'unknown' NOT NULL,
	"outreach_channel_suitability" "outreach_channel_suitability" DEFAULT 'unknown' NOT NULL,
	"channel_suitability_reason" text,
	"current_score_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_qualified_requires_gate" CHECK ("leads"."lead_state" not in ('COMMERCIAL_OPPORTUNITY', 'OUTREACH_READY') or "leads"."intent_gate_status" = 'PASSED'),
	CONSTRAINT "leads_gate_passed_has_basis" CHECK (("leads"."intent_gate_status" = 'PASSED') = ("leads"."intent_gate_basis" is not null)),
	CONSTRAINT "leads_gate_evaluated_at" CHECK (("leads"."intent_gate_status" = 'NOT_EVALUATED') = ("leads"."intent_gate_evaluated_at" is null)),
	CONSTRAINT "leads_override_has_reason" CHECK ("leads"."intent_gate_basis" is distinct from 'human_override' or ("leads"."intent_gate_override_by" is not null and "leads"."intent_gate_override_reason" is not null)),
	CONSTRAINT "leads_channel_disallowed_has_reason" CHECK ("leads"."outreach_channel_suitability" <> 'cold_outreach_disallowed' or "leads"."channel_suitability_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "score_dimension_evidence" (
	"score_id" uuid NOT NULL,
	"dimension" "score_dimension" NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_dimension_evidence_score_id_dimension_evidence_id_pk" PRIMARY KEY("score_id","dimension","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "score_dimensions" (
	"score_id" uuid NOT NULL,
	"dimension" "score_dimension" NOT NULL,
	"value" numeric(5, 4) NOT NULL,
	"weight" numeric(5, 4) NOT NULL,
	"decay" numeric(5, 4) NOT NULL,
	"contribution" numeric(5, 2) NOT NULL,
	"coverage" numeric(5, 4) NOT NULL,
	"recency" numeric(5, 4) NOT NULL,
	"verifiability" numeric(5, 4) NOT NULL,
	"explanation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "score_dimensions_score_id_dimension_pk" PRIMARY KEY("score_id","dimension"),
	CONSTRAINT "score_dimensions_unit_range" CHECK (least("score_dimensions"."value", "score_dimensions"."weight", "score_dimensions"."decay", "score_dimensions"."coverage", "score_dimensions"."recency", "score_dimensions"."verifiability") >= 0
        and greatest("score_dimensions"."value", "score_dimensions"."weight", "score_dimensions"."decay", "score_dimensions"."coverage", "score_dimensions"."recency", "score_dimensions"."verifiability") <= 1),
	CONSTRAINT "score_dimensions_contribution_range" CHECK ("score_dimensions"."contribution" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"weight_set_id" uuid NOT NULL,
	"audit_id" uuid,
	"total" numeric(5, 2) NOT NULL,
	"opportunity_axis" numeric(5, 2),
	"intent_axis" numeric(5, 2),
	"confidence" numeric(5, 4) NOT NULL,
	"evidence_quality" numeric(5, 4) NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scores_id_lead" UNIQUE("id","lead_id"),
	CONSTRAINT "scores_total_range" CHECK ("scores"."total" between 0 and 100),
	CONSTRAINT "scores_axes_range" CHECK (coalesce("scores"."opportunity_axis", 0) between 0 and 100 and coalesce("scores"."intent_axis", 0) between 0 and 100),
	CONSTRAINT "scores_confidence_range" CHECK ("scores"."confidence" between 0 and 1),
	CONSTRAINT "scores_evidence_quality_range" CHECK ("scores"."evidence_quality" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "benchmark_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid,
	"selection_criteria" text NOT NULL,
	"typicality_rationale" text NOT NULL,
	"alternatives_considered" text NOT NULL,
	"atypical_notes" text,
	"selected_by" text NOT NULL,
	"selected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"human_judgement_id" uuid,
	"human_judgement_context" "judgement_context",
	"system_score_id" uuid,
	"system_lead_state" "lead_state",
	"outcome" "benchmark_outcome",
	"diagnosis" text,
	"compared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_cases_judgement_is_blind" CHECK (("benchmark_cases"."human_judgement_id" is null) = ("benchmark_cases"."human_judgement_context" is null)
        and "benchmark_cases"."human_judgement_context" is distinct from 'review'),
	CONSTRAINT "benchmark_cases_comparison_complete" CHECK ("benchmark_cases"."outcome" is null or ("benchmark_cases"."human_judgement_id" is not null and "benchmark_cases"."system_score_id" is not null and "benchmark_cases"."system_lead_state" is not null and "benchmark_cases"."compared_at" is not null)),
	CONSTRAINT "benchmark_cases_disagreement_diagnosed" CHECK ("benchmark_cases"."outcome" is null or "benchmark_cases"."outcome" = 'agreement' or "benchmark_cases"."diagnosis" is not null)
);
--> statement-breakpoint
CREATE TABLE "benchmark_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_version" text NOT NULL,
	"number" smallint NOT NULL,
	"name" text NOT NULL,
	"expected_verdict" "verdict" NOT NULL,
	"verdict_qualifier" text,
	"commercial_driver" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"tier" text NOT NULL,
	"input_usd_per_mtok" numeric(10, 4),
	"output_usd_per_mtok" numeric(10, 4),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_run_packet_evidence" (
	"ai_run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_packet_evidence_ai_run_id_evidence_id_pk" PRIMARY KEY("ai_run_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task_key" text NOT NULL,
	"prompt_name" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"company_id" uuid,
	"lead_id" uuid,
	"status" "ai_run_status" NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(12, 6),
	"latency_ms" integer,
	"error_detail" text,
	"trace_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_non_negative" CHECK (coalesce("ai_runs"."input_tokens", 0) >= 0 and coalesce("ai_runs"."output_tokens", 0) >= 0 and coalesce("ai_runs"."cost_usd", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "brief_claim_evidence" (
	"brief_claim_id" uuid NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_claim_evidence_brief_claim_id_evidence_id_pk" PRIMARY KEY("brief_claim_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "brief_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brief_id" uuid NOT NULL,
	"ai_run_id" uuid NOT NULL,
	"field" "brief_field" NOT NULL,
	"position" smallint DEFAULT 1 NOT NULL,
	"text" text NOT NULL,
	"claim_type" "claim_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brief_claims_id_run" UNIQUE("id","ai_run_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"lead_id" uuid,
	"ai_run_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"covenant_service_id" uuid,
	"insufficient_evidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_briefs_id_run" UNIQUE("id","ai_run_id")
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" "log_level" NOT NULL,
	"trace_id" text,
	"stage" text NOT NULL,
	"event" text NOT NULL,
	"company_id" uuid,
	"duration_ms" integer,
	"message" text,
	"context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finding_opportunity_mappings" ADD CONSTRAINT "finding_opportunity_mappings_opportunity_type_id_opportunity_types_id_fk" FOREIGN KEY ("opportunity_type_id") REFERENCES "public"."opportunity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_segment_services" ADD CONSTRAINT "icp_segment_services_icp_segment_id_icp_segments_id_fk" FOREIGN KEY ("icp_segment_id") REFERENCES "public"."icp_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icp_segment_services" ADD CONSTRAINT "icp_segment_services_covenant_service_id_covenant_services_id_fk" FOREIGN KEY ("covenant_service_id") REFERENCES "public"."covenant_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_type_services" ADD CONSTRAINT "opportunity_type_services_opportunity_type_id_opportunity_types_id_fk" FOREIGN KEY ("opportunity_type_id") REFERENCES "public"."opportunity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_type_services" ADD CONSTRAINT "opportunity_type_services_covenant_service_id_covenant_services_id_fk" FOREIGN KEY ("covenant_service_id") REFERENCES "public"."covenant_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_type_opportunity_types" ADD CONSTRAINT "signal_type_opportunity_types_signal_type_id_signal_types_id_fk" FOREIGN KEY ("signal_type_id") REFERENCES "public"."signal_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_type_opportunity_types" ADD CONSTRAINT "signal_type_opportunity_types_opportunity_type_id_opportunity_types_id_fk" FOREIGN KEY ("opportunity_type_id") REFERENCES "public"."opportunity_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_merged_into_id_companies_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "company_duplicate_candidates_company_a_id_companies_id_fk" FOREIGN KEY ("company_a_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_duplicate_candidates" ADD CONSTRAINT "company_duplicate_candidates_company_b_id_companies_id_fk" FOREIGN KEY ("company_b_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channels" ADD CONSTRAINT "contact_channels_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_superseded_by_id_evidence_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_derivations" ADD CONSTRAINT "evidence_derivations_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_derivations" ADD CONSTRAINT "evidence_derivations_derived_from_id_evidence_id_fk" FOREIGN KEY ("derived_from_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_evidence" ADD CONSTRAINT "audit_finding_evidence_audit_finding_id_audit_findings_id_fk" FOREIGN KEY ("audit_finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_finding_evidence" ADD CONSTRAINT "audit_finding_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_block_source_record_id_source_records_id_fk" FOREIGN KEY ("block_source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_verifications" ADD CONSTRAINT "finding_verifications_audit_finding_id_audit_findings_id_fk" FOREIGN KEY ("audit_finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_opportunity_type_id_opportunity_types_id_fk" FOREIGN KEY ("opportunity_type_id") REFERENCES "public"."opportunity_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_covenant_service_id_covenant_services_id_fk" FOREIGN KEY ("covenant_service_id") REFERENCES "public"."covenant_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_findings" ADD CONSTRAINT "opportunity_findings_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_findings" ADD CONSTRAINT "opportunity_findings_audit_finding_id_audit_findings_id_fk" FOREIGN KEY ("audit_finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_signals" ADD CONSTRAINT "opportunity_signals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_signals" ADD CONSTRAINT "opportunity_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_evidence" ADD CONSTRAINT "signal_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_findings" ADD CONSTRAINT "signal_findings_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_findings" ADD CONSTRAINT "signal_findings_audit_finding_id_audit_findings_id_fk" FOREIGN KEY ("audit_finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_signal_type_id_signal_types_id_fk" FOREIGN KEY ("signal_type_id") REFERENCES "public"."signal_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgement_evidence" ADD CONSTRAINT "judgement_evidence_judgement_id_judgements_id_fk" FOREIGN KEY ("judgement_id") REFERENCES "public"."judgements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgement_evidence" ADD CONSTRAINT "judgement_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_score_id_lead_id_scores_id_lead_id_fk" FOREIGN KEY ("score_id","lead_id") REFERENCES "public"."scores"("id","lead_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD CONSTRAINT "lead_disqualifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD CONSTRAINT "lead_disqualifications_disqualifier_id_disqualifiers_id_fk" FOREIGN KEY ("disqualifier_id") REFERENCES "public"."disqualifiers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD CONSTRAINT "lead_disqualifications_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_icp_segment_id_icp_segments_id_fk" FOREIGN KEY ("icp_segment_id") REFERENCES "public"."icp_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_current_score_id_scores_id_fk" FOREIGN KEY ("current_score_id") REFERENCES "public"."scores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_dimension_evidence" ADD CONSTRAINT "score_dimension_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_dimension_evidence" ADD CONSTRAINT "score_dimension_evidence_score_id_dimension_score_dimensions_score_id_dimension_fk" FOREIGN KEY ("score_id","dimension") REFERENCES "public"."score_dimensions"("score_id","dimension") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_dimensions" ADD CONSTRAINT "score_dimensions_score_id_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_weight_set_id_weight_sets_id_fk" FOREIGN KEY ("weight_set_id") REFERENCES "public"."weight_sets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_category_id_benchmark_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."benchmark_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_system_score_id_scores_id_fk" FOREIGN KEY ("system_score_id") REFERENCES "public"."scores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_cases" ADD CONSTRAINT "benchmark_cases_human_judgement_id_human_judgement_context_judgements_id_context_fk" FOREIGN KEY ("human_judgement_id","human_judgement_context") REFERENCES "public"."judgements"("id","context") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_packet_evidence" ADD CONSTRAINT "ai_run_packet_evidence_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_packet_evidence" ADD CONSTRAINT "ai_run_packet_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_claim_evidence" ADD CONSTRAINT "brief_claim_evidence_brief_claim_id_ai_run_id_brief_claims_id_ai_run_id_fk" FOREIGN KEY ("brief_claim_id","ai_run_id") REFERENCES "public"."brief_claims"("id","ai_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_claim_evidence" ADD CONSTRAINT "brief_claim_evidence_ai_run_id_evidence_id_ai_run_packet_evidence_ai_run_id_evidence_id_fk" FOREIGN KEY ("ai_run_id","evidence_id") REFERENCES "public"."ai_run_packet_evidence"("ai_run_id","evidence_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_claims" ADD CONSTRAINT "brief_claims_brief_id_ai_run_id_opportunity_briefs_id_ai_run_id_fk" FOREIGN KEY ("brief_id","ai_run_id") REFERENCES "public"."opportunity_briefs"("id","ai_run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_briefs" ADD CONSTRAINT "opportunity_briefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_briefs" ADD CONSTRAINT "opportunity_briefs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_briefs" ADD CONSTRAINT "opportunity_briefs_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_briefs" ADD CONSTRAINT "opportunity_briefs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_briefs" ADD CONSTRAINT "opportunity_briefs_covenant_service_id_covenant_services_id_fk" FOREIGN KEY ("covenant_service_id") REFERENCES "public"."covenant_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_events" ADD CONSTRAINT "system_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_opportunity_mappings_unique" ON "finding_opportunity_mappings" USING btree ("check_key","opportunity_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_sets_name_version" ON "weight_sets" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "weight_sets_single_active" ON "weight_sets" USING btree ("is_active") WHERE "weight_sets"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "companies_active_domain" ON "companies" USING btree ("domain") WHERE "companies"."status" = 'active' and "companies"."domain" is not null;--> statement-breakpoint
CREATE INDEX "companies_normalised_name" ON "companies" USING btree ("normalised_name");--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_unique" ON "company_aliases" USING btree ("company_id","kind","normalised_value");--> statement-breakpoint
CREATE INDEX "company_aliases_normalised" ON "company_aliases" USING btree ("normalised_value");--> statement-breakpoint
CREATE UNIQUE INDEX "company_duplicate_candidates_pair" ON "company_duplicate_candidates" USING btree ("company_a_id","company_b_id","match_basis");--> statement-breakpoint
CREATE INDEX "company_duplicate_candidates_b" ON "company_duplicate_candidates" USING btree ("company_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_channels_unique" ON "contact_channels" USING btree ("company_id","kind","normalised_value");--> statement-breakpoint
CREATE INDEX "contact_channels_lookup" ON "contact_channels" USING btree ("kind","normalised_value");--> statement-breakpoint
CREATE INDEX "contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_company_claim" ON "evidence" USING btree ("company_id","claim_key","observed_at");--> statement-breakpoint
CREATE INDEX "evidence_source_record" ON "evidence" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "source_records_company_fetched" ON "source_records" USING btree ("company_id","fetched_at");--> statement-breakpoint
CREATE INDEX "source_records_hash" ON "source_records" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "audit_finding_evidence_evidence" ON "audit_finding_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_findings_audit_check" ON "audit_findings" USING btree ("audit_id","check_key");--> statement-breakpoint
CREATE INDEX "audit_findings_check_status" ON "audit_findings" USING btree ("check_key","status");--> statement-breakpoint
CREATE INDEX "audits_company_created" ON "audits" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "audits_status" ON "audits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "finding_verifications_finding" ON "finding_verifications" USING btree ("audit_finding_id","verified_at");--> statement-breakpoint
CREATE INDEX "opportunities_company" ON "opportunities" USING btree ("company_id","derived_at");--> statement-breakpoint
CREATE INDEX "signals_company_type" ON "signals" USING btree ("company_id","signal_type_id","observed_at");--> statement-breakpoint
CREATE INDEX "judgements_lead" ON "judgements" USING btree ("lead_id","judged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_disqualifications_unique" ON "lead_disqualifications" USING btree ("lead_id","disqualifier_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_one_open_per_company" ON "leads" USING btree ("company_id") WHERE "leads"."status" = 'open';--> statement-breakpoint
CREATE INDEX "leads_state" ON "leads" USING btree ("lead_state");--> statement-breakpoint
CREATE INDEX "scores_lead_computed" ON "scores" USING btree ("lead_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_cases_category" ON "benchmark_cases" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_cases_company" ON "benchmark_cases" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_categories_version_number" ON "benchmark_categories" USING btree ("dataset_version","number");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_provider_model" ON "ai_models" USING btree ("provider","model_id");--> statement-breakpoint
CREATE INDEX "ai_runs_started" ON "ai_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_runs_company" ON "ai_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ai_runs_trace" ON "ai_runs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "opportunity_briefs_company" ON "opportunity_briefs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "system_events_trace" ON "system_events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "system_events_occurred" ON "system_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE VIEW "public"."evidence_provenance" AS (
  select e.id as evidence_id, e.company_id, e.claim_key, e.claim, e.claim_type, e.value,
         e.producer, e.observed_at, e.superseded_by_id, e.source_record_id,
         coalesce(sr.final_url, sr.url) as source_url, sr.fetched_at as retrieved_at,
         sr.retrieval_method, sr.attributed_to
  from evidence e
  join source_records sr on sr.id = e.source_record_id
);