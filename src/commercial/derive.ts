// Opportunity derivation: finding → signal → opportunity type → Covenant service. Pure.
// Reads only the configuration Phase 2 built (signal_type_opportunity_types,
// opportunity_type_services) and the company's active signals; writes nothing.
//
// The rule is consolidation, not enumeration: a company does not get one opportunity per
// weakness. Types are chosen greedily by how strongly the not-yet-explained signals point at
// them; once a type is chosen, every signal that maps to it is explained by it, and so is any
// signal whose evidence it already rests on. A further opportunity is produced only from
// signals that nothing chosen so far explains. If the evidence supports one opportunity,
// the result is one.

export const INFERENCE_RULE_VERSION = "opportunity-derivation/1";

export interface SupportSignal {
  id: string;
  typeKey: string;
  detectedBy: "rule" | "operator";
  /** Strength decayed to the derivation time. */
  strengthNow: number;
  evidenceIds: string[];
  findingIds: string[];
  /**
   * How far the signal's basis can be trusted, 0–1: for a rule signal, the mean confidence
   * of the audit findings it rests on; for an operator signal, the REPORTED verifiability.
   */
  basisConfidence: number;
}

export interface DerivationParams {
  secondary_mapping_weight: number;
  min_relevance: number;
  max_opportunities: number;
}

export interface DerivationConfig {
  /** signal type → opportunity types it points to, with preference (1 = most direct). */
  mappings: Readonly<Record<string, readonly { typeKey: string; preference: number }[]>>;
  /** opportunity type → active services, in preference order. */
  services: Readonly<Record<string, readonly { serviceKey: string; serviceName: string }[]>>;
  params: DerivationParams;
  /** confidence_verifiability.INFERRED (Phase 0). */
  inferredVerifiability: number;
}

export interface DerivedOpportunity {
  rank: number;
  typeKey: string;
  /** First-preference service for the type; null when the type has no active service. */
  serviceKey: string | null;
  relevance: number;
  confidence: number;
  /** The signals the opportunity rests on (each signal rests on exactly one opportunity). */
  signals: SupportSignal[];
  findingIds: string[];
  evidenceIds: string[];
  /** Signals explained because their evidence is already behind this opportunity. */
  alsoCovers: string[];
  /** Other types its signals point to that were not produced separately. */
  alsoConsistentWith: string[];
  rationale: string;
}

