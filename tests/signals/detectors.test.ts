// Detector behaviour on fixtures, including the control set: well-built sites with no
// commercial trigger must produce no Intent signals - and in practice no signals at all.
import { describe, expect, it } from "vitest";
import { evaluate } from "@/audit/registry";
import { signalTypes as seededTypes } from "@/db/seed-data";
import { ParamsError } from "@/core/params";
import { type AuditSnapshot, DETECTORS, MIN_FINDING_CONFIDENCE, NOT_AUTOMATED, detectAll, resolveDetectorParams } from "@/signals/detectors";
import { ctxFor, fixture, probe } from "../audit/helpers";

const INTENT_TYPES = new Set(seededTypes.filter((t) => t.axis === "intent").map((t) => t.key));
const HUMAN_ONLY = ["procurement_scorecard", "agency_fatigue"];

/** Turns pure audit results into the snapshot detection reads from the database. */
function snapshotFor(ctx: ReturnType<typeof ctxFor>): AuditSnapshot {
  const declaredLength: Record<string, number | null> = {};
  const findings = evaluate(ctx).map((r) => {
    const evidenceIds = ("evidence" in r.result ? r.result.evidence : []).map((e, i) => {
      const id = `${r.check.key}#${i}`;
      if (r.check.key === "content.heavy_catalogue") declaredLength[id] = ctx.pdfs[i]?.declaredLength ?? null;
      return id;
    });
    return { id: r.check.key, checkKey: r.check.key, status: r.result.status, severity: r.severity, confidence: r.result.confidence, evidenceIds };
  });
  return { auditId: "a", companyId: "c", findings, declaredLength };
}

const CONTROLS = [
  ["plumber.html", "https://bayplumbing.co.za/"],
  ["industrial.html", "https://ecsafety.co.za/"],
  ["rugby.html", "https://ecrugby.co.za/"],
  ["lawfirm.html", "https://mbekipartners.co.za/"],
  ["nextjs-ssr.html", "https://karooleather.co.za/"],
  ["wordpress.html", "https://reelcoast.co.za/"],
] as const;

// Phase 10: the rugby union offers sponsorship packages for sale. That is the sports ICP's
// defining criterion (commercial inventory to sell), detected as sponsorship_inventory, an
// Intent-axis type. Every other control still produces no signal at all.
const EXPECTED_SIGNALS: Record<string, string[]> = { "rugby.html": ["sponsorship_inventory"] };

describe("control set (standing regression)", () => {
  it.each(CONTROLS)("%s produces exactly its pinned signals, and no weakness signal", (file, url) => {
    const signals = detectAll(snapshotFor(ctxFor(fixture(`controls/${file}`), { url })));
    expect(signals.map((c) => c.typeKey)).toEqual(EXPECTED_SIGNALS[file] ?? []);
    expect(signals.filter((c) => !INTENT_TYPES.has(c.typeKey))).toEqual([]);
  });

  it("rests the rugby union's sponsorship_inventory on the sponsorship offer, at the default strength", () => {
    const [c] = detectAll(snapshotFor(ctxFor(fixture("controls/rugby.html"), { url: "https://ecrugby.co.za/" })));
    expect(c).toMatchObject({ typeKey: "sponsorship_inventory", strength: 0.7, findingIds: ["commercial.sponsorship_offer"] });
  });
});

describe("a weak supplier site", () => {
  const url = "https://baysidevalves.co.za/";
  const ctx = ctxFor(fixture("weak/supplier.html"), {
    url,
    pdfs: [probe(`${url}files/bayside-full-catalogue-2019.pdf`, { outcome: "UNSUPPORTED_CONTENT_TYPE", contentType: "application/pdf", declaredLength: 48_000_000 })],
  });
  const signals = detectAll(snapshotFor(ctx));
  const byType = Object.fromEntries(signals.map((c) => [c.typeKey, c]));

  it("produces only Opportunity signals, each resting on named findings and evidence", () => {
    expect(Object.keys(byType).sort()).toEqual(["catalogue_friction", "lead_response_friction", "mobile_commercial_friction", "web_underperformance"]);
    expect(signals.filter((c) => INTENT_TYPES.has(c.typeKey))).toEqual([]);
    for (const c of signals) {
      expect(c.evidenceIds.length, c.typeKey).toBeGreaterThan(0);
      expect(c.findingIds.length, c.typeKey).toBeGreaterThan(0);
      expect(c.strength).toBeGreaterThan(0);
      expect(c.strength).toBeLessThanOrEqual(0.9);
    }
  });

  it("grades strength from the evidence", () => {
    expect(byType.catalogue_friction?.strength).toBe(0.8); // 45.8 MB: above 25 MB
    expect(byType.mobile_commercial_friction?.strength).toBe(0.7);
    expect(byType.lead_response_friction?.findingIds.sort()).toEqual(["conv.click_to_call", "conv.form_required_fields", "conv.primary_cta_first_screen"]);
    expect(byType.lead_response_friction?.strength).toBe(0.85); // 1 - 0.5 * 0.5 * 0.6
  });
});

