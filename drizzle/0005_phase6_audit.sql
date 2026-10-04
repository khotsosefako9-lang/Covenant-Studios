CREATE TYPE "public"."audit_check_category" AS ENUM('technical', 'conversion', 'content');--> statement-breakpoint
ALTER TYPE "public"."audit_status" ADD VALUE 'RENDER_REQUIRED';--> statement-breakpoint
ALTER TYPE "public"."audit_status" ADD VALUE 'SHARED_PLATFORM';--> statement-breakpoint
ALTER TYPE "public"."audit_status" ADD VALUE 'NO_CONTENT';--> statement-breakpoint
CREATE TABLE "audit_checks" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" "audit_check_category" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"version" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text NOT NULL,
	"evidence_recorded" text NOT NULL,
	"config_origin" "config_origin" DEFAULT 'documented' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audits" DROP CONSTRAINT "audits_terminal_completed_at";--> statement-breakpoint
-- INCONCLUSIVE becomes INDETERMINATE in place; stored rows and constraints stay valid.
ALTER TYPE "public"."finding_status" RENAME VALUE 'INCONCLUSIVE' TO 'INDETERMINATE';--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "response_ms" integer;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "declared_length" bigint;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "response_headers" jsonb;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "confidence" numeric(4, 3) NOT NULL;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "status_detail" text;--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "page_source_record_id" uuid;--> statement-breakpoint
ALTER TABLE "finding_opportunity_mappings" ADD CONSTRAINT "finding_opportunity_mappings_check_key_audit_checks_key_fk" FOREIGN KEY ("check_key") REFERENCES "public"."audit_checks"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_check_key_audit_checks_key_fk" FOREIGN KEY ("check_key") REFERENCES "public"."audit_checks"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_page_source_record_id_source_records_id_fk" FOREIGN KEY ("page_source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_confidence_range" CHECK ("audit_findings"."confidence" between 0 and 1);--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_terminal_completed_at" CHECK ("audits"."status" in ('QUEUED', 'RUNNING') or "audits"."completed_at" is not null);