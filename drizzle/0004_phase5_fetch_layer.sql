CREATE TYPE "public"."fetch_purpose" AS ENUM('robots', 'page');--> statement-breakpoint
-- Rename outcome labels in place to the fetch-layer vocabulary. RENAME VALUE keeps every
-- stored row and constraint valid (labels are stored by OID), unlike drop-and-recreate.
ALTER TABLE "source_records" DROP CONSTRAINT "source_records_fetch_has_url";--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'ok' TO 'OK';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'blocked_by_robots' TO 'SOURCE_BLOCKED';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'http_forbidden' TO 'BLOCKED_BY_SERVER';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'http_error' TO 'HTTP_ERROR';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'timeout' TO 'TIMEOUT';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'network_error' TO 'UNREACHABLE';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'tls_error' TO 'TLS_ERROR';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'too_large' TO 'TOO_LARGE';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'redirect_loop' TO 'REDIRECT_LOOP';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" RENAME VALUE 'not_applicable' TO 'NOT_APPLICABLE';--> statement-breakpoint
ALTER TYPE "public"."fetch_outcome" ADD VALUE 'UNSUPPORTED_CONTENT_TYPE';--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "purpose" "fetch_purpose";--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "host" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "attempts" integer;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "redirect_chain" text[];--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "etag" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "last_modified" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "revalidated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "robots_source_record_id" uuid;--> statement-breakpoint
ALTER TABLE "source_records" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_revalidated_from_id_source_records_id_fk" FOREIGN KEY ("revalidated_from_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_robots_source_record_id_source_records_id_fk" FOREIGN KEY ("robots_source_record_id") REFERENCES "public"."source_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_records_host_purpose" ON "source_records" USING btree ("host","purpose","fetched_at");--> statement-breakpoint
CREATE INDEX "source_records_url" ON "source_records" USING btree ("url","fetched_at");--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_fetch_fields" CHECK (("source_records"."retrieval_method" = 'http_fetch') = ("source_records"."purpose" is not null and "source_records"."host" is not null and "source_records"."user_agent" is not null));--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_blocked_proof" CHECK ("source_records"."fetch_outcome" <> 'SOURCE_BLOCKED' or ("source_records"."robots_source_record_id" is not null and "source_records"."http_status" is null and "source_records"."raw_content" is null));--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_fetch_has_url" CHECK ("source_records"."retrieval_method" <> 'http_fetch' or ("source_records"."url" is not null and "source_records"."fetch_outcome" <> 'NOT_APPLICABLE'));