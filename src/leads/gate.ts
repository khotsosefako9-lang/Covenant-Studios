// The intent gate and the lead state machine. Pure: the caller loads the inputs, this
// decides. Weakness alone never qualifies a lead. The gate has two routes (Phase 0):
//   1. buying_signal: a live Intent signal, inside its decay window;
//   2. commercial_potential_floor: the best current opportunity's entry price is at or
//      above the floor AND the capacity profile evidences a business operating at the
//      scale to pay it. A price alone says what Covenant would charge, not whether this
//      business can pay it, so without capacity evidence there is no commercial potential.
// The system never produces OUTREACH_READY: that needs a human YES (Phase 13).
import type { CapacityProfile } from "@/commercial/capacity";
import type { Treatment } from "@/core/scoring";

export const GATE_RULE_VERSION = "intent-gate/2";

export type LeadState = "PENDING_EVALUATION" | "WATCH_WEAKNESS_ONLY" | "COMMERCIAL_OPPORTUNITY" | "DISQUALIFIED";
export type GateStatus = "NOT_EVALUATED" | "PASSED" | "FAILED";
export type GateBasis = "buying_signal" | "commercial_potential_floor";

/**
 * Service units that are an entry point (commercial_potential_floor_zar's own definition):
 * add-ons, per-piece work and retainers are not, so they never count toward the floor.
 */
export const ENTRY_UNITS: ReadonlySet<string> = new Set(["project", "bundle"]);

export interface IntentGateParams {
  min_intent_strength: number;
  min_capacity_markers: number;
  min_capacity_confidence: number;
}

export interface GateInput {
  /** The cluster's latest audit of any status, and its latest completed one. */
  latestAudit: { id: string; status: string } | null;
  completedAuditId: string | null;
  /** Active Intent-axis signals, strength decayed to now. */
  intentSignals: { id: string; typeKey: string; detectedBy: string; strengthNow: number; evidenceIds: string[] }[];
  /** Active Opportunity-axis signals (weaknesses), for the record only: they never pass the gate. */
  weaknessSignals: { id: string; typeKey: string }[];
  opportunities: { id: string; rank: number; typeKey: string; serviceKey: string | null; serviceUnit: string | null; priceLowZar: number | null }[];
  capacity: CapacityProfile | null;
  /** Active (not retracted) disqualifications. */
  disqualifications: { id: string; disqualifierKey: string; recordedBy: string }[];
  floorZar: number | null;
  params: IntentGateParams;
  /**
   * The lead's score this evaluation (Phase 11), with the Phase 0 treatment of its score and
   * confidence against the qualification thresholds. Null = not scored (nothing to evaluate,
   * or the thresholds are NOT_CONFIGURED).
   */
  score?: { total: number; confidence: number; treatment: Treatment | null; thresholds: { score: number | null; confidence: number | null } } | null;
}

export interface GateOutcome {
  systemState: LeadState;
  gateStatus: GateStatus;
  gateBasis: GateBasis | null;
  commercialPotentialZar: number | null;
  treatment: Treatment | null;
  reasons: string[];
  rule: string;
  detail: {
    intent: { signalId: string; typeKey: string; detectedBy: string; strengthNow: number }[];
    capacity: { checkKey: string; findingId: string; confidence: number }[];
    entryOpportunity: { opportunityId: string; typeKey: string; serviceKey: string | null; priceLowZar: number } | null;
    opportunities: string[];
    weaknesses: string[];
    disqualifications: { id: string; disqualifierKey: string; recordedBy: string }[];
    auditId: string | null;
  };
}

export function gateRule(p: IntentGateParams, floorZar: number | null): string {
  return (
    `${GATE_RULE_VERSION}: buying_signal = an active Intent signal with decayed strength > ${p.min_intent_strength}; ` +
    `commercial_potential_floor = the best current opportunity's entry price (project or bundle) ≥ R${floorZar ?? "NOT_CONFIGURED"} ` +
    `with ≥ ${p.min_capacity_markers} capacity markers PRESENT at confidence ≥ ${p.min_capacity_confidence}; ` +
    `DISQUALIFIED on any active disqualification; COMMERCIAL_OPPORTUNITY = gate passed, an opportunity derived, and score and confidence both at or above their thresholds; otherwise WATCH_WEAKNESS_ONLY`
  );
}

