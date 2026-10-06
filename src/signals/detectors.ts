// Signal detectors. Pure: each reads a snapshot of one completed audit's findings and the
// evidence behind them, and either abstains or proposes one signal resting on named
// findings and evidence. Nothing here reads HTML or calls a model; abstention is the default.
import { type Params, type ParamSpecs, resolveParams } from "@/core/params";

export interface FindingFact {
  id: string;
  checkKey: string;
  status: string;
  severity: string | null;
  confidence: number;
  evidenceIds: string[];
}

export interface AuditSnapshot {
  auditId: string;
  companyId: string;
  findings: FindingFact[];
  /** Declared Content-Length of the source record behind each evidence id, where known. */
  declaredLength: Record<string, number | null>;
}

export interface Candidate {
  typeKey: string;
  strength: number;
  findingIds: string[];
  evidenceIds: string[];
  rationale: string;
}

export interface Detector {
  /** The signal type it can produce (signal_types.key). */
  typeKey: string;
  rule: string;
  /** Strengths and thresholds, configurable per signal type (signal_types.detector_params). */
  params: ParamSpecs;
  detect(s: AuditSnapshot, p: Params): Candidate | null;
}

/** Default floor below which a FAIL is too uncertain to build an interpretation on. */
export const MIN_FINDING_CONFIDENCE = 0.6;

const unit = (d: number, description: string) => ({ default: d, min: 0, max: 1, description });
/** Every detector has these two: the confidence a FAIL needs to count, and the strength cap. */
const common = (minConfidence = MIN_FINDING_CONFIDENCE) => ({
  min_finding_confidence: { default: minConfidence, min: 0.5, max: 1, description: "A FAIL below this confidence never contributes" },
  max_strength: unit(0.9, "Cap on the signal's strength"),
});

const failed = (s: AuditSnapshot, key: string, minConfidence: number) =>
  s.findings.find((f) => f.checkKey === key && f.status === "FAIL" && f.confidence >= minConfidence && f.evidenceIds.length > 0);

/**
 * A PRESENT result of a commercial-offer check (commercial.*). Capacity checks are never
 * read here: capacity feeds commercial potential, not signals.
 */
const offered = (s: AuditSnapshot, key: `commercial.${string}`, minConfidence: number) =>
  s.findings.find((f) => f.checkKey === key && f.status === "PRESENT" && f.confidence >= minConfidence && f.evidenceIds.length > 0);

const round = (n: number) => Math.round(n * 1000) / 1000;

function candidate(typeKey: string, strength: number, findings: FindingFact[], rationale: string, p: Params): Candidate | null {
  const evidenceIds = [...new Set(findings.flatMap((f) => f.evidenceIds))];
  if (!evidenceIds.length) return null; // a signal with nothing to cite is not emitted
  return { typeKey, strength: round(Math.min(p.max_strength as number, strength)), findingIds: findings.map((f) => f.id), evidenceIds, rationale };
}

const n = (p: Params, k: string) => p[k] as number;

