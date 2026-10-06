// The scoring core: deterministic dimensions, evidenced commercial value, confidence as
// coverage × recency × verifiability, and the Phase 0 treatment of score and confidence.
import { describe, expect, it } from "vitest";
import { DIMENSIONS, type ScoringInput, scoreLead, totalNow, treatmentOf } from "@/core/scoring";

const weights = { buying_signal: 0.22, icp_fit: 0.18, digital_opportunity: 0.15, service_fit: 0.15, commercial_potential: 0.12, contactability: 0.1, evidence_quality: 0.08 };
const verifiability = { VERIFIED: 1, INFERRED: 0.6, REPORTED: 0.8, UNKNOWN: 0 };

const svc = (key: string, unit: string, priceLowZar: number | null) => ({ key, active: true, unit, priceLowZar });
const op = (over: Partial<ScoringInput["opportunities"][number]> = {}): ScoringInput["opportunities"][number] => ({
  id: "o1",
  rank: 1,
  typeKey: "website_rebuild",
  relevance: 0.9,
  service: svc("custom_business_website", "project", 5500),
  failFindings: [],
  signalIds: [],
  ...over,
});

const input = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  now: new Date("2026-10-06T00:00:00Z"),
  weights,
  params: { severity_weights: { high: 0.6, medium: 0.35, low: 0.15, info: 0 }, segment_fit_values: { fit: 1, potentially_valid: 0.5, not_fit: 0 } },
  verifiability,
  auditRecency: 1,
  auditId: "a1",
  intentSignals: [],
  intentTypes: { detectable: 1, total: 8 },
  opportunities: [],
  referencePriceZar: 45000,
  capacity: { markers: [], required: 2 },
  segment: null,
  contact: { channels: [], observed: [], decisionMaker: null, suppressed: null },
  ...over,
});

const dim = (r: ReturnType<typeof scoreLead>, d: string) => {
  const x = r.dimensions.find((y) => y.dimension === d);
  if (!x) throw new Error(d);
  return x;
};

describe("score", () => {
  it("has exactly the seven Phase 0 dimensions at the given weights, summing to the total", () => {
    const r = scoreLead(input({ opportunities: [op()] }));
    expect(r.dimensions.map((d) => d.dimension)).toEqual([...DIMENSIONS]);
    expect(r.dimensions.map((d) => d.weight)).toEqual(Object.values(weights));
    expect(r.total).toBeCloseTo(r.dimensions.reduce((a, d) => a + d.contribution, 0), 2);
    for (const d of r.dimensions) expect(d.contribution).toBeCloseTo(100 * d.weight * d.value * d.decay, 2);
  });

  it("is deterministic", () => {
    expect(scoreLead(input({ opportunities: [op()] }))).toEqual(scoreLead(input({ opportunities: [op()] })));
  });

  it("scores buying_signal from Intent signal strength, with decay as its own factor", () => {
    const r = scoreLead(input({ intentSignals: [{ id: "s", typeKey: "sponsorship_inventory", strength: 0.7, strengthNow: 0.35, claimType: "VERIFIED", recency: 1, evidenceIds: ["e"], findingIds: ["f"] }] }));
    expect(dim(r, "buying_signal")).toMatchObject({ value: 0.7, decay: 0.5, coverage: 1, verifiability: 1, contribution: 7.7 });
    expect(dim(r, "buying_signal").inputs).toMatchObject({ signals: ["s"], findings: ["f"], evidence: ["e"] });
  });

  it("lowers coverage, not value, when it looked for Intent and found none", () => {
    expect(dim(scoreLead(input()), "buying_signal")).toMatchObject({ value: 0, coverage: 0.125 });
  });

  it("cannot evaluate ICP fit until an operator assigns a segment fit", () => {
    expect(dim(scoreLead(input()), "icp_fit")).toMatchObject({ value: 0, coverage: 0 });
    expect(dim(scoreLead(input({ segment: { fit: "fit", segmentKey: "sports", recency: 1 } })), "icp_fit")).toMatchObject({ value: 1, coverage: 1, verifiability: 0.8 });
    expect(dim(scoreLead(input({ segment: { fit: "potentially_valid", segmentKey: null, recency: 1 } })), "icp_fit").value).toBe(0.5);
  });

  it("weights digital opportunity by the severity and confidence of failures behind current opportunities", () => {
    const failFindings = [
      { id: "f1", checkKey: "tech.viewport_meta", severity: "medium", confidence: 0.95, evidenceIds: ["e1"] },
      { id: "f2", checkKey: "tech.https", severity: "high", confidence: 1, evidenceIds: ["e2"] },
    ];
    const d = dim(scoreLead(input({ opportunities: [op({ failFindings })] })), "digital_opportunity");
    expect(d.value).toBeCloseTo(1 - (1 - 0.35 * 0.95) * (1 - 0.6), 3);
    expect(d.inputs.findings).toEqual(["f1", "f2"]);
    // A failure behind no opportunity does not count: weakness Covenant cannot sell against is not opportunity.
    expect(dim(scoreLead(input()), "digital_opportunity").value).toBe(0);
  });

  it("scores service fit as the relevance of the best opportunity Covenant sells", () => {
    expect(dim(scoreLead(input({ opportunities: [op({ relevance: 0.7 })] })), "service_fit")).toMatchObject({ value: 0.7, verifiability: 0.6 });
    expect(dim(scoreLead(input({ opportunities: [op({ service: { ...svc("x", "project", 100), active: false } })] })), "service_fit").value).toBe(0);
  });
});