describe("individual detectors", () => {
  const snap = (findings: Partial<AuditSnapshot["findings"][number]>[], declaredLength: Record<string, number | null> = {}): AuditSnapshot => ({
    auditId: "a",
    companyId: "c",
    declaredLength,
    findings: findings.map((f, i) => ({ id: `f${i}`, checkKey: "x", status: "FAIL", severity: "medium", confidence: 0.9, evidenceIds: [`e${i}`], ...f })),
  });
  const types = (s: AuditSnapshot) => detectAll(s).map((c) => c.typeKey).sort();

  it("ignores INDETERMINATE, NOT_APPLICABLE and PASS results", () => {
    for (const status of ["INDETERMINATE", "NOT_APPLICABLE", "PASS", "ERROR"]) {
      expect(types(snap([{ checkKey: "conv.enquiry_form", status }, { checkKey: "tech.viewport_meta", status, severity: "medium" }]))).toEqual([]);
    }
  });

  it("ignores failures below the confidence floor", () => {
    expect(types(snap([{ checkKey: "conv.click_to_call", confidence: MIN_FINDING_CONFIDENCE - 0.01 }]))).toEqual([]);
  });

  it("never emits a signal with nothing to cite", () => {
    expect(types(snap([{ checkKey: "tech.viewport_meta", evidenceIds: [] }]))).toEqual([]);
  });

  it("needs a medium or high failure for web_underperformance; low and info never count", () => {
    expect(types(snap([{ checkKey: "conv.trust_signals", severity: "low" }, { checkKey: "conv.whatsapp_link", severity: "info" }]))).toEqual([]);
    const one = detectAll(snap([{ checkKey: "tech.title", severity: "medium" }]));
    expect(one.map((c) => [c.typeKey, c.strength])).toEqual([["web_underperformance", 0.45]]);
    const heavy = detectAll(snap([{ checkKey: "tech.https", severity: "high" }, { checkKey: "conv.contact_path", severity: "high" }, { checkKey: "tech.title" }]));
    expect(heavy.find((c) => c.typeKey === "web_underperformance")?.strength).toBe(0.9);
  });

  it("never derives a slow-site signal from one slow response alone", () => {
    expect(types(snap([{ checkKey: "tech.response_time", severity: "low", confidence: 0.5 }]))).toEqual([]);
    expect(types(snap([{ checkKey: "tech.html_weight", severity: "low" }]))).toEqual(["slow_mobile_experience"]);
  });

  it("grades a catalogue by its declared size", () => {
    const at = (bytes: number) => detectAll(snap([{ checkKey: "content.heavy_catalogue" }], { e0: bytes })).find((c) => c.typeKey === "catalogue_friction");
    expect(at(12 * 1024 * 1024)?.strength).toBe(0.6);
    expect(at(30 * 1024 * 1024)?.strength).toBe(0.8);
    expect(at(60 * 1024 * 1024)?.strength).toBe(0.9);
  });

  it("emits no_qualification_path only for a genuine FAIL, never for a linked contact page", () => {
    expect(types(snap([{ checkKey: "conv.enquiry_form", severity: "low" }]))).toEqual(["no_qualification_path"]);
    expect(types(snap([{ checkKey: "conv.enquiry_form", status: "INDETERMINATE", severity: null }]))).toEqual([]);
  });
});

