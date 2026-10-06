// Zod schemas for the few JSONB columns, so their shape is validated before writing.
import { z } from "zod";

export const icpCriteriaSchema = z
  .object({
    industries: z.array(z.string().min(1)).optional(),
    areas: z.array(z.string().min(1)).optional(),
    sizeBands: z.array(z.string().min(1)).optional(),
    exclusions: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type IcpCriteria = z.infer<typeof icpCriteriaSchema>;

const nonNegative = z.number().nonnegative();
const unit = z.number().min(0).max(1);

// Every settings key and the shape of its value. A null value means NOT_CONFIGURED:
// the feature that depends on it stays hidden rather than using a guessed default.
export const settingSchemas = {
  delivery_slots_total: z.number().int().nonnegative().nullable(),
  qualify_score_threshold: z.number().min(0).max(100).nullable(),
  qualify_confidence_threshold: unit.nullable(),
  commercial_potential_floor_zar: nonNegative.nullable(),
  conversation_worthiness_bar: unit.nullable(),
  ai_monthly_cap_zar: nonNegative.nullable(),
  ai_per_lead_cap_usd: nonNegative.nullable(),
  usd_zar_planning_rate: z.number().positive(),
  dedupe_name_similarity_threshold: unit,
  freshness_refresh_days: z
    .object({ website_audit: z.number().int().positive(), contact_channel: z.number().int().positive(), company_profile: z.number().int().positive() })
    .strict(),
  confidence_verifiability: z.object({ VERIFIED: unit, INFERRED: unit, REPORTED: unit, UNKNOWN: unit }).strict(),
  confidence_recency_floor: unit,
  delivery_cycle_weeks: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .strict()
    .refine((v) => v.max >= v.min, "max must be at least min"),
  quote_policy: z.enum(["fixed_locked_at_signoff"]),
  deposit_percent: z.number().min(0).max(100),
  post_launch_warranty_days: z.number().int().nonnegative(),
  // Fetch layer. Politeness floors are part of the schema: a value below them is rejected,
  // so an operator can make the crawler slower or stricter but never faster or pushier.
  fetch_paused: z.boolean(),
  fetch_min_delay_ms: z.number().int().min(2000),
  fetch_max_retries: z.number().int().min(0).max(3),
  fetch_connect_timeout_ms: z.number().int().min(1000).max(60_000),
  fetch_read_timeout_ms: z.number().int().min(1000).max(120_000),
  fetch_max_body_bytes: z.number().int().min(10_000).max(20_000_000),
  fetch_max_redirects: z.number().int().min(0).max(10),
  fetch_host_budget_per_run: z.number().int().min(1).max(200),
  fetch_cache_ttl_hours: z.number().min(0),
  robots_cache_ttl_hours: z.number().min(0).max(24),
  // Scoring (Phase 11).
  scoring: z
    .object({
      severity_weights: z.object({ high: unit, medium: unit, low: unit, info: unit }).strict(),
      segment_fit_values: z.object({ fit: unit, potentially_valid: unit, not_fit: unit }).strict(),
    })
    .strict(),
  // Intent gate (Phase 10).
  intent_gate: z
    .object({
      min_intent_strength: unit,
      min_capacity_markers: z.number().int().min(1).max(10),
      min_capacity_confidence: unit,
      min_disqualifier_confidence: z.number().min(0.5).max(1),
    })
    .strict(),
  // Opportunity derivation (Phase 9).
  opportunity_derivation: z
    .object({
      secondary_mapping_weight: z.number().min(0).max(1),
      min_relevance: unit,
      max_opportunities: z.number().int().min(1).max(10),
    })
    .strict(),
} as const;

export type SettingKey = keyof typeof settingSchemas;

export function parseSetting<K extends SettingKey>(key: K, value: unknown): z.infer<(typeof settingSchemas)[K]> {
  return settingSchemas[key].parse(value) as z.infer<(typeof settingSchemas)[K]>;
}