export function evaluateGate(input: GateInput): GateOutcome {
  const { params: p } = input;
  const reasons: string[] = [];
  const intent = input.intentSignals.filter((s) => s.strengthNow > p.min_intent_strength && s.evidenceIds.length > 0);
  const markers = (input.capacity?.present ?? []).filter((m) => m.confidence >= p.min_capacity_confidence);
  const entry = input.opportunities
    .filter((o): o is typeof o & { priceLowZar: number } => o.priceLowZar !== null && ENTRY_UNITS.has(o.serviceUnit ?? ""))
    .sort((a, b) => b.priceLowZar - a.priceLowZar || a.rank - b.rank)[0];
  const potential = entry && markers.length >= p.min_capacity_markers ? entry.priceLowZar : null;

  const detail: GateOutcome["detail"] = {
    intent: intent.map((s) => ({ signalId: s.id, typeKey: s.typeKey, detectedBy: s.detectedBy, strengthNow: s.strengthNow })),
    capacity: markers.map((m) => ({ checkKey: m.checkKey, findingId: m.findingId, confidence: m.confidence })),
    entryOpportunity: entry ? { opportunityId: entry.id, typeKey: entry.typeKey, serviceKey: entry.serviceKey, priceLowZar: entry.priceLowZar } : null,
    opportunities: input.opportunities.map((o) => o.typeKey),
    weaknesses: input.weaknessSignals.map((s) => s.typeKey),
    disqualifications: input.disqualifications,
    auditId: input.completedAuditId,
  };
  const rule = gateRule(p, input.floorZar);
  const treatment = input.score?.treatment ?? null;
  const base = { commercialPotentialZar: potential, rule, detail, treatment };

  const evidenced = input.completedAuditId !== null || input.intentSignals.length > 0 || input.opportunities.length > 0 || input.disqualifications.length > 0;
  if (!evidenced) {
    reasons.push(input.latestAudit ? `No completed audit: the latest audit is ${input.latestAudit.status}, and nothing else is recorded` : "Not audited yet, and nothing else is recorded");
    return { ...base, systemState: "PENDING_EVALUATION", gateStatus: "NOT_EVALUATED", gateBasis: null, reasons };
  }

  let gateBasis: GateBasis | null = null;
  if (intent.length) {
    gateBasis = "buying_signal";
    reasons.push(`Intent: ${intent.map((s) => `${s.typeKey} (${s.detectedBy}, ${s.strengthNow.toFixed(2)} now)`).join(", ")}`);
  } else {
    reasons.push(input.intentSignals.length ? "No live Intent signal: every Intent signal has decayed out of its window" : "No Intent signal");
  }
  if (input.floorZar === null) reasons.push("Commercial potential not evaluated: commercial_potential_floor_zar is NOT_CONFIGURED");
  else if (!entry) reasons.push(input.opportunities.length ? "No current opportunity maps to a published entry-priced service (project or bundle)" : "No opportunity derived, so no entry price");
  else if (potential === null) reasons.push(`Entry price R${entry.priceLowZar} (${entry.serviceKey}) is not evidenced as payable: ${markers.length} of ${p.min_capacity_markers} capacity markers PRESENT`);
  else if (potential < input.floorZar) reasons.push(`Commercial potential R${potential} is below the R${input.floorZar} floor`);
  else {
    reasons.push(`Commercial potential R${potential} (${entry.serviceKey}) ≥ R${input.floorZar}, on ${markers.map((m) => m.checkKey).join(", ")}`);
    gateBasis ??= "commercial_potential_floor";
  }
  const gateStatus: GateStatus = gateBasis ? "PASSED" : "FAILED";

  let systemState: LeadState;
  if (input.disqualifications.length) {
    systemState = "DISQUALIFIED";
    reasons.unshift(`Disqualified: ${[...new Set(input.disqualifications.map((d) => d.disqualifierKey))].join(", ")}`);
  } else if (gateStatus === "PASSED" && input.opportunities.length && treatment === "queue_for_review") {
    systemState = "COMMERCIAL_OPPORTUNITY";
  } else {
    systemState = "WATCH_WEAKNESS_ONLY";
    if (gateStatus === "PASSED" && !input.opportunities.length) reasons.push("The gate passed but no opportunity was derived: nothing to pursue yet");
    else if (gateStatus === "PASSED") reasons.push("The gate passed but the score does not qualify the lead");
    else if (!input.weaknessSignals.length) reasons.push("No weakness found either");
  }
  if (input.score) reasons.push(scoreReason(input.score));
  return { ...base, systemState, gateStatus, gateBasis, reasons };
}

function scoreReason(score: NonNullable<GateInput["score"]>): string {
  const { total, confidence, treatment, thresholds } = score;
  const at = `score ${total.toFixed(1)}, confidence ${confidence.toFixed(2)} (thresholds ${thresholds.score ?? "NOT_CONFIGURED"} / ${thresholds.confidence ?? "NOT_CONFIGURED"})`;
  switch (treatment) {
    case "queue_for_review":
      return `Qualifies on ${at}`;
    case "needs_verification":
      return `Needs verification: ${at}; the score is high but too little of it is evidenced, so collect more evidence before any contact`;
    case "reject":
      return `Does not qualify: ${at}; the evidence is sound and the score is low`;
    case "park":
      return `Parked: ${at}; both are low, re-evaluate on the next refresh`;
    default:
      return `Not qualified: ${at}`;
  }
}
