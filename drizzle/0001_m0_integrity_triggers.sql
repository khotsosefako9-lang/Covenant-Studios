-- Integrity rules that span rows or tables and cannot be expressed as CHECK constraints.

-- 1. Evidence is immutable. Only supersession (and last_verified_at / updated_at) may change.
CREATE FUNCTION evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'superseded_by_id' - 'last_verified_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by_id' - 'last_verified_at' - 'updated_at') THEN
    RAISE EXCEPTION 'evidence % is immutable; insert a new row and supersede this one', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id THEN
    RAISE EXCEPTION 'evidence % is already superseded', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_immutable BEFORE UPDATE ON evidence
  FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
--> statement-breakpoint

-- 2. Score runs, their decomposition and human judgements are snapshots: append-only.
CREATE FUNCTION reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable snapshots; insert a new row instead', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER scores_immutable BEFORE UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION reject_update();
--> statement-breakpoint
CREATE TRIGGER score_dimensions_immutable BEFORE UPDATE ON score_dimensions
  FOR EACH ROW EXECUTE FUNCTION reject_update();
--> statement-breakpoint
CREATE TRIGGER judgements_immutable BEFORE UPDATE ON judgements
  FOR EACH ROW EXECUTE FUNCTION reject_update();
--> statement-breakpoint

-- 3. A weight set's weights are frozen once any score was produced with it.
--    Changing weights means a new version, so history is never rewritten.
CREATE FUNCTION weight_sets_frozen_when_used() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'is_active' - 'notes' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'is_active' - 'notes' - 'updated_at')
     AND EXISTS (SELECT 1 FROM scores WHERE weight_set_id = OLD.id) THEN
    RAISE EXCEPTION 'weight set % is referenced by scores; create a new version', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER weight_sets_frozen_when_used BEFORE UPDATE ON weight_sets
  FOR EACH ROW EXECUTE FUNCTION weight_sets_frozen_when_used();
--> statement-breakpoint

-- 4. Human-only signal types (procurement_scorecard) can never be raised by a rule.
CREATE FUNCTION signals_human_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.detected_by <> 'operator'
     AND EXISTS (SELECT 1 FROM signal_types WHERE id = NEW.signal_type_id AND human_only) THEN
    RAISE EXCEPTION 'signal type % may only be raised by a human operator', NEW.signal_type_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER signals_human_only BEFORE INSERT OR UPDATE ON signals
  FOR EACH ROW EXECUTE FUNCTION signals_human_only();
--> statement-breakpoint

-- 5. An opportunity's service must be one its type is configured to map to.
--    No opportunity can be justified with a service Covenant does not map it to.
CREATE FUNCTION opportunities_service_mapped() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.covenant_service_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM opportunity_type_services
    WHERE opportunity_type_id = NEW.opportunity_type_id AND covenant_service_id = NEW.covenant_service_id
  ) THEN
    RAISE EXCEPTION 'service % is not mapped to opportunity type %', NEW.covenant_service_id, NEW.opportunity_type_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER opportunities_service_mapped BEFORE INSERT OR UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION opportunities_service_mapped();
