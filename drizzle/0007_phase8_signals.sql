ALTER TABLE "signal_type_opportunity_types" ADD COLUMN "config_origin" "config_origin" DEFAULT 'documented' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "signals_detector_run" ON "signals" USING btree ("company_id","signal_type_id","detector_ref");--> statement-breakpoint
-- Phase 8 decision: agency_fatigue is a claim about a business's dissatisfaction with a
-- supplier; nothing on a homepage evidences it, so it is operator-only (enforced by the
-- signals_human_only trigger from migration 0001).
UPDATE "signal_types" SET "human_only" = true WHERE "key" = 'agency_fatigue';
