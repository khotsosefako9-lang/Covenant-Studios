CREATE TYPE "public"."lead_transition_cause" AS ENUM('created', 'evaluation', 'human_override', 'override_cleared', 'merge', 'unmerge');--> statement-breakpoint
ALTER TYPE "public"."audit_check_category" ADD VALUE 'commercial';--> statement-breakpoint
CREATE TABLE "lead_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"audit_id" uuid,
	"evaluated_at" timestamp with time zone NOT NULL,
	"system_state" "lead_state" NOT NULL,
	"gate_status" "intent_gate_status" NOT NULL,
	"gate_basis" "intent_gate_basis",
	"commercial_potential_zar" integer,
	"rule" text NOT NULL,
	"reasons" jsonb NOT NULL,
	"detail" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_evaluations_never_outreach_ready" CHECK ("lead_evaluations"."system_state" <> 'OUTREACH_READY'),
	CONSTRAINT "lead_evaluations_gate_basis" CHECK (("lead_evaluations"."gate_status" = 'PASSED') = ("lead_evaluations"."gate_basis" is not null))
);
--> statement-breakpoint
CREATE TABLE "lead_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_state" "lead_state",
	"to_state" "lead_state" NOT NULL,
	"system_state" "lead_state" NOT NULL,
	"cause" "lead_transition_cause" NOT NULL,
	"evaluation_id" uuid,
	"actor" text NOT NULL,
	"detail" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_state_transitions_evaluation" CHECK ("lead_state_transitions"."cause" <> 'evaluation' or "lead_state_transitions"."evaluation_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "finding_opportunity_mappings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "finding_opportunity_mappings" CASCADE;--> statement-breakpoint
ALTER TABLE "disqualifiers" ADD COLUMN "detection_check_key" text;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD COLUMN "retracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD COLUMN "retracted_by" text;--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD COLUMN "retraction_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "system_lead_state" "lead_state" DEFAULT 'PENDING_EVALUATION' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "state_override" "lead_state";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "state_override_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "state_override_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "state_override_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "system_gate_status" "intent_gate_status" DEFAULT 'NOT_EVALUATED' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "system_gate_basis" "intent_gate_basis";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "last_evaluation_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "channel_suitability_set_by" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "channel_suitability_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed_reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "merged_into_lead_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed_by_merge_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_evaluations" ADD CONSTRAINT "lead_evaluations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_evaluations" ADD CONSTRAINT "lead_evaluations_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_state_transitions" ADD CONSTRAINT "lead_state_transitions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_state_transitions" ADD CONSTRAINT "lead_state_transitions_evaluation_id_lead_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."lead_evaluations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_evaluations_lead" ON "lead_evaluations" USING btree ("lead_id","evaluated_at");--> statement-breakpoint
CREATE INDEX "lead_state_transitions_lead" ON "lead_state_transitions" USING btree ("lead_id","occurred_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_last_evaluation_id_lead_evaluations_id_fk" FOREIGN KEY ("last_evaluation_id") REFERENCES "public"."lead_evaluations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merged_into_lead_id_leads_id_fk" FOREIGN KEY ("merged_into_lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_closed_by_merge_id_company_merges_id_fk" FOREIGN KEY ("closed_by_merge_id") REFERENCES "public"."company_merges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Existing leads (none are written before Phase 10, but keep any that are): a state that
-- only a human can have set becomes a recorded override; everything else is the system's.
UPDATE "leads" SET "state_override" = "lead_state", "state_override_by" = 'migration 0009',
  "state_override_reason" = 'Set before the Phase 10 state machine existed; kept as a human decision', "state_override_at" = now()
  WHERE "lead_state" = 'OUTREACH_READY' OR ("intent_gate_basis" = 'human_override' AND "lead_state" = 'COMMERCIAL_OPPORTUNITY');--> statement-breakpoint
UPDATE "leads" SET "system_lead_state" = "lead_state" WHERE "state_override" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "system_gate_status" = "intent_gate_status", "system_gate_basis" = "intent_gate_basis"
  WHERE "intent_gate_basis" IS DISTINCT FROM 'human_override';--> statement-breakpoint
UPDATE "leads" SET "closed_at" = "updated_at", "closed_reason" = 'closed before Phase 10' WHERE "status" = 'closed';--> statement-breakpoint
ALTER TABLE "disqualifiers" ADD CONSTRAINT "disqualifiers_human_only_not_detected" CHECK (not "disqualifiers"."human_only" or "disqualifiers"."detection_check_key" is null);--> statement-breakpoint
ALTER TABLE "lead_disqualifications" ADD CONSTRAINT "lead_disqualifications_retraction_complete" CHECK (("lead_disqualifications"."retracted_at" is null) = ("lead_disqualifications"."retracted_by" is null) and ("lead_disqualifications"."retracted_at" is null) = ("lead_disqualifications"."retraction_reason" is null));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_effective_state" CHECK ("leads"."lead_state" = coalesce("leads"."state_override", "leads"."system_lead_state"));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_state_override_complete" CHECK (("leads"."state_override" is null) = ("leads"."state_override_by" is null) and ("leads"."state_override" is null) = ("leads"."state_override_reason" is null) and ("leads"."state_override" is null) = ("leads"."state_override_at" is null));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_system_never_outreach_ready" CHECK ("leads"."system_lead_state" <> 'OUTREACH_READY');--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_system_qualified_requires_gate" CHECK ("leads"."system_lead_state" <> 'COMMERCIAL_OPPORTUNITY' or "leads"."system_gate_status" = 'PASSED');--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_system_gate_basis" CHECK (("leads"."system_gate_status" = 'PASSED') = ("leads"."system_gate_basis" is not null) and "leads"."system_gate_basis" is distinct from 'human_override');--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_closed" CHECK (("leads"."status" = 'closed') = ("leads"."closed_at" is not null) and ("leads"."closed_at" is null or "leads"."closed_reason" is not null));--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_merge_closure" CHECK (("leads"."merged_into_lead_id" is null and "leads"."closed_by_merge_id" is null) or "leads"."closed_reason" = 'merged');--> statement-breakpoint
-- What the system decided, and every state change, are history: never rewritten.
CREATE TRIGGER lead_evaluations_immutable BEFORE UPDATE ON lead_evaluations
  FOR EACH ROW EXECUTE FUNCTION reject_update();--> statement-breakpoint
CREATE TRIGGER lead_state_transitions_immutable BEFORE UPDATE ON lead_state_transitions
  FOR EACH ROW EXECUTE FUNCTION reject_update();--> statement-breakpoint
-- OUTREACH_READY needs a human YES (Phase 13): a human override to it, a review judgement
-- of YES on the lead, and a channel not marked unsuitable. No code path sets the override
-- before Phase 13; this is the backstop.
CREATE FUNCTION leads_outreach_ready_requires_yes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lead_state = 'OUTREACH_READY' AND (
       NEW.state_override IS DISTINCT FROM 'OUTREACH_READY'
    OR NEW.outreach_channel_suitability = 'cold_outreach_disallowed'
    OR NOT EXISTS (SELECT 1 FROM judgements j WHERE j.lead_id = NEW.id AND j.context = 'review' AND j.verdict = 'YES')
  ) THEN
    RAISE EXCEPTION 'lead % cannot be OUTREACH_READY without a human YES review judgement and a usable channel', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER leads_outreach_ready_requires_yes BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_outreach_ready_requires_yes();