describe("commercial potential: initial + recurring + expansion, each evidenced", () => {
  const cp = (over: Partial<ScoringInput>) => dim(scoreLead(input(over)), "commercial_potential");

  it("takes the initial value from the mapped service's published price", () => {
    const d = cp({ opportunities: [op()] });
    expect(d.inputs.components).toEqual({ initialValueZar: 5500, recurringValueZar: 0, expansionPotentialZar: 0, commercialValueZar: 5500, referencePriceZar: 45000 });
    expect(d.value).toBeCloseTo(5500 / 45000, 3);
  });

  it("is recurring only where the mapped service is a published retainer, one month, never times a duration", () => {
    const d = cp({ opportunities: [op({ typeKey: "sports_matchday_system", service: svc("matchday_sla_retainer", "retainer", 8000) })] });
    expect(d.inputs.components).toMatchObject({ initialValueZar: 0, recurringValueZar: 8000, commercialValueZar: 8000 });
  });

  it("has expansion only on a second mapped opportunity to a different service", () => {
    const second = op({ id: "o2", rank: 2, typeKey: "sports_matchday_system", service: svc("matchday_sla_retainer", "retainer", 8000) });
    const first = op({ typeKey: "sports_platform", service: svc("sports_platform_build", "project", 45000) });
    expect(cp({ opportunities: [first, second] }).inputs.components).toMatchObject({ initialValueZar: 45000, expansionPotentialZar: 8000, commercialValueZar: 53000 });
    expect(cp({ opportunities: [first] }).inputs.components?.expansionPotentialZar).toBe(0);
    const sameService = op({ id: "o2", rank: 2, service: first.service });
    expect(cp({ opportunities: [first, sameService] }).inputs.components?.expansionPotentialZar).toBe(0);
  });

  it("caps at 1 against the highest published price, and is 0 for an unpublished price", () => {
    expect(cp({ opportunities: [op({ service: svc("sports_platform_build", "project", 45000) }), op({ id: "o2", rank: 2, service: svc("matchday_sla_retainer", "retainer", 8000) })] }).value).toBe(1);
    expect(cp({ opportunities: [op({ service: svc("onsite_revenue_leak_audit", "project", null) })] })).toMatchObject({ value: 0, coverage: 0 });
  });

  it("counts capacity evidence in coverage, never in the value", () => {
    const markers = (n: number) => Array.from({ length: n }, (_, i) => ({ checkKey: `capacity.c${i}`, findingId: `f${i}`, evidenceIds: [`e${i}`] }));
    const none = cp({ opportunities: [op()] });
    const two = cp({ opportunities: [op()], capacity: { markers: markers(2), required: 2 } });
    expect(two.value).toBe(none.value);
    expect([none.coverage, cp({ opportunities: [op()], capacity: { markers: markers(1), required: 2 } }).coverage, two.coverage]).toEqual([0.5, 0.75, 1]);
  });
});

describe("contactability and evidence quality", () => {
  it("scores contactability over the criteria it can evaluate", () => {
    const observed = [{ findingId: "f", checkKey: "conv.contact_path", evidenceIds: ["e"] }];
    expect(dim(scoreLead(input({ contact: { channels: [], observed, decisionMaker: null, suppressed: null } })), "contactability")).toMatchObject({ value: 1, coverage: 0.333 });
    const dm = { contactIds: ["c"], present: false, claimType: "REPORTED" as const };
    expect(dim(scoreLead(input({ contact: { channels: [], observed, decisionMaker: dm, suppressed: null } })), "contactability")).toMatchObject({ value: 0.5, coverage: 0.667 });
  });

  it("measures the share of evidenced dimensions resting on VERIFIED evidence", () => {
    const r = scoreLead(input({ opportunities: [op()], contact: { channels: [], observed: [{ findingId: "f", checkKey: "conv.contact_path", evidenceIds: ["e"] }], decisionMaker: null, suppressed: null } }));
    // buying_signal (audit), digital_opportunity, contactability are VERIFIED; service_fit and commercial_potential are INFERRED.
    expect(dim(r, "evidence_quality").value).toBe(0.6);
  });
});

describe("confidence", () => {
  it("is the weight-averaged coverage × recency × verifiability, and nothing else", () => {
    const r = scoreLead(input({ opportunities: [op()] }));
    const expected = r.dimensions.reduce((a, d) => a + d.weight * d.coverage * d.recency * d.verifiability, 0) / 1;
    expect(r.confidence).toBeCloseTo(expected, 3);
  });

  it("falls with stale evidence", () => {
    const fresh = scoreLead(input({ opportunities: [op()] })).confidence;
    const stale = scoreLead(input({ opportunities: [op()], auditRecency: 0.4 })).confidence;
    expect(stale).toBeLessThan(fresh);
  });
});

describe("treatment (Phase 0, how the two combine)", () => {
  const t = { score: 55, confidence: 0.6 };
  it("queues only when both pass, and labels a high score with low confidence as needing verification", () => {
    expect(treatmentOf(70, 0.75, t)).toBe("queue_for_review");
    expect(treatmentOf(88, 0.41, t)).toBe("needs_verification");
    expect(treatmentOf(40, 0.8, t)).toBe("reject");
    expect(treatmentOf(40, 0.3, t)).toBe("park");
    expect(treatmentOf(55, 0.6, t)).toBe("queue_for_review");
  });
});

describe("decay at read", () => {
  it("recomputes only buying_signal's decay", () => {
    const r = scoreLead(input({ intentSignals: [{ id: "s", typeKey: "x", strength: 0.7, strengthNow: 0.7, claimType: "VERIFIED", recency: 1, evidenceIds: ["e"], findingIds: [] }], opportunities: [op()] }));
    expect(totalNow(r.dimensions, 1)).toBeCloseTo(r.total, 2);
    expect(totalNow(r.dimensions, 0)).toBeCloseTo(r.total - dim(r, "buying_signal").contribution, 2);
  });
});
