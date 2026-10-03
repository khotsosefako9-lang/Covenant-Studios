CREATE TYPE "public"."config_origin" AS ENUM('documented', 'default', 'operator');--> statement-breakpoint
CREATE TYPE "public"."csv_row_status" AS ENUM('imported', 'matched_existing', 'invalid', 'failed');--> statement-breakpoint
CREATE TABLE "judgement_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"config_origin" "config_origin" DEFAULT 'documented' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judgement_reasons_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "csv_import_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw_values" text[] NOT NULL,
	"status" "csv_row_status" NOT NULL,
	"company_id" uuid,
	"issue_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"issue_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "csv_import_rows_row_number" CHECK ("csv_import_rows"."row_number" >= 2),
	CONSTRAINT "csv_import_rows_invalid_has_reason" CHECK ("csv_import_rows"."status" not in ('invalid', 'failed') or (cardinality("csv_import_rows"."issue_codes") > 0 and "csv_import_rows"."issue_detail" is not null)),
	CONSTRAINT "csv_import_rows_company" CHECK (("csv_import_rows"."status" in ('imported', 'matched_existing')) = ("csv_import_rows"."company_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "evidence_derivations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "evidence_derivations" CASCADE;--> statement-breakpoint
-- Reason codes move from an enum to the judgement_reasons lookup table. The check that
-- compares against the enum literal is dropped and re-created over text.
ALTER TABLE "judgements" DROP CONSTRAINT "judgements_other_has_notes";--> statement-breakpoint
ALTER TABLE "judgements" ALTER COLUMN "reason_code" SET DATA TYPE text USING "reason_code"::text;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_other_has_notes" CHECK ("judgements"."reason_code" <> 'other' or "judgements"."notes" is not null);--> statement-breakpoint
-- Existing codes (the nine Phase 0 reason codes) must exist before the foreign key.
INSERT INTO "judgement_reasons" ("key", "label", "sort_order") VALUES
  ('strong_commercial_opportunity', 'Strong commercial opportunity', 1),
  ('good_service_fit', 'Good service fit', 2),
  ('poor_digital_presence', 'Poor digital presence', 3),
  ('too_small', 'Too small', 4),
  ('no_obvious_budget', 'No obvious budget', 5),
  ('wrong_industry', 'Wrong industry', 6),
  ('already_well_served', 'Already well served', 7),
  ('no_urgency', 'No urgency', 8),
  ('other', 'Other', 99)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "covenant_services" ADD COLUMN "service_category_id" uuid;--> statement-breakpoint
-- Existing rows get the safe value (never fires automatically); the agreed default rules
-- are applied below, before the column default is removed.
ALTER TABLE "disqualifiers" ADD COLUMN "human_only" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "disqualifiers" ADD COLUMN "config_origin" "config_origin" DEFAULT 'documented' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "config_origin" "config_origin" DEFAULT 'documented' NOT NULL;--> statement-breakpoint
ALTER TABLE "signal_types" ADD COLUMN "config_origin" "config_origin" DEFAULT 'documented' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "csv_import_rows" ADD CONSTRAINT "csv_import_rows_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_import_rows" ADD CONSTRAINT "csv_import_rows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csv_import_rows_record_row" ON "csv_import_rows" USING btree ("source_record_id","row_number");--> statement-breakpoint
CREATE INDEX "csv_import_rows_status" ON "csv_import_rows" USING btree ("status");--> statement-breakpoint
ALTER TABLE "covenant_services" ADD CONSTRAINT "covenant_services_service_category_id_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judgements" ADD CONSTRAINT "judgements_reason_code_judgement_reasons_key_fk" FOREIGN KEY ("reason_code") REFERENCES "public"."judgement_reasons"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "covenant_services" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "disqualifiers" DROP COLUMN "detectable_from_website";--> statement-breakpoint
DROP TYPE "public"."judgement_reason";--> statement-breakpoint
ALTER TABLE "disqualifiers" ALTER COLUMN "human_only" DROP DEFAULT;--> statement-breakpoint
UPDATE "disqualifiers" SET "human_only" = ("key" <> 'bureaucratic_procurement'), "config_origin" = 'default';--> statement-breakpoint
-- The AI spend cap is agreed in rand, not dollars.
UPDATE "settings" SET "key" = 'ai_monthly_cap_zar' WHERE "key" = 'ai_monthly_cap_usd'
  AND NOT EXISTS (SELECT 1 FROM "settings" WHERE "key" = 'ai_monthly_cap_zar');--> statement-breakpoint
DELETE FROM "settings" WHERE "key" = 'ai_monthly_cap_usd';--> statement-breakpoint

-- A human-only disqualifier can never fire automatically: the evidence it rests on must
-- have been supplied by an operator.
CREATE FUNCTION lead_disqualifications_human_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM disqualifiers WHERE id = NEW.disqualifier_id AND human_only)
     AND NOT EXISTS (SELECT 1 FROM evidence WHERE id = NEW.evidence_id AND producer = 'operator') THEN
    RAISE EXCEPTION 'disqualifier % is human-only and needs operator-supplied evidence', NEW.disqualifier_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lead_disqualifications_human_only BEFORE INSERT OR UPDATE ON lead_disqualifications
  FOR EACH ROW EXECUTE FUNCTION lead_disqualifications_human_only();
