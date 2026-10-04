// Capacity: the evidence of operating scale that feeds the commercial_potential dimension.
// It comes from the audit's capacity checks (PRESENT findings only) and nowhere else. It is
// deliberately not a signal: a business with three branches and an open vacancy is
// demonstrably operating at scale, not demonstrably in the market for a website, so none
// of this reaches the Intent axis or opportunity derivation.
import { ALL_CHECKS } from "@/audit/registry";
import type { FindingFact } from "@/signals/detectors";

export const CAPACITY_CHECK_KEYS: readonly string[] = ALL_CHECKS.filter((c) => c.category === "capacity").map((c) => c.key);

export interface CapacityMarker {
  checkKey: string;
  findingId: string;
  confidence: number;
  evidenceIds: string[];
}

export interface CapacityProfile {
  /** Markers observed on the page, each resting on its finding's evidence. */
  present: CapacityMarker[];
  /** Read and not found. */
  absent: string[];
  /** The page did not settle it (INDETERMINATE, NOT_APPLICABLE, ERROR) or the check did not run. */
  unknown: string[];
}

/** The capacity profile of one completed audit's findings. Pure. */
export function capacityProfile(findings: readonly FindingFact[]): CapacityProfile {
  const byKey = new Map(findings.filter((f) => CAPACITY_CHECK_KEYS.includes(f.checkKey)).map((f) => [f.checkKey, f]));
  const profile: CapacityProfile = { present: [], absent: [], unknown: [] };
  for (const key of CAPACITY_CHECK_KEYS) {
    const f = byKey.get(key);
    if (f?.status === "PRESENT" && f.evidenceIds.length) profile.present.push({ checkKey: key, findingId: f.id, confidence: f.confidence, evidenceIds: f.evidenceIds });
    else if (f?.status === "ABSENT") profile.absent.push(key);
    else profile.unknown.push(key);
  }
  return profile;
}