export const DETECTORS: Detector[] = [
  {
    typeKey: "web_underperformance",
    rule: "At least one medium- or high-severity FAIL (confidence ≥ min_finding_confidence). Strength base + per_medium × mediums + per_high × highs, capped at max_strength. Opportunity axis only, always.",
    params: {
      ...common(),
      base: unit(0.3, "Strength with one qualifying failure before per-failure increments"),
      per_medium: unit(0.15, "Added per medium-severity failure"),
      per_high: unit(0.25, "Added per high-severity failure"),
    },
    detect(s, p) {
      const fs = s.findings.filter(
        (f) => f.status === "FAIL" && (f.severity === "medium" || f.severity === "high") && f.confidence >= n(p, "min_finding_confidence") && f.evidenceIds.length,
      );
      if (!fs.length) return null;
      const medium = fs.filter((f) => f.severity === "medium").length;
      const high = fs.filter((f) => f.severity === "high").length;
      return candidate("web_underperformance", n(p, "base") + n(p, "per_medium") * medium + n(p, "per_high") * high, fs, `${high} high and ${medium} medium audit failures`, p);
    },
  },
  {
    typeKey: "catalogue_friction",
    rule: "content.heavy_catalogue FAILED (a linked PDF over that check's max_pdf_bytes). Strength base; over_large_mb_strength above large_mb; over_huge_mb_strength above huge_mb.",
    params: {
      ...common(),
      base: unit(0.6, "Strength for any oversized catalogue"),
      large_mb: { default: 25, min: 1, max: 1000, description: "Size in MB above which the larger strength applies" },
      over_large_mb_strength: unit(0.8, "Strength above large_mb"),
      huge_mb: { default: 50, min: 1, max: 1000, description: "Size in MB above which the largest strength applies" },
      over_huge_mb_strength: unit(0.9, "Strength above huge_mb"),
    },
    detect(s, p) {
      const f = failed(s, "content.heavy_catalogue", n(p, "min_finding_confidence"));
      if (!f) return null;
      const largest = Math.max(0, ...f.evidenceIds.map((id) => s.declaredLength[id] ?? 0));
      const mb = largest / 1024 / 1024;
      const strength = mb > n(p, "huge_mb") ? n(p, "over_huge_mb_strength") : mb > n(p, "large_mb") ? n(p, "over_large_mb_strength") : n(p, "base");
      return candidate("catalogue_friction", strength, [f], `catalogue PDF of ${mb.toFixed(1)} MB`, p);
    },
  },
  {
    typeKey: "mobile_commercial_friction",
    rule: "tech.viewport_meta FAILED (confidence ≥ min_finding_confidence, default 0.8): phones render the desktop layout.",
    params: { ...common(0.8), strength: unit(0.7, "Signal strength") },
    detect(s, p) {
      const f = failed(s, "tech.viewport_meta", n(p, "min_finding_confidence"));
      return f ? candidate("mobile_commercial_friction", n(p, "strength"), [f], "no mobile viewport", p) : null;
    },
  },
  {
    typeKey: "slow_mobile_experience",
    rule: "tech.html_weight FAILED. Strength base, or with_slow_response when tech.response_time also FAILED (at slow_response_min_confidence). A slow response alone (one measurement) never produces it.",
    params: {
      ...common(),
      base: unit(0.5, "Strength for heavy HTML"),
      with_slow_response: unit(0.6, "Strength for heavy HTML with a slow response"),
      slow_response_min_confidence: { default: 0.5, min: 0.5, max: 1, description: "Confidence a response-time FAIL needs to add to the strength" },
    },
    detect(s, p) {
      const weight = failed(s, "tech.html_weight", n(p, "min_finding_confidence"));
      if (!weight) return null;
      const slow = failed(s, "tech.response_time", n(p, "slow_response_min_confidence"));
      return candidate("slow_mobile_experience", slow ? n(p, "with_slow_response") : n(p, "base"), slow ? [weight, slow] : [weight], slow ? "heavy HTML and slow response" : "heavy HTML", p);
    },
  },
  {
    typeKey: "lead_response_friction",
    rule: "Any of: phone not tappable (conv.click_to_call), too many required form fields (conv.form_required_fields), no call to action in the first screen (conv.primary_cta_first_screen). Part strengths combined as 1 − ∏(1 − s), capped at max_strength.",
    params: {
      ...common(),
      click_to_call: unit(0.5, "Part strength for a phone number that is not tappable"),
      form_required_fields: unit(0.5, "Part strength for too many required form fields"),
      primary_cta_first_screen: unit(0.4, "Part strength for no call to action in the first screen"),
    },
    detect(s, p) {
      const min = n(p, "min_finding_confidence");
      const parts: [FindingFact | undefined, number][] = [
        [failed(s, "conv.click_to_call", min), n(p, "click_to_call")],
        [failed(s, "conv.form_required_fields", min), n(p, "form_required_fields")],
        [failed(s, "conv.primary_cta_first_screen", min), n(p, "primary_cta_first_screen")],
      ];
      const hits = parts.filter((x): x is [FindingFact, number] => !!x[0]);
      if (!hits.length) return null;
      const strength = 1 - hits.reduce((acc, [, w]) => acc * (1 - w), 1);
      return candidate("lead_response_friction", strength, hits.map(([f]) => f), hits.map(([f]) => f.checkKey).join(", "), p);
    },
  },
  {
    typeKey: "no_qualification_path",
    rule: "conv.enquiry_form FAILED: no form, no embedded form and no linked contact page (INDETERMINATE never counts).",
    params: { ...common(), strength: unit(0.6, "Signal strength") },
    detect(s, p) {
      const f = failed(s, "conv.enquiry_form", n(p, "min_finding_confidence"));
      return f ? candidate("no_qualification_path", n(p, "strength"), [f], "no enquiry form or contact page", p) : null;
    },
  },
  {
    typeKey: "sponsorship_inventory",
    rule: "commercial.sponsorship_offer PRESENT (confidence ≥ min_finding_confidence, default 0.8): an explicit offer to sell sponsorship (packages, 'become a sponsor'). Prose-only offers (confidence 0.7) do not qualify by default. Evidence of commercial inventory to sell (the sports ICP criterion), not of existing sponsors.",
    params: { ...common(0.8), strength: unit(0.7, "Signal strength") },
    detect(s, p) {
      const f = offered(s, "commercial.sponsorship_offer", n(p, "min_finding_confidence"));
      return f ? candidate("sponsorship_inventory", n(p, "strength"), [f], "sponsorship offered for sale", p) : null;
    },
  },
];

