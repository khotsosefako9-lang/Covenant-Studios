// web_underperformance: Opportunity always; Intent only with an independent commercial
// signal; never the same evidence on both axes.
import { describe, expect, it } from "vitest";
import { type ActiveSignal, axisContributions } from "@/signals/axes";

const wu = (evidenceIds = ["w1", "w2"], strengthNow = 0.6): ActiveSignal => ({
  id: "wu",
  typeKey: "web_underperformance",
  axis: "opportunity",
  strengthNow,
  evidenceIds,
  intentRequiresIndependentSignal: true,
});
const intentSig = (id: string, evidenceIds: string[], strengthNow = 0.7, typeKey = "agency_fatigue"): ActiveSignal => ({
  id,
  typeKey,
  axis: "intent",
  strengthNow,
  evidenceIds,
  intentRequiresIndependentSignal: false,
});
const opp = (id: string, evidenceIds: string[]): ActiveSignal => ({ id, typeKey: "lead_response_friction", axis: "opportunity", strengthNow: 0.5, evidenceIds, intentRequiresIndependentSignal: false });

const evidenceOn = (cs: { evidenceIds: string[] }[]) => new Set(cs.flatMap((c) => c.evidenceIds));

describe("web_underperformance axis rules", () => {
  it("counts on Opportunity only when it stands alone", () => {
    const a = axisContributions([wu()]);
    expect(a.opportunity.map((c) => c.typeKey)).toEqual(["web_underperformance"]);
    expect(a.intent).toEqual([]);
  });

  it("is not made intent by other weakness signals", () => {
    const a = axisContributions([wu(), opp("o1", ["x1"])]);
    expect(a.intent).toEqual([]);
  });

  it("counts on Intent when an independent commercial signal is present, resting only on that signal's evidence", () => {
    const a = axisContributions([wu(), intentSig("i1", ["op1"])]);
    const credit = a.intent.find((c) => c.signalId === "wu");
    expect(credit).toMatchObject({ strength: 0.6, evidenceIds: ["op1"], corroboratedBy: "i1" });
    // The weakness evidence is on Opportunity and nowhere on Intent.
    const intentEvidence = evidenceOn(a.intent);
    for (const id of ["w1", "w2"]) expect(intentEvidence.has(id)).toBe(false);
  });

  it("takes the weaker of the two strengths", () => {
    const a = axisContributions([wu(undefined, 0.8), intentSig("i1", ["op1"], 0.3)]);
    expect(a.intent.find((c) => c.signalId === "wu")?.strength).toBe(0.3);
  });

  it("gets no Intent credit from an intent signal that shares its evidence", () => {
    const a = axisContributions([wu(["w1", "shared"]), intentSig("i1", ["shared"])]);
    expect(a.intent.find((c) => c.signalId === "wu")).toBeUndefined();
  });

  it("gets no Intent credit once the independent signal has decayed to zero", () => {
    const a = axisContributions([wu(), intentSig("i1", ["op1"], 0)]);
    expect(a.intent).toEqual([]);
  });

  it("never puts web_underperformance evidence on the Intent axis, across many combinations", () => {
    const pool = ["w1", "w2", "w3", "op1", "op2"];
    let checked = 0;
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const wuEv = pool.filter((_, i) => mask & (1 << i));
      if (!wuEv.length) continue;
      for (let other = 1; other < 1 << pool.length; other++) {
        const iEv = pool.filter((_, i) => other & (1 << i));
        const a = axisContributions([wu(wuEv), intentSig("i1", iEv)]);
        const wuIntent = a.intent.filter((c) => c.signalId === "wu");
        for (const c of wuIntent) for (const id of c.evidenceIds) expect(wuEv).not.toContain(id);
        checked++;
      }
    }
    expect(checked).toBe(961);
  });
});
