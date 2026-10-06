CREATE TYPE "public"."score_treatment" AS ENUM('queue_for_review', 'needs_verification', 'reject', 'park');--> statement-breakpoint
ALTER TABLE "lead_evaluations" ADD COLUMN "score_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_evaluations" ADD COLUMN "treatment" "score_treatment";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "segment_fit_set_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "segment_fit_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "segment_fit_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "score_treatment" "score_treatment";--> statement-breakpoint
ALTER TABLE "score_dimensions" ADD COLUMN "inputs" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "rule" text;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN "treatment" "score_treatment";--> statement-breakpoint
ALTER TABLE "lead_evaluations" ADD CONSTRAINT "lead_evaluations_score_id_scores_id_fk" FOREIGN KEY ("score_id") REFERENCES "public"."scores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- A segment fit set before Phase 11 had no attribution; keep it, marked as such.
UPDATE "leads" SET "segment_fit_set_by" = 'migration 0010', "segment_fit_set_at" = now(), "segment_fit_reason" = 'Set before segment fit was attributed (Phase 11)'
  WHERE "segment_fit" <> 'unknown';--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_segment_fit_attributed" CHECK ("leads"."segment_fit" = 'unknown' or ("leads"."segment_fit_set_by" is not null and "leads"."segment_fit_set_at" is not null and "leads"."segment_fit_reason" is not null));