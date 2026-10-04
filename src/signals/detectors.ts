// Signal detectors. Pure: each reads a snapshot of one completed audit's findings and the
// evidence behind them, and either abstains or proposes one signal resting on named
// findings and evidence. Nothing here reads HTML or calls a model; abstention is the default.

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
  detect(s: AuditSnapshot): Candidate | null;
}

/** Below this confidence a FAIL is too uncertain to build an interpretation on. */
export const MIN_FINDING_CONFIDENCE = 0.6;

const failed = (s: AuditSnapshot, key: string, minConfidence = MIN_FINDING_CONFIDENCE) =>
  s.findings.find((f) => f.checkKey === key && f.status === "FAIL" && f.confidence >= minConfidence && f.evidenceIds.length > 0);

const round = (n: number) => Math.round(n * 1000) / 1000;

function candidate(typeKey: string, strength: number, findings: FindingFact[], rationale: string): Candidate | null {
  const evidenceIds = [...new Set(findings.flatMap((f) => f.evidenceIds))];
  if (!evidenceIds.length) return null; // a signal with nothing to cite is not emitted
  return { typeKey, strength: round(Math.min(0.9, strength)), findingIds: findings.map((f) => f.id), evidenceIds, rationale };
}

export const DETECTORS: Detector[] = [
  {
    typeKey: "web_underperformance",
    rule: "At least one medium- or high-severity FAIL (confidence ≥ 0.6). Strength 0.3 + 0.15 per medium + 0.25 per high, capped at 0.9.",
    detect(s) {
      const fs = s.findings.filter(
        (f) => f.status === "FAIL" && (f.severity === "medium" || f.severity === "high") && f.confidence >= MIN_FINDING_CONFIDENCE && f.evidenceIds.length,
      );
      if (!fs.length) return null;
      const medium = fs.filter((f) => f.severity === "medium").length;
      const high = fs.filter((f) => f.severity === "high").length;
      return candidate("web_underperformance", 0.3 + 0.15 * medium + 0.25 * high, fs, `${high} high and ${medium} medium audit failures`);
    },
  },
  {
    typeKey: "catalogue_friction",
    rule: "content.heavy_catalogue FAILED (a linked PDF over 10 MB). Strength 0.6, 0.8 above 25 MB, 0.9 above 50 MB.",
    detect(s) {
      const f = failed(s, "content.heavy_catalogue");
      if (!f) return null;
      const largest = Math.max(0, ...f.evidenceIds.map((id) => s.declaredLength[id] ?? 0));
      const mb = largest / 1024 / 1024;
      return candidate("catalogue_friction", mb > 50 ? 0.9 : mb > 25 ? 0.8 : 0.6, [f], `catalogue PDF of ${mb.toFixed(1)} MB`);
    },
  },
  {
    typeKey: "mobile_commercial_friction",
    rule: "tech.viewport_meta FAILED: phones render the desktop layout. Strength 0.7.",
    detect(s) {
      const f = failed(s, "tech.viewport_meta", 0.8);
      return f ? candidate("mobile_commercial_friction", 0.7, [f], "no mobile viewport") : null;
    },
  },
  {
    typeKey: "slow_mobile_experience",
    rule: "tech.html_weight FAILED (HTML over 1 MB). Strength 0.5, plus 0.1 when tech.response_time also FAILED. A slow response alone (one measurement) never produces it.",
    detect(s) {
      const weight = failed(s, "tech.html_weight");
      if (!weight) return null;
      const slow = failed(s, "tech.response_time", 0.5);
      return candidate("slow_mobile_experience", slow ? 0.6 : 0.5, slow ? [weight, slow] : [weight], slow ? "heavy HTML and slow response" : "heavy HTML");
    },
  },
  {
    typeKey: "lead_response_friction",
    rule: "Any of: phone not tappable (conv.click_to_call), over 6 required form fields (conv.form_required_fields), no call to action in the first screen (conv.primary_cta_first_screen). Strengths 0.5 / 0.5 / 0.4 combined as 1 − ∏(1 − s), capped at 0.9.",
    detect(s) {
      const parts: [FindingFact | undefined, number][] = [
        [failed(s, "conv.click_to_call"), 0.5],
        [failed(s, "conv.form_required_fields"), 0.5],
        [failed(s, "conv.primary_cta_first_screen"), 0.4],
      ];
      const hits = parts.filter((p): p is [FindingFact, number] => !!p[0]);
      if (!hits.length) return null;
      const strength = 1 - hits.reduce((acc, [, w]) => acc * (1 - w), 1);
      return candidate("lead_response_friction", strength, hits.map(([f]) => f), hits.map(([f]) => f.checkKey).join(", "));
    },
  },
  {
    typeKey: "no_qualification_path",
    rule: "conv.enquiry_form FAILED: no form, no embedded form and no linked contact page (INDETERMINATE never counts). Strength 0.6.",
    detect(s) {
      const f = failed(s, "conv.enquiry_form");
      return f ? candidate("no_qualification_path", 0.6, [f], "no enquiry form or contact page") : null;
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
  sponsorship_inventory: "Needs reading sponsor and partner sections; not a finding.",
  matchday_content_friction: "Needs social posting history.",
  audience_scale: "Needs audience figures, which are not observable from a page and must not be estimated.",
  attendance_opportunity: "Needs fixture, ticketing and attendance context; not a finding.",
  manual_order_handling: "Needs reading how orders are taken; not a finding.",
  pricing_opacity: "Friction only for some segments (service businesses); absence alone fires on law firms and suppliers.",
};

export function detectAll(s: AuditSnapshot): Candidate[] {
  return DETECTORS.map((d) => d.detect(s)).filter((c): c is Candidate => c !== null);
}
