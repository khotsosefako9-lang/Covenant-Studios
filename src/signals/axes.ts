// Which axis each active signal counts on. Pure. A signal counts on its type's axis and
// nowhere else. web_underperformance is Opportunity only, always (Phase 9 correction): no
// other signal can carry it onto Intent. The database enforces that its axis stays
// 'opportunity' (signal_types_web_underperformance_opportunity).

export interface ActiveSignal {
  id: string;
  typeKey: string;
  axis: "intent" | "opportunity";
  /** Strength decayed to "now" (src/core/freshness.ts). */
  strengthNow: number;
  evidenceIds: string[];
}

export interface Contribution {
  signalId: string;
  typeKey: string;
  strength: number;
  evidenceIds: string[];
}

export function axisContributions(signals: ActiveSignal[]): { opportunity: Contribution[]; intent: Contribution[] } {
  const opportunity: Contribution[] = [];
  const intent: Contribution[] = [];
  for (const s of signals) {
    if (!(s.strengthNow > 0) || !s.evidenceIds.length) continue;
    const c = { signalId: s.id, typeKey: s.typeKey, strength: s.strengthNow, evidenceIds: s.evidenceIds };
    (s.axis === "intent" ? intent : opportunity).push(c);
  }
  return { opportunity, intent };
}
