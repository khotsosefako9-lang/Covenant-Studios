// The intent gate and state machine, pure. Weakness alone never qualifies; the two routes
// are a live Intent signal, or an entry price above the floor that capacity evidences.
import { describe, expect, it } from "vitest";
import type { CapacityProfile } from "@/commercial/capacity";
import { type GateInput, evaluateGate } from "@/leads/gate";

const capacity = (n: number, confidence = 0.85): CapacityProfile => ({
  present: Array.from({ length: n }, (_, i) => ({ checkKey: `capacity.c${i}`, findingId: `f${i}`, confidence, evidenceIds: [`e${i}`] })),
  absent: [],
  unknown: [],
});

const rebuild = { id: "o1", rank: 1, typeKey: "website_rebuild", serviceKey: "custom_business_website", serviceUnit: "project", priceLowZar: 5500 };
const landing = { id: "o2", rank: 1, typeKey: "conversion_landing_page", serviceKey: "campaign_conversion_page", serviceUnit: "project", priceLowZar: 3500 };
const retainer = { id: "o3", rank: 1, typeKey: "sports_matchday_system", serviceKey: "matchday_sla_retainer", serviceUnit: "retainer", priceLowZar: 8000 };
const unpriced = { id: "o4", rank: 1, typeKey: "commercial_growth", serviceKey: "onsite_revenue_leak_audit", serviceUnit: "project", priceLowZar: null };
const intent = (strengthNow = 0.7) => ({ id: "s1", typeKey: "sponsorship_inventory", detectedBy: "rule", strengthNow, evidenceIds: ["e"] });

const input = (over: Partial<GateInput> = {}): GateInput => ({
  latestAudit: { id: "a1", status: "COMPLETED" },
  completedAuditId: "a1",
  intentSignals: [],
  weaknessSignals: [{ id: "w", typeKey: "web_underperformance" }],
  opportunities: [rebuild],
  capacity: capacity(0),
  disqualifications: [],
  floorZar: 3500,
  params: { min_intent_strength: 0, min_capacity_markers: 2, min_capacity_confidence: 0.7 },
  // A qualifying score unless a test says otherwise; the thresholds are tested on their own below.
  score: { total: 70, confidence: 0.75, treatment: "queue_for_review", thresholds: { score: 55, confidence: 0.6 } },
  ...over,
});

