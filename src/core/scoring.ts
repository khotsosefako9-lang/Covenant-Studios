// Scoring and confidence (Phase 0, "Scoring and confidence"). Pure and deterministic: every
// number is a function of stored evidence and configuration. No model output enters any
// number, and model self-assurance contributes nothing to confidence.
//
//   Score      = 100 × Σ_d w_d · s_d · k_d
//   Confidence = Σ_d w_d · c_d / Σ_d w_d,   c_d = coverage_d × recency_d × verifiability_d
//
// s_d is computed only over the inputs a dimension could evaluate; what it could not
// evaluate lowers coverage (and so confidence), never the value. A dimension with nothing
// evaluable scores 0 with coverage 0.

export const SCORING_RULE_VERSION = "scoring/1";

export const DIMENSIONS = [
  "buying_signal",
  "icp_fit",
  "digital_opportunity",
  "service_fit",
  "commercial_potential",
  "contactability",
  "evidence_quality",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** Phase 0 axes: commercial potential and buying signal are Intent; digital opportunity and service fit are Opportunity. */
export const AXIS: Record<Dimension, "intent" | "opportunity" | null> = {
  buying_signal: "intent",
  icp_fit: null,
  digital_opportunity: "opportunity",
  service_fit: "opportunity",
  commercial_potential: "intent",
  contactability: null,
  evidence_quality: null,
};

export type ClaimType = "VERIFIED" | "INFERRED" | "REPORTED" | "UNKNOWN";
export type Weights = Record<Dimension, number>;

export interface ScoringParams {
  /** Weight of a FAIL by severity in digital_opportunity (multiplied by the finding's confidence). */
  severity_weights: { high: number; medium: number; low: number; info: number };
  /** s for icp_fit by the operator-assigned segment fit. */
  segment_fit_values: { fit: number; potentially_valid: number; not_fit: number };
}

export interface ScoringInput {
  now: Date;
  weights: Weights;
  params: ScoringParams;
  verifiability: Record<ClaimType, number>;
  /** Recency factor (Phase 0) of the latest completed audit, or null when there is none. */
  auditRecency: number | null;
  auditId: string | null;
  /** Active Intent-axis signals. */
  intentSignals: {
    id: string;
    typeKey: string;
    strength: number;
    strengthNow: number;
    claimType: ClaimType;
    recency: number;
    evidenceIds: string[];
    findingIds: string[];
  }[];
  /** Intent signal types an automated detector could have raised from a completed audit, and all active Intent types. */
  intentTypes: { detectable: number; total: number };
  /** Current opportunities, ranked. */
  opportunities: {
    id: string;
    rank: number;
    typeKey: string;
    relevance: number;
    service: { key: string; active: boolean; unit: string; priceLowZar: number | null } | null;
    /** FAIL findings the opportunity rests on (through its signals). */
    failFindings: { id: string; checkKey: string; severity: string; confidence: number; evidenceIds: string[] }[];
    signalIds: string[];
  }[];
  /** The highest published price_low of any active service: the scale commercial value is read against. */
  referencePriceZar: number | null;
  capacity: { markers: { checkKey: string; findingId: string; evidenceIds: string[] }[]; required: number };
  /** Operator-assigned segment fit; null when nobody has assigned one. */
  segment: { fit: "fit" | "potentially_valid" | "not_fit"; segmentKey: string | null; recency: number } | null;
  contact: {
    /** Contact channels on record (CSV or operator), with their verification. */
    channels: { id: string; kind: string; verification: string; claimType: ClaimType; recency: number; evidenceId: string }[];
    /** Channels the audit observed on the site (contact path, tappable phone, enquiry form), as PASS findings. */
    observed: { findingId: string; checkKey: string; evidenceIds: string[] }[];
    /** Named contacts on record, and whether any is a decision maker. Null when no contact has ever been recorded. */
    decisionMaker: { contactIds: string[]; present: boolean; claimType: ClaimType } | null;
    /** Suppression is not built until M3: null = not evaluable. */
    suppressed: boolean | null;
  };
}

export interface DimensionScore {
  dimension: Dimension;
  value: number;
  weight: number;
  decay: number;
  contribution: number;
  coverage: number;
  recency: number;
  verifiability: number;
  explanation: string;
  inputs: {
    signals: string[];
    findings: string[];
    opportunities: string[];
    channels: string[];
    contacts: string[];
    evidence: string[];
    /** commercial_potential only: the evidenced components, in rand. */
    components?: { initialValueZar: number; recurringValueZar: number; expansionPotentialZar: number; commercialValueZar: number; referencePriceZar: number | null };
  };
}

export interface ScoreResult {
  total: number;
  opportunityAxis: number;
  intentAxis: number;
  confidence: number;
  dimensions: DimensionScore[];
  rule: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const noisyOr = (xs: number[]) => 1 - xs.reduce((a, x) => a * (1 - clamp(x)), 1);
const uniq = (xs: string[]) => [...new Set(xs)];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const empty = () => ({ signals: [], findings: [], opportunities: [], channels: [], contacts: [], evidence: [] }) as DimensionScore["inputs"];

type Partial = Omit<DimensionScore, "weight" | "contribution" | "dimension">;

function buyingSignal(i: ScoringInput): Partial {
  const live = i.intentSignals.filter((s) => s.evidenceIds.length);
  if (!live.length) {
    // Nothing raised. The audit only looked for the Intent types a detector exists for.
    const coverage = i.auditId && i.intentTypes.total ? i.intentTypes.detectable / i.intentTypes.total : 0;
    return {
      value: 0,
      decay: 1,
      coverage: r3(coverage),
      recency: i.auditRecency ?? 0,
      verifiability: i.auditId ? i.verifiability.VERIFIED : 0,
      explanation: i.auditId
        ? `No Intent signal. The audit can raise ${i.intentTypes.detectable} of ${i.intentTypes.total} Intent types; the rest need an operator`
        : "No Intent signal and no completed audit",
      inputs: empty(),
    };
  }
  const raw = noisyOr(live.map((s) => s.strength));
  const now = noisyOr(live.map((s) => s.strengthNow));
  return {
    value: r3(raw),
    decay: raw ? r3(now / raw) : 0,
    coverage: 1,
    recency: r3(Math.max(...live.map((s) => s.recency))),
    verifiability: r3(mean(live.map((s) => i.verifiability[s.claimType]))),
    explanation: `${live.map((s) => `${s.typeKey} ${s.strength} (${s.strengthNow} now, ${s.claimType})`).join(", ")}; combined as 1 − ∏(1 − strength)`,
    inputs: { ...empty(), signals: live.map((s) => s.id), findings: uniq(live.flatMap((s) => s.findingIds)), evidence: uniq(live.flatMap((s) => s.evidenceIds)) },
  };
}

function icpFit(i: ScoringInput): Partial {
  if (!i.segment) {
    return {
      value: 0,
      decay: 1,
      coverage: 0,
      recency: 0,
      verifiability: 0,
      explanation: "Not evaluable: no segment fit has been assigned, and segment criteria are not configured for automatic matching",
      inputs: empty(),
    };
  }
  return {
    value: r3(i.params.segment_fit_values[i.segment.fit]),
    decay: 1,
    coverage: 1,
    recency: i.segment.recency,
    verifiability: i.verifiability.REPORTED,
    explanation: `Operator-assigned segment fit: ${i.segment.fit}${i.segment.segmentKey ? ` (${i.segment.segmentKey})` : ""}`,
    inputs: empty(),
  };
}

function digitalOpportunity(i: ScoringInput): Partial {
  const findings = new Map<string, ScoringInput["opportunities"][number]["failFindings"][number]>();
  for (const o of i.opportunities) for (const f of o.failFindings) findings.set(f.id, f);
  const fs = [...findings.values()];
  if (!i.auditId) return { value: 0, decay: 1, coverage: 0, recency: 0, verifiability: 0, explanation: "No completed audit", inputs: empty() };
  const sev = i.params.severity_weights as Record<string, number>;
  const value = noisyOr(fs.map((f) => (sev[f.severity] ?? 0) * f.confidence));
  return {
    value: r3(value),
    decay: 1,
    coverage: 1,
    recency: i.auditRecency ?? 0,
    verifiability: i.verifiability.VERIFIED,
    explanation: fs.length
      ? `${fs.length} audit failure(s) behind current opportunities, severity-weighted: ${fs.map((f) => `${f.checkKey} (${f.severity}, ${f.confidence})`).join(", ")}`
      : "No audit failure behind any current opportunity",
    inputs: { ...empty(), findings: fs.map((f) => f.id), opportunities: i.opportunities.filter((o) => o.failFindings.length).map((o) => o.id), evidence: uniq(fs.flatMap((f) => f.evidenceIds)) },
  };
}

function serviceFit(i: ScoringInput): Partial {
  const sold = i.opportunities.filter((o) => o.service?.active);
  if (!i.opportunities.length) {
    return {
      value: 0,
      decay: 1,
      coverage: i.auditId ? 1 : 0,
      recency: i.auditRecency ?? 0,
      verifiability: i.auditId ? i.verifiability.INFERRED : 0,
      explanation: "No opportunity derived, so nothing Covenant sells is indicated",
      inputs: empty(),
    };
  }
  const best = [...sold].sort((a, b) => b.relevance - a.relevance)[0];
  return {
    value: r3(best?.relevance ?? 0),
    decay: 1,
    coverage: 1,
    recency: i.auditRecency ?? 1,
    verifiability: i.verifiability.INFERRED,
    explanation: best
      ? `${best.typeKey} → ${best.service?.key}, a service Covenant sells, at relevance ${best.relevance}${sold.length < i.opportunities.length ? `; ${i.opportunities.length - sold.length} opportunity type(s) map to no active service` : ""}`
      : "No current opportunity maps to an active service",
    inputs: { ...empty(), opportunities: sold.map((o) => o.id), signals: uniq(sold.flatMap((o) => o.signalIds)) },
  };
}

function commercialPotential(i: ScoringInput): Partial {
  const [first, second] = [...i.opportunities].sort((a, b) => a.rank - b.rank);
  const valueOf = (o: typeof first) => {
    const svc = o?.service;
    if (!svc?.active || svc.priceLowZar === null) return { initial: 0, recurring: 0 };
    // Recurring only where the mapped service is itself a published retainer (per month, never times a guessed duration).
    return svc.unit === "retainer" ? { initial: 0, recurring: svc.priceLowZar } : { initial: svc.priceLowZar, recurring: 0 };
  };
  const a = valueOf(first);
  // Expansion only on evidence of a second mapped opportunity, to a different service.
  const b = second && second.service?.key !== first?.service?.key ? valueOf(second) : { initial: 0, recurring: 0 };
  const expansion = b.initial + b.recurring;
  const value = a.initial + a.recurring + expansion;
  const priced = !!first?.service?.active && first.service.priceLowZar !== null;
  const capacityShare = i.capacity.required ? Math.min(1, i.capacity.markers.length / i.capacity.required) : 0;
  const components = {
    initialValueZar: a.initial,
    recurringValueZar: a.recurring,
    expansionPotentialZar: expansion,
    commercialValueZar: value,
    referencePriceZar: i.referencePriceZar,
  };
  if (!first) {
    return { value: 0, decay: 1, coverage: 0, recency: 0, verifiability: 0, explanation: "No opportunity, so no mapped service to value", inputs: { ...empty(), components } };
  }
  return {
    value: r3(i.referencePriceZar ? clamp(value / i.referencePriceZar) : 0),
    decay: 1,
    // The inputs it needs: a published price for the mapped service, and evidence the business operates at the scale to pay it.
    coverage: r3((priced ? 0.5 : 0) + 0.5 * capacityShare),
    recency: i.auditRecency ?? 1,
    verifiability: i.verifiability.INFERRED,
    explanation:
      `commercial_value R${value} = initial R${a.initial} + recurring R${a.recurring}/month + expansion R${expansion}` +
      `, read against R${i.referencePriceZar ?? "?"} (the highest published entry price); ` +
      `capacity evidence ${i.capacity.markers.length} of ${i.capacity.required} markers` +
      (priced ? "" : `; ${first.service?.key ?? "no service"} has no published price`),
    inputs: {
      ...empty(),
      opportunities: [first, second].filter((o): o is NonNullable<typeof o> => !!o).map((o) => o.id),
      findings: i.capacity.markers.map((m) => m.findingId),
      evidence: uniq(i.capacity.markers.flatMap((m) => m.evidenceIds)),
      components,
    },
  };
}

function contactability(i: ScoringInput): Partial {
  const c = i.contact;
  const verifiedChannel = c.channels.filter((x) => x.verification === "verified");
  const usable = verifiedChannel.length > 0 || c.observed.length > 0;
  const channelEvaluable = c.channels.length > 0 || c.observed.length > 0 || i.auditId !== null;
  const criteria: { name: string; evaluable: boolean; met: boolean }[] = [
    { name: "verified or site-published channel", evaluable: channelEvaluable, met: usable },
    { name: "named decision maker", evaluable: c.decisionMaker !== null, met: !!c.decisionMaker?.present },
    { name: "not suppressed", evaluable: c.suppressed !== null, met: c.suppressed === false },
  ];
  const evaluable = criteria.filter((x) => x.evaluable);
  if (!evaluable.length) return { value: 0, decay: 1, coverage: 0, recency: 0, verifiability: 0, explanation: "Nothing to evaluate: no channel on record and no audit", inputs: empty() };
  const claims: number[] = [];
  if (c.observed.length) claims.push(i.verifiability.VERIFIED);
  for (const x of verifiedChannel) claims.push(i.verifiability[x.claimType]);
  if (c.decisionMaker) claims.push(i.verifiability[c.decisionMaker.claimType]);
  const recencies = [...(c.observed.length ? [i.auditRecency ?? 0] : []), ...verifiedChannel.map((x) => x.recency)];
  return {
    value: r3(evaluable.filter((x) => x.met).length / evaluable.length),
    decay: 1,
    coverage: r3(evaluable.length / criteria.length),
    recency: r3(recencies.length ? Math.max(...recencies) : (i.auditRecency ?? 0)),
    verifiability: r3(claims.length ? Math.max(...claims) : i.verifiability.VERIFIED),
    explanation: criteria.map((x) => `${x.name}: ${x.evaluable ? (x.met ? "yes" : "no") : "not evaluable"}`).join("; "),
    inputs: {
      ...empty(),
      findings: c.observed.map((o) => o.findingId),
      channels: c.channels.map((x) => x.id),
      contacts: c.decisionMaker?.contactIds ?? [],
      evidence: uniq([...c.observed.flatMap((o) => o.evidenceIds), ...c.channels.map((x) => x.evidenceId)]),
    },
  };
}

/**
 * The share of the other dimensions backed by VERIFIED evidence, among those with any
 * evidence at all (coverage above zero).
 */
function evidenceQuality(i: ScoringInput, others: Record<Exclude<Dimension, "evidence_quality">, Partial>): Partial {
  const backed = Object.entries(others).filter(([, d]) => d.coverage > 0);
  if (!backed.length) return { value: 0, decay: 1, coverage: 0, recency: 0, verifiability: 0, explanation: "No dimension has any evidence", inputs: empty() };
  const verified = backed.filter(([, d]) => d.verifiability >= i.verifiability.VERIFIED);
  return {
    value: r3(verified.length / backed.length),
    decay: 1,
    coverage: 1,
    recency: 1,
    verifiability: i.verifiability.VERIFIED,
    explanation: `${verified.length} of ${backed.length} evidenced dimensions rest on VERIFIED evidence (${verified.map(([k]) => k).join(", ") || "none"})`,
    inputs: empty(),
  };
}

export function scoringRule(weights: Weights, params: ScoringParams): string {
  return (
    `${SCORING_RULE_VERSION}: Score = 100 × Σ w·s·k with weights ${DIMENSIONS.map((d) => `${d} ${weights[d]}`).join(", ")}; ` +
    `Confidence = Σ w·coverage·recency·verifiability / Σ w; severity weights ${JSON.stringify(params.severity_weights)}; segment fit values ${JSON.stringify(params.segment_fit_values)}`
  );
}

export function scoreLead(i: ScoringInput): ScoreResult {
  const others = {
    buying_signal: buyingSignal(i),
    icp_fit: icpFit(i),
    digital_opportunity: digitalOpportunity(i),
    service_fit: serviceFit(i),
    commercial_potential: commercialPotential(i),
    contactability: contactability(i),
  };
  const parts: Record<Dimension, Partial> = { ...others, evidence_quality: evidenceQuality(i, others) };
  const dimensions: DimensionScore[] = DIMENSIONS.map((d) => {
    const p = parts[d];
    const weight = i.weights[d];
    return { dimension: d, ...p, weight, contribution: r2(100 * weight * p.value * p.decay) };
  });
  const totalWeight = DIMENSIONS.reduce((a, d) => a + i.weights[d], 0);
  const axis = (which: "intent" | "opportunity") => {
    const ds = dimensions.filter((d) => AXIS[d.dimension] === which);
    const w = ds.reduce((a, d) => a + d.weight, 0);
    return w ? r2((100 * ds.reduce((a, d) => a + d.weight * d.value * d.decay, 0)) / w) : 0;
  };
  return {
    total: r2(dimensions.reduce((a, d) => a + d.contribution, 0)),
    opportunityAxis: axis("opportunity"),
    intentAxis: axis("intent"),
    confidence: r3(totalWeight ? dimensions.reduce((a, d) => a + d.weight * d.coverage * d.recency * d.verifiability, 0) / totalWeight : 0),
    dimensions,
    rule: scoringRule(i.weights, i.params),
  };
}

export type Treatment = "queue_for_review" | "needs_verification" | "reject" | "park";

/**
 * Phase 0, "How the two combine": both thresholds are set independently, and both must
 * pass. A high score with low confidence is a research task, never a contact.
 */
export function treatmentOf(score: number, confidence: number, thresholds: { score: number; confidence: number }): Treatment {
  const highScore = score >= thresholds.score;
  const highConfidence = confidence >= thresholds.confidence;
  if (highScore && highConfidence) return "queue_for_review";
  if (highScore) return "needs_verification";
  if (highConfidence) return "reject";
  return "park";
}

/**
 * Decay applies at read: a stored score's buying_signal decay recomputed from its signals'
 * strengths now. Everything else in the snapshot is unchanged.
 */
export function totalNow(dimensions: Pick<DimensionScore, "dimension" | "weight" | "value" | "decay">[], buyingSignalDecayNow: number | null): number {
  // Rounded per dimension, as the stored contributions are, so an undecayed score reads back unchanged.
  return r2(dimensions.reduce((a, d) => a + r2(100 * d.weight * d.value * (d.dimension === "buying_signal" && buyingSignalDecayNow !== null ? buyingSignalDecayNow : d.decay)), 0));
}
