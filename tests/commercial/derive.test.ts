// Opportunity derivation is consolidation: one opportunity unless the evidence supports more.
import { describe, expect, it } from "vitest";
import { type DerivationConfig, type SupportSignal, deriveOpportunities } from "@/commercial/derive";
import { opportunityTypeServices, services, signalTypeOpportunityTypes } from "@/db/seed-data";

// The seeded configuration, as the database holds it after npm run db:setup.
const config = (over: Partial<DerivationConfig["params"]> = {}): DerivationConfig => ({
  mappings: Object.fromEntries(Object.entries(signalTypeOpportunityTypes).map(([k, types]) => [k, types.map((typeKey, i) => ({ typeKey, preference: i + 1 }))])),
  services: Object.fromEntries(
    Object.entries(opportunityTypeServices).map(([k, keys]) => [k, keys.map((serviceKey) => ({ serviceKey, serviceName: services.find((x) => x.key === serviceKey)?.name ?? serviceKey }))]),
  ),
  params: { secondary_mapping_weight: 0.7, min_relevance: 0.3, max_opportunities: 3, ...over },
  inferredVerifiability: 0.6,
});

let n = 0;
const sig = (typeKey: string, strengthNow: number, evidenceIds: string[], over: Partial<SupportSignal> = {}): SupportSignal => ({
  id: `s${++n}-${typeKey}`,
  typeKey,
  detectedBy: "rule",
  strengthNow,
  evidenceIds,
  findingIds: evidenceIds.map((e) => `f-${e}`),
  basisConfidence: 0.85,
  ...over,
});

