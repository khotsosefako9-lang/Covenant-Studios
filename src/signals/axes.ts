// Which axis each active signal counts on. Pure. The one subtle rule (Phase 0):
// web_underperformance counts on Opportunity always, and on Intent only when an
// independent commercial signal is present - and never from the same evidence on both axes.

export interface ActiveSignal {
  id: string;
  typeKey: string;
  axis: "intent" | "opportunity";
  /** Strength decayed to "now" (src/core/freshness.ts). */
  strengthNow: number;
  evidenceIds: string[];
  /** signal_types.intent_requires_independent_signal (web_underperformance). */
  intentRequiresIndependentSignal: boolean;
}

export interface Contribution {
  signalId: string;
  typeKey: string;
  strength: number;
  evidenceIds: string[];
  basis: string;
  /** For a corroborated intent contribution: the independent signal that makes it intent. */
  corroboratedBy?: string;
}

export function axisContributions(signals: ActiveSignal[]): { opportunity: Contribution[]; intent: Contribution[] } {
  const live = signals.filter((s) => s.strengthNow > 0 && s.evidenceIds.length > 0);
  const opportunity: Contribution[] = [];
  const intent: Contribution[] = [];
  for (const s of live) {
    const c = { signalId: s.id, typeKey: s.typeKey, strength: s.strengthNow, evidenceIds: s.evidenceIds, basis: "own evidence" };
    (s.axis === "intent" ? intent : opportunity).push(c);
  }

  for (const w of live.filter((s) => s.intentRequiresIndependentSignal)) {
    const own = new Set(w.evidenceIds);
    // Independent = a different intent-axis signal resting on none of the same evidence.
    const independent = live
      .filter((s) => s.id !== w.id && s.axis === "intent" && s.evidenceIds.every((id) => !own.has(id)))
      .sort((a, b) => b.strengthNow - a.strengthNow)[0];
    if (!independent) continue;
    // The intent credit rests on the independent signal's evidence, never on the weakness
    // evidence already counted on the Opportunity axis.
    intent.push({
      signalId: w.id,
      typeKey: w.typeKey,
      strength: Math.min(w.strengthNow, independent.strengthNow),
      evidenceIds: independent.evidenceIds,
      basis: `web weakness corroborated by independent ${independent.typeKey}`,
      corroboratedBy: independent.id,
    });
  }
  return { opportunity, intent };
}