export interface Derivation {
  opportunities: DerivedOpportunity[];
  /** Live signals whose type maps to no opportunity type (e.g. agency_fatigue). */
  unmapped: string[];
  /** Types considered and not produced because their relevance was below min_relevance. */
  belowThreshold: { typeKey: string; relevance: number }[];
  inferenceRule: string;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const noisyOr = (xs: number[]) => 1 - xs.reduce((acc, x) => acc * (1 - x), 1);

export function inferenceRule(p: DerivationParams, inferredVerifiability: number): string {
  return (
    `${INFERENCE_RULE_VERSION}: relevance = 1 − ∏(1 − strength × ${p.secondary_mapping_weight}^(preference − 1)) over signals not yet explained; ` +
    `greedy by relevance, a chosen type explains every signal mapped to it and every signal whose evidence it rests on; ` +
    `min relevance ${p.min_relevance}, at most ${p.max_opportunities}; ` +
    `confidence = INFERRED ${inferredVerifiability} × strength-weighted basis confidence; service = the type's first-preference active service`
  );
}

export function deriveOpportunities(signals: readonly SupportSignal[], config: DerivationConfig): Derivation {
  const { params: p } = config;
  const live = signals.filter((s) => s.strengthNow > 0 && s.evidenceIds.length > 0);
  const unmapped = [...new Set(live.filter((s) => !(config.mappings[s.typeKey] ?? []).length).map((s) => s.typeKey))].sort();
  const open = new Set(live.filter((s) => (config.mappings[s.typeKey] ?? []).length).map((s) => s.id));
  const covered = new Set<string>();
  const chosen = new Set<string>();
  const out: DerivedOpportunity[] = [];
  const below = new Map<string, number>();

  while (out.length < p.max_opportunities && open.size) {
    const support = new Map<string, { s: SupportSignal; weight: number }[]>();
    for (const s of live) {
      if (!open.has(s.id)) continue;
      for (const m of config.mappings[s.typeKey] ?? []) {
        if (chosen.has(m.typeKey)) continue;
        const list = support.get(m.typeKey) ?? [];
        list.push({ s, weight: p.secondary_mapping_weight ** (m.preference - 1) });
        support.set(m.typeKey, list);
      }
    }
    const ranked = [...support.entries()]
      .map(([typeKey, list]) => ({ typeKey, list, relevance: round(noisyOr(list.map((x) => x.s.strengthNow * x.weight))) }))
      .sort((a, b) => b.relevance - a.relevance || b.list.length - a.list.length || a.typeKey.localeCompare(b.typeKey));
    const best = ranked[0];
    if (!best) break;
    if (best.relevance < p.min_relevance) {
      for (const r of ranked) below.set(r.typeKey, Math.max(below.get(r.typeKey) ?? 0, r.relevance));
      break;
    }

    chosen.add(best.typeKey);
    const resting = best.list.map((x) => x.s);
    for (const s of resting) {
      open.delete(s.id);
      for (const e of s.evidenceIds) covered.add(e);
    }
    // A signal whose every piece of evidence is already behind this opportunity adds nothing new.
    const absorbed = live.filter((s) => open.has(s.id) && s.evidenceIds.every((e) => covered.has(e)));
    for (const s of absorbed) open.delete(s.id);

    const weightOf = new Map(best.list.map((x) => [x.s.id, x.s.strengthNow * x.weight]));
    const totalWeight = [...weightOf.values()].reduce((a, b) => a + b, 0);
    const basis = resting.reduce((acc, s) => acc + (weightOf.get(s.id) ?? 0) * s.basisConfidence, 0) / (totalWeight || 1);
    const service = config.services[best.typeKey]?.[0] ?? null;
    const alsoConsistentWith = [...new Set(resting.flatMap((s) => (config.mappings[s.typeKey] ?? []).map((m) => m.typeKey)))]
      .filter((t) => t !== best.typeKey)
      .sort();
    const alsoCovers = [...new Set(absorbed.map((s) => s.typeKey))].sort();

    const parts = [
      `Rests on ${resting.map((s) => `${s.typeKey} (${s.detectedBy}, strength ${round(s.strengthNow)})`).join(", ")}.`,
      alsoCovers.length ? `Also explains ${alsoCovers.join(", ")}, whose evidence it already rests on.` : "",
      alsoConsistentWith.length ? `The same signals also point to ${alsoConsistentWith.join(", ")}; not produced separately.` : "",
      service ? `Service: ${service.serviceName} (first preference for ${best.typeKey}).` : `No active service is mapped to ${best.typeKey}.`,
    ];
    out.push({
      rank: out.length + 1,
      typeKey: best.typeKey,
      serviceKey: service?.serviceKey ?? null,
      relevance: best.relevance,
      confidence: round(config.inferredVerifiability * basis),
      signals: resting,
      findingIds: [...new Set(resting.flatMap((s) => s.findingIds))],
      evidenceIds: [...new Set(resting.flatMap((s) => s.evidenceIds))],
      alsoCovers,
      alsoConsistentWith,
      rationale: parts.filter(Boolean).join(" "),
    });
  }

  return {
    opportunities: out,
    unmapped,
    belowThreshold: [...below.entries()].map(([typeKey, relevance]) => ({ typeKey, relevance })).sort((a, b) => b.relevance - a.relevance),
    inferenceRule: inferenceRule(p, config.inferredVerifiability),
  };
}
