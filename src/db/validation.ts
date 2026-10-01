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
  ai_monthly_cap_usd: nonNegative.nullable(),
  ai_per_lead_cap_usd: nonNegative.nullable(),
  freshness_refresh_days: z
    .object({ website_audit: z.number().int().positive(), contact_channel: z.number().int().positive(), company_profile: z.number().int().positive() })
    .strict(),
  confidence_verifiability: z.object({ VERIFIED: unit, INFERRED: unit, REPORTED: unit, UNKNOWN: unit }).strict(),
  confidence_recency_floor: unit,
} as const;

export type SettingKey = keyof typeof settingSchemas;

export function parseSetting<K extends SettingKey>(key: K, value: unknown): z.infer<(typeof settingSchemas)[K]> {
  return settingSchemas[key].parse(value) as z.infer<(typeof settingSchemas)[K]>;
}
