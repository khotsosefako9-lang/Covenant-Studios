CREATE TYPE "public"."duplicate_resolution_action" AS ENUM('confirm', 'reject', 'defer', 'unmerge');--> statement-breakpoint
ALTER TYPE "public"."company_alias_kind" ADD VALUE 'merged_domain';--> statement-breakpoint
ALTER TYPE "public"."duplicate_candidate_status" ADD VALUE 'deferred';--> statement-breakpoint
CREATE TABLE "company_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"winner_id" uuid NOT NULL,
	"loser_id" uuid NOT NULL,
	"merged_by" text NOT NULL,
	"reason" text NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unmerged_by" text,
	"unmerge_reason" text,
	"unmerged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_merges_distinct" CHECK ("company_merges"."winner_id" <> "company_merges"."loser_id"),
	CONSTRAINT "company_merges_unmerge_complete" CHECK (("company_merges"."unmerged_at" is null) = ("company_merges"."unmerged_by" is null) and ("company_merges"."unmerged_at" is null) = ("company_merges"."unmerge_reason" is null)),
	CONSTRAINT "company_merges_reason" CHECK (length(trim("company_merges"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "company_non_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_a_id" uuid NOT NULL,
	"company_b_id" uuid NOT NULL,
	"candidate_id" uuid,
	"decided_by" text NOT NULL,
	"reason" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_non_matches_ordered" CHECK ("company_non_matches"."company_a_id" < "company_non_matches"."company_b_id"),
	CONSTRAINT "company_non_matches_reason" CHECK (length(trim("company_non_matches"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "duplicate_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"action" "duplicate_resolution_action" NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"acted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merge_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_resolutions_reason" CHECK (length(trim("duplicate_resolutions"."reason")) > 0 and length(trim("duplicate_resolutions"."actor")) > 0),
	CONSTRAINT "duplicate_resolutions_merge_link" CHECK (("duplicate_resolutions"."action" in ('confirm', 'unmerge')) = ("duplicate_resolutions"."merge_id" is not null))
);
--> statement-breakpoint
DROP INDEX "company_aliases_unique";--> statement-breakpoint
ALTER TABLE "company_aliases" ADD COLUMN "merge_id" uuid;--> statement-breakpoint
ALTER TABLE "company_merges" ADD CONSTRAINT "company_merges_candidate_id_company_duplicate_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."company_duplicate_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_merges" ADD CONSTRAINT "company_merges_winner_id_companies_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_merges" ADD CONSTRAINT "company_merges_loser_id_companies_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_non_matches" ADD CONSTRAINT "company_non_matches_company_a_id_companies_id_fk" FOREIGN KEY ("company_a_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_non_matches" ADD CONSTRAINT "company_non_matches_company_b_id_companies_id_fk" FOREIGN KEY ("company_b_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_non_matches" ADD CONSTRAINT "company_non_matches_candidate_id_company_duplicate_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."company_duplicate_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_resolutions" ADD CONSTRAINT "duplicate_resolutions_candidate_id_company_duplicate_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."company_duplicate_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_resolutions" ADD CONSTRAINT "duplicate_resolutions_merge_id_company_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."company_merges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_merges_one_active_per_loser" ON "company_merges" USING btree ("loser_id") WHERE "company_merges"."unmerged_at" is null;--> statement-breakpoint
CREATE INDEX "company_merges_winner" ON "company_merges" USING btree ("winner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_non_matches_pair" ON "company_non_matches" USING btree ("company_a_id","company_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_resolutions_candidate" ON "duplicate_resolutions" USING btree ("candidate_id","acted_at");--> statement-breakpoint
ALTER TABLE "company_aliases" ADD CONSTRAINT "company_aliases_merge_id_company_merges_id_fk" FOREIGN KEY ("merge_id") REFERENCES "public"."company_merges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_aliases_unique" ON "company_aliases" USING btree ("company_id","kind","value");--> statement-breakpoint
CREATE VIEW "public"."company_roots" AS (
  with recursive chain (company_id, current_id, depth) as (
    select id, id, 0 from companies
    union all
    select chain.company_id, c.merged_into_id, chain.depth + 1
    from chain join companies c on c.id = chain.current_id
    where c.merged_into_id is not null and chain.depth < 50
  )
  select distinct on (company_id) company_id, current_id as root_id, depth
  from chain order by company_id, depth desc
);--> statement-breakpoint
-- A rejected pair is a permanent non-match: it can never be proposed again.
CREATE FUNCTION duplicate_candidates_not_non_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM company_non_matches
             WHERE company_a_id = NEW.company_a_id AND company_b_id = NEW.company_b_id) THEN
    RAISE EXCEPTION 'companies % and % are recorded as a non-match', NEW.company_a_id, NEW.company_b_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER duplicate_candidates_not_non_match BEFORE INSERT ON company_duplicate_candidates
  FOR EACH ROW EXECUTE FUNCTION duplicate_candidates_not_non_match();
--> statement-breakpoint
-- New judgements may only use active reason codes; retired codes stay for existing rows.
CREATE FUNCTION judgements_active_reason() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM judgement_reasons WHERE key = NEW.reason_code AND active) THEN
    RAISE EXCEPTION 'reason code % is retired or unknown', NEW.reason_code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER judgements_active_reason BEFORE INSERT ON judgements
  FOR EACH ROW EXECUTE FUNCTION judgements_active_reason();
--> statement-breakpoint
-- A company can only be merged into an active company, which rules out merge cycles.
CREATE FUNCTION companies_merge_target_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.merged_into_id IS NOT NULL AND NEW.merged_into_id IS DISTINCT FROM OLD.merged_into_id
     AND NOT EXISTS (SELECT 1 FROM companies WHERE id = NEW.merged_into_id AND status = 'active') THEN
    RAISE EXCEPTION 'company % can only be merged into an active company', NEW.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER companies_merge_target_active BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION companies_merge_target_active();