describe("opportunity derivation", () => {
  it("consolidates a weak supplier's four signals into one website rebuild", () => {
    // As detected from tests/audit/fixtures/weak/supplier.html: the aggregate weakness signal
    // already cites the click-to-call and viewport failures.
    const signals = [
      sig("web_underperformance", 0.75, ["viewport", "click", "catalogue"]),
      sig("catalogue_friction", 0.9, ["catalogue"]),
      sig("mobile_commercial_friction", 0.7, ["viewport"]),
      sig("lead_response_friction", 0.5, ["click"]),
    ];
    const d = deriveOpportunities(signals, config());
    expect(d.opportunities).toHaveLength(1);
    const [o] = d.opportunities;
    expect(o).toMatchObject({ rank: 1, typeKey: "website_rebuild", serviceKey: "custom_business_website" });
    expect(o?.signals.map((x) => x.typeKey).sort()).toEqual(["catalogue_friction", "mobile_commercial_friction", "web_underperformance"]);
    // The lead-response signal rests on evidence the rebuild already rests on: explained, not a second opportunity.
    expect(o?.alsoCovers).toEqual(["lead_response_friction"]);
    expect(o?.alsoConsistentWith).toEqual(["rfq_system", "technical_website_improvement"]);
    expect(o?.rationale).toContain("Custom Business Website");
  });

  it("produces one opportunity from one signal", () => {
    const d = deriveOpportunities([sig("no_qualification_path", 0.6, ["form"])], config());
    expect(d.opportunities.map((o) => [o.typeKey, o.serviceKey, o.relevance])).toEqual([["conversion_landing_page", "campaign_conversion_page", 0.6]]);
  });

  it("does not produce a second opportunity for a signal whose type the first already serves", () => {
    // Both map to website_rebuild and technical_website_improvement, in opposite preference.
    const d = deriveOpportunities([sig("web_underperformance", 0.45, ["a"]), sig("slow_mobile_experience", 0.5, ["b"])], config());
    expect(d.opportunities).toHaveLength(1);
    expect(d.opportunities[0]?.signals).toHaveLength(2);
  });

  it("produces a second, ranked opportunity only from independent evidence pointing elsewhere", () => {
    const d = deriveOpportunities(
      [sig("web_underperformance", 0.6, ["a"]), sig("matchday_scramble", 0.8, ["op1"], { detectedBy: "operator", findingIds: [], basisConfidence: 0.8 })],
      config(),
    );
    expect(d.opportunities.map((o) => [o.rank, o.typeKey, o.serviceKey])).toEqual([
      [1, "sports_matchday_system", "matchday_sla_retainer"],
      [2, "website_rebuild", "custom_business_website"],
    ]);
    // Each signal rests on exactly one opportunity.
    const used = d.opportunities.flatMap((o) => o.signals.map((x) => x.id));
    expect(new Set(used).size).toBe(used.length);
  });

  it("stops at max_opportunities and below min_relevance", () => {
    const signals = [sig("matchday_scramble", 0.8, ["m"]), sig("web_underperformance", 0.6, ["w"]), sig("manual_order_handling", 0.5, ["o"]), sig("brand_upgrade_need", 0.4, ["b"])];
    expect(deriveOpportunities(signals, config({ max_opportunities: 2 })).opportunities).toHaveLength(2);
    const d = deriveOpportunities(signals, config({ min_relevance: 0.55 }));
    expect(d.opportunities.map((o) => o.typeKey)).toEqual(["sports_matchday_system", "website_rebuild"]);
    expect(d.belowThreshold.map((b) => b.typeKey)).toEqual(["payment_checkout", "brand_identity", "branding"]);
  });

  it("weights a signal less toward its second-preference type", () => {
    // catalogue_friction → rfq_system (1st), website_rebuild (2nd).
    const [o] = deriveOpportunities([sig("catalogue_friction", 0.8, ["c"])], config()).opportunities;
    expect(o).toMatchObject({ typeKey: "rfq_system", relevance: 0.8 });
    const d = deriveOpportunities([sig("catalogue_friction", 0.8, ["c"])], config({ secondary_mapping_weight: 1 }));
    // A tie on relevance and support is broken by key, deterministically.
    expect(d.opportunities[0]?.typeKey).toBe("rfq_system");
  });

  it("produces nothing from unmapped, decayed or unevidenced signals", () => {
    const d = deriveOpportunities(
      [sig("agency_fatigue", 0.9, ["x"], { detectedBy: "operator" }), sig("web_underperformance", 0, ["y"]), sig("lead_response_friction", 0.5, [])],
      config(),
    );
    expect(d.opportunities).toEqual([]);
    expect(d.unmapped).toEqual(["agency_fatigue"]);
  });

  it("states its confidence as the INFERRED factor times the strength-weighted basis confidence", () => {
    const [o] = deriveOpportunities(
      [sig("web_underperformance", 0.6, ["a"], { basisConfidence: 0.9 }), sig("mobile_commercial_friction", 0.3, ["b"], { basisConfidence: 0.6 })],
      config(),
    ).opportunities;
    // (0.6 × 0.9 + 0.3 × 0.6) / 0.9 = 0.8; × 0.6 = 0.48
    expect(o?.confidence).toBe(0.48);
    expect(o?.relevance).toBe(0.72); // 1 − 0.4 × 0.7
  });

  it("is deterministic: the same input gives the same output in any order", () => {
    const signals = [sig("web_underperformance", 0.6, ["a"]), sig("matchday_scramble", 0.6, ["b"]), sig("manual_order_handling", 0.6, ["c"])];
    const a = deriveOpportunities(signals, config());
    const b = deriveOpportunities([...signals].reverse(), config());
    expect(b.opportunities.map((o) => o.typeKey)).toEqual(a.opportunities.map((o) => o.typeKey));
  });

  it("names every rule parameter in its inference rule", () => {
    const d = deriveOpportunities([], config());
    expect(d.inferenceRule).toMatch(/^opportunity-derivation\/1: /);
    for (const s of ["0.7^(preference − 1)", "min relevance 0.3", "at most 3", "INFERRED 0.6"]) expect(d.inferenceRule).toContain(s);
  });
});