describe("the intent gate", () => {
  it("holds weakness alone at WATCH_WEAKNESS_ONLY, however weak the site", () => {
    const o = evaluateGate(input());
    expect(o).toMatchObject({ systemState: "WATCH_WEAKNESS_ONLY", gateStatus: "FAILED", gateBasis: null, commercialPotentialZar: null });
    expect(o.reasons).toContain("No Intent signal");
  });

  it("passes on a live Intent signal (route 1) and qualifies when an opportunity exists", () => {
    expect(evaluateGate(input({ intentSignals: [intent()] }))).toMatchObject({ systemState: "COMMERCIAL_OPPORTUNITY", gateStatus: "PASSED", gateBasis: "buying_signal" });
  });

  it("does not pass on an Intent signal that has decayed out of its window", () => {
    const o = evaluateGate(input({ intentSignals: [intent(0)] }));
    expect(o.gateStatus).toBe("FAILED");
    expect(o.reasons).toContain("No live Intent signal: every Intent signal has decayed out of its window");
  });

  it("passes on commercial potential (route 2) only when capacity evidences the entry price", () => {
    expect(evaluateGate(input({ capacity: capacity(1) })).gateStatus).toBe("FAILED");
    expect(evaluateGate(input({ capacity: capacity(2, 0.6) })).gateStatus).toBe("FAILED"); // markers below confidence
    const o = evaluateGate(input({ capacity: capacity(2) }));
    expect(o).toMatchObject({ systemState: "COMMERCIAL_OPPORTUNITY", gateStatus: "PASSED", gateBasis: "commercial_potential_floor", commercialPotentialZar: 5500 });
    expect(o.detail.entryOpportunity).toMatchObject({ typeKey: "website_rebuild", priceLowZar: 5500 });
  });

  it("counts the floor inclusively, and only entry-priced services (projects and bundles)", () => {
    expect(evaluateGate(input({ opportunities: [landing], capacity: capacity(2) })).gateStatus).toBe("PASSED"); // R3,500 = floor
    expect(evaluateGate(input({ opportunities: [landing], capacity: capacity(2), floorZar: 5000 })).gateStatus).toBe("FAILED");
    expect(evaluateGate(input({ opportunities: [retainer], capacity: capacity(3) })).gateStatus).toBe("FAILED"); // a retainer is not an entry price
    expect(evaluateGate(input({ opportunities: [unpriced], capacity: capacity(3) })).gateStatus).toBe("FAILED"); // unpublished price
  });

  it("takes the best entry price across current opportunities", () => {
    const o = evaluateGate(input({ opportunities: [landing, { ...rebuild, rank: 2 }], capacity: capacity(2) }));
    expect(o.commercialPotentialZar).toBe(5500);
  });

  it("does not evaluate route 2 without a configured floor", () => {
    const o = evaluateGate(input({ capacity: capacity(5), floorZar: null }));
    expect(o.gateStatus).toBe("FAILED");
    expect(o.reasons).toContain("Commercial potential not evaluated: commercial_potential_floor_zar is NOT_CONFIGURED");
  });

  it("records a passed gate with no opportunity at WATCH, saying why", () => {
    const o = evaluateGate(input({ intentSignals: [intent()], opportunities: [] }));
    expect(o).toMatchObject({ systemState: "WATCH_WEAKNESS_ONLY", gateStatus: "PASSED" });
    expect(o.reasons).toContain("The gate passed but no opportunity was derived: nothing to pursue yet");
  });

  it("puts any active disqualification first, whatever the gate says", () => {
    const o = evaluateGate(input({ intentSignals: [intent()], disqualifications: [{ id: "d", disqualifierKey: "bureaucratic_procurement", recordedBy: "rule:x" }] }));
    expect(o).toMatchObject({ systemState: "DISQUALIFIED", gateStatus: "PASSED" });
    expect(o.reasons[0]).toBe("Disqualified: bureaucratic_procurement");
  });

  it("stays PENDING_EVALUATION with nothing to evaluate", () => {
    const o = evaluateGate(input({ latestAudit: { id: "a", status: "SOURCE_BLOCKED" }, completedAuditId: null, opportunities: [], weaknessSignals: [], capacity: null }));
    expect(o).toMatchObject({ systemState: "PENDING_EVALUATION", gateStatus: "NOT_EVALUATED" });
    expect(o.reasons[0]).toContain("SOURCE_BLOCKED");
  });

  it("evaluates on operator evidence even without a completed audit", () => {
    const o = evaluateGate(input({ completedAuditId: null, latestAudit: null, intentSignals: [{ ...intent(), detectedBy: "operator", typeKey: "agency_fatigue" }], capacity: null }));
    expect(o).toMatchObject({ systemState: "COMMERCIAL_OPPORTUNITY", gateBasis: "buying_signal" });
  });

  it("never produces OUTREACH_READY, across every combination of inputs", () => {
    const states = new Set<string>();
    for (const i of [[], [intent()]]) for (const o of [[], [rebuild]]) for (const c of [0, 2]) for (const d of [[], [{ id: "d", disqualifierKey: "x", recordedBy: "r" }]]) {
      states.add(evaluateGate(input({ intentSignals: i, opportunities: o, capacity: capacity(c), disqualifications: d })).systemState);
    }
    expect([...states].sort()).toEqual(["COMMERCIAL_OPPORTUNITY", "DISQUALIFIED", "WATCH_WEAKNESS_ONLY"]);
  });

  it("names its parameters in the rule it records", () => {
    expect(evaluateGate(input()).rule).toMatch(/^intent-gate\/2: .*decayed strength > 0.*≥ R3500.*≥ 2 capacity markers PRESENT at confidence ≥ 0.7.*thresholds/);
  });

  describe("the qualification thresholds (Phase 11)", () => {
    const passing = { intentSignals: [intent()] };
    it("holds a lead that passes the gate but not the thresholds at WATCH, saying which and why", () => {
      const low = evaluateGate(input({ ...passing, score: { total: 52.7, confidence: 0.61, treatment: "reject", thresholds: { score: 55, confidence: 0.6 } } }));
      expect(low).toMatchObject({ systemState: "WATCH_WEAKNESS_ONLY", gateStatus: "PASSED", treatment: "reject" });
      expect(low.reasons).toContain("The gate passed but the score does not qualify the lead");
      expect(low.reasons.at(-1)).toMatch(/^Does not qualify: score 52.7, confidence 0.61/);
    });

    it("labels a high score with low confidence as needing verification, never as a contact", () => {
      const o = evaluateGate(input({ ...passing, score: { total: 88, confidence: 0.41, treatment: "needs_verification", thresholds: { score: 55, confidence: 0.6 } } }));
      expect(o).toMatchObject({ systemState: "WATCH_WEAKNESS_ONLY", treatment: "needs_verification" });
      expect(o.reasons.at(-1)).toMatch(/^Needs verification: score 88.0, confidence 0.41/);
    });

    it("does not qualify on a high score without the gate", () => {
      expect(evaluateGate(input({ score: { total: 95, confidence: 0.9, treatment: "queue_for_review", thresholds: { score: 55, confidence: 0.6 } } })).systemState).toBe("WATCH_WEAKNESS_ONLY");
    });

    it("does not qualify an unscored lead", () => {
      expect(evaluateGate(input({ ...passing, score: null })).systemState).toBe("WATCH_WEAKNESS_ONLY");
    });
  });
});
