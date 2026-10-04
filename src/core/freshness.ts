// Freshness and decay, computed at read time from when something was observed. Nothing
// here is stored: a stored "fresh" flag goes stale silently, a computed one cannot.
// Pure: no I/O. Windows come from the freshness_refresh_days setting (Phase 0).

export type DataClass = "website_audit" | "contact_channel" | "company_profile";

export type RefreshWindows = Record<DataClass, number>;

const DAY_MS = 24 * 3600 * 1000;

/** Which refresh window an evidence claim falls under, by its claim key. */
export function dataClassOf(claimKey: string): DataClass {
  if (claimKey.startsWith("audit.")) return "website_audit";
  if (claimKey === "company.phone" || claimKey === "company.email" || claimKey.startsWith("contact.")) return "contact_channel";
  return "company_profile";
}

export interface Freshness {
  dataClass: DataClass;
  state: "fresh" | "stale";
  ageDays: number;
  windowDays: number;
  /** When it stops being fresh. */
  freshUntil: Date;
  /**
   * Phase 0 recency factor for confidence: 1.0 inside the window, falling linearly to
   * `floor` at twice the window, and staying there.
   */
  recency: number;
}

/**
 * Freshness of an observation. `lastVerifiedAt`, when later than `observedAt`, restarts the
 * clock: re-confirming a fact makes it fresh again without rewriting the evidence.
 */
export function freshness(args: {
  dataClass: DataClass;
  observedAt: Date;
  lastVerifiedAt?: Date | null;
  now: Date;
  windows: RefreshWindows;
  recencyFloor: number;
}): Freshness {
  const basis = args.lastVerifiedAt && args.lastVerifiedAt > args.observedAt ? args.lastVerifiedAt : args.observedAt;
  const windowDays = args.windows[args.dataClass];
  const ageDays = Math.max(0, (args.now.getTime() - basis.getTime()) / DAY_MS);
  const over = ageDays / windowDays;
  const recency = over <= 1 ? 1 : over >= 2 ? args.recencyFloor : 1 - (1 - args.recencyFloor) * (over - 1);
  return {
    dataClass: args.dataClass,
    state: ageDays <= windowDays ? "fresh" : "stale",
    ageDays: Math.round(ageDays * 10) / 10,
    windowDays,
    freshUntil: new Date(basis.getTime() + windowDays * DAY_MS),
    recency: Math.round(recency * 1000) / 1000,
  };
}

/**
 * A signal's strength now: linear decay from its observed strength to zero over the
 * signal type's decay window (Phase 0). Null decay = does not decay.
 */
export function decayedStrength(args: { strength: number; observedAt: Date; decayDays: number | null; now: Date }): number {
  if (args.decayDays === null) return args.strength;
  const ageDays = Math.max(0, (args.now.getTime() - args.observedAt.getTime()) / DAY_MS);
  const factor = Math.max(0, 1 - ageDays / args.decayDays);
  return Math.round(args.strength * factor * 1000) / 1000;
}
