// A signal counts on its own type's axis only. web_underperformance is Opportunity only,
// always: nothing (another signal, shared or independent evidence) moves it onto Intent.
import { describe, expect, it } from "vitest";
import { type ActiveSignal, axisContributions } from "@/signals/axes";

const sig = (id: string, typeKey: string, axis: ActiveSignal["axis"], evidenceIds: string[], strengthNow = 0.6): ActiveSignal => ({
  id,
  typeKey,
  axis,
  strengthNow,
  evidenceIds,
});

describe("axis attribution", () => {
  it("puts each signal on its type's axis", () => {
    const a = axisContributions([sig("wu", "web_underperformance", "opportunity", ["w1"]), sig("i1", "agency_fatigue", "intent", ["op1"])]);
    expect(a.opportunity.map((c) => c.signalId)).toEqual(["wu"]);
    expect(a.intent.map((c) => c.signalId)).toEqual(["i1"]);
  });

  it("never puts web_underperformance on Intent, whatever else is present", () => {
    const others = [
      sig("i1", "agency_fatigue", "intent", ["op1"], 0.9),
      sig("i2", "procurement_scorecard", "intent", ["w1"], 0.9),
      sig("o1", "lead_response_friction", "opportunity", ["x1"]),
    ];
    for (let mask = 0; mask < 1 << others.length; mask++) {
      const present = others.filter((_, i) => mask & (1 << i));
      const a = axisContributions([sig("wu", "web_underperformance", "opportunity", ["w1", "w2"]), ...present]);
      expect(a.intent.map((c) => c.typeKey)).not.toContain("web_underperformance");
      expect(a.opportunity.filter((c) => c.typeKey === "web_underperformance")).toHaveLength(1);
    }
  });

  it("drops signals that have decayed to zero or rest on no evidence", () => {
    const a = axisContributions([sig("a", "slow_mobile_experience", "opportunity", ["e"], 0), sig("b", "catalogue_friction", "opportunity", [])]);
    expect(a.opportunity).toEqual([]);
  });
});
