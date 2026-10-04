ALTER TYPE "public"."audit_check_category" ADD VALUE 'capacity';--> statement-breakpoint
ALTER TYPE "public"."finding_status" ADD VALUE 'PRESENT';--> statement-breakpoint
ALTER TYPE "public"."finding_status" ADD VALUE 'ABSENT';--> statement-breakpoint
ALTER TABLE "signal_type_opportunity_types" ADD COLUMN "preference" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_types" ADD COLUMN "detector_params" jsonb;--> statement-breakpoint
ALTER TABLE "audit_checks" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "check_params" jsonb;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "detector_params" jsonb;--> statement-breakpoint
CREATE INDEX "opportunities_current" ON "opportunities" USING btree ("company_id") WHERE "opportunities"."superseded_at" is null;--> statement-breakpoint
ALTER TABLE "signal_types" DROP COLUMN "intent_requires_independent_signal";--> statement-breakpoint
ALTER TABLE "signal_type_opportunity_types" ADD CONSTRAINT "signal_type_opportunity_types_preference" CHECK ("signal_type_opportunity_types"."preference" >= 1);--> statement-breakpoint
-- Phase 9 correction: web_underperformance is Opportunity only, always. Whatever an
-- operator set, it goes back to opportunity before the constraint makes that permanent.
UPDATE "signal_types" SET "axis" = 'opportunity' WHERE "key" = 'web_underperformance';--> statement-breakpoint
UPDATE "signal_types" SET "detectable_from" = 'Audit findings. Counts on the Opportunity axis only, never on Intent'
  WHERE "key" = 'web_underperformance' AND "detectable_from" LIKE '%intent only%';--> statement-breakpoint
ALTER TABLE "signal_types" ADD CONSTRAINT "signal_types_web_underperformance_opportunity" CHECK ("signal_types"."key" <> 'web_underperformance' or "signal_types"."axis" = 'opportunity');--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_severity_only_on_fail" CHECK ("audit_findings"."severity" is null or "audit_findings"."status"::text = 'FAIL');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_confidence_range" CHECK ("opportunities"."confidence" is null or "opportunities"."confidence" between 0 and 1);--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_inferred_scored" CHECK ("opportunities"."claim_type" <> 'INFERRED' or ("opportunities"."relevance" is not null and "opportunities"."confidence" is not null));