/**
 * Signal types deliberately not detected automatically, and why. Operators can still
 * record any of these (human-only types can only be recorded by an operator).
 */
export const NOT_AUTOMATED: Record<string, string> = {
  procurement_scorecard: "Human-only by design (Phase 0): the inference is plausible-sounding and costly when wrong.",
  agency_fatigue: "Human-only (Phase 8): a claim about dissatisfaction with a supplier; nothing on a homepage evidences it unambiguously.",
  matchday_scramble: "Needs fixture and posting cadence from social channels; social audit is not in M0.",
  brand_upgrade_need: "Needs a cross-channel comparison of marks and presentation; not observable from homepage findings.",
  high_value_products: "Needs product value from page prose; no deterministic finding evidences it.",
  rfq_friction: "No deterministic check isolates the quotation path from general enquiry friction (that is lead_response_friction).",
  urgent_service_model: "Needs reading service descriptions (\"24-hour\", \"emergency\"); not a finding.",
  whatsapp_conversion_opportunity: "Friction only for some segments (urgent trade); absence alone fires on most well-built sites.",
  matchday_content_friction: "Needs social posting history.",
  audience_scale: "Needs audience figures, which are not observable from a page and must not be estimated.",
  attendance_opportunity: "Needs fixture, ticketing and attendance context; not a finding.",
  manual_order_handling: "Needs reading how orders are taken; not a finding.",
  pricing_opacity: "Friction only for some segments (service businesses); absence alone fires on law firms and suppliers.",
};

/** Resolved parameters per detector: stored values (signal_types.detector_params) over code defaults. Throws on an invalid row. */
export function resolveDetectorParams(stored: Readonly<Record<string, unknown>> = {}): Record<string, Params> {
  return Object.fromEntries(DETECTORS.map((d) => [d.typeKey, resolveParams(d.params, stored[d.typeKey], `detector ${d.typeKey}`)]));
}

/**
 * Runs every detector. Detectors read FAIL findings and the PRESENT results of
 * commercial-offer checks; capacity results are evidence of scale for commercial potential
 * and never become signals.
 */
export function detectAll(s: AuditSnapshot, params: Readonly<Record<string, Params>> = {}): Candidate[] {
  return DETECTORS.map((d) => d.detect(s, params[d.typeKey] ?? resolveParams(d.params, undefined, d.typeKey))).filter((c): c is Candidate => c !== null);
}