describe("coverage and human-only types", () => {
  it("accounts for every signal type: automated detector or a stated reason not to", () => {
    const automated = DETECTORS.map((d) => d.typeKey);
    expect([...automated, ...Object.keys(NOT_AUTOMATED)].sort()).toEqual(seededTypes.map((t) => t.key).sort());
    expect(automated.filter((k) => k in NOT_AUTOMATED)).toEqual([]);
  });

  it("has no detector for procurement_scorecard or agency_fatigue", () => {
    expect(DETECTORS.map((d) => d.typeKey).filter((k) => HUMAN_ONLY.includes(k))).toEqual([]);
    expect(seededTypes.filter((t) => t.humanOnly).map((t) => t.key).sort()).toEqual(HUMAN_ONLY.sort());
  });

  it("has exactly one automated Intent detector: sponsorship_inventory, from an explicit sponsorship offer", () => {
    expect(DETECTORS.map((d) => d.typeKey).filter((k) => INTENT_TYPES.has(k))).toEqual(["sponsorship_inventory"]);
  });

  it("does not raise sponsorship_inventory on a prose-only offer (confidence 0.7) at the default floor", () => {
    const snap: AuditSnapshot = {
      auditId: "a",
      companyId: "c",
      declaredLength: {},
      findings: [{ id: "f", checkKey: "commercial.sponsorship_offer", status: "PRESENT", severity: null, confidence: 0.7, evidenceIds: ["e"] }],
    };
    expect(detectAll(snap)).toEqual([]);
    expect(detectAll({ ...snap, findings: [{ ...snap.findings[0]!, confidence: 0.9 }] }).map((c) => c.typeKey)).toEqual(["sponsorship_inventory"]);
  });
});

describe("capacity is never a signal", () => {
  it("PRESENT capacity findings, however many, produce no signal", () => {
    const keys = ["capacity.careers_page", "capacity.multiple_locations", "capacity.online_shop", "capacity.client_logo_wall", "capacity.sponsor_section", "capacity.accreditation"];
    const s: AuditSnapshot = {
      auditId: "a",
      companyId: "c",
      declaredLength: {},
      findings: keys.map((k) => ({ id: k, checkKey: k, status: "PRESENT", severity: null, confidence: 0.9, evidenceIds: [`${k}#0`] })),
    };
    expect(detectAll(s)).toEqual([]);
  });
});

describe("detector parameters are configuration", () => {
  const one = (checkKey: string, severity = "medium"): AuditSnapshot => ({
    auditId: "a",
    companyId: "c",
    declaredLength: {},
    findings: [{ id: checkKey, checkKey, status: "FAIL", severity, confidence: 0.85, evidenceIds: [`${checkKey}#0`] }],
  });

  it("runs on the code defaults when nothing is stored", () => {
    const [c] = detectAll(one("tech.viewport_meta"));
    expect(c).toMatchObject({ typeKey: "web_underperformance", strength: 0.45 });
  });

  it("uses stored values over the defaults", () => {
    const params = resolveDetectorParams({ web_underperformance: { base: 0.2, per_medium: 0.1 }, mobile_commercial_friction: { strength: 0.5 } });
    const byType = Object.fromEntries(detectAll(one("tech.viewport_meta"), params).map((c) => [c.typeKey, c.strength]));
    expect(byType).toEqual({ web_underperformance: 0.3, mobile_commercial_friction: 0.5 });
  });

  it("rejects an unknown key or a value outside its bounds rather than guessing", () => {
    expect(() => resolveDetectorParams({ web_underperformance: { bsae: 0.2 } })).toThrow(ParamsError);
    expect(() => resolveDetectorParams({ web_underperformance: { base: 1.5 } })).toThrow(/web_underperformance/);
    expect(() => resolveDetectorParams({ mobile_commercial_friction: { min_finding_confidence: 0.2 } })).toThrow(ParamsError);
  });

  it("declares every constant it uses, with a default inside its bounds", () => {
    for (const d of DETECTORS) {
      expect(Object.keys(d.params)).toEqual(expect.arrayContaining(["min_finding_confidence", "max_strength"]));
      for (const [k, v] of Object.entries(d.params)) expect(v.default >= v.min && v.default <= v.max, `${d.typeKey}.${k}`).toBe(true);
    }
  });
});
