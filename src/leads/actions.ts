// Human decisions on a lead. Each needs an actor and a reason, keeps the system's own value
// beside the human one, and is recorded as a state transition where the state changes.
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "@/db/schema/index";
import { type LeadEvaluation, evaluateLead, findClusterLead, getOrCreateClusterLead } from "./evaluate";

type Db = NodePgDatabase<typeof s>;
type State = (typeof s.leadState.enumValues)[number];

export class LeadActionError extends Error {}

function required(actor: string, reason: string) {
  if (!actor.trim()) throw new LeadActionError("An operator name is required");
  if (!reason.trim()) throw new LeadActionError("A reason is required");
}

async function openLead(db: Db, companyId: string) {
  const lead = await findClusterLead(db, companyId);
  if (!lead) throw new LeadActionError(`No open lead for ${companyId}; run the pipeline first`);
  return lead;
}

/**
 * Sets the effective state by hand. The system's state stays in system_lead_state and keeps
 * being recomputed; the override wins until cleared. Overriding to COMMERCIAL_OPPORTUNITY
 * also passes the intent gate by human override, with the same actor and reason.
 * OUTREACH_READY is refused: it needs a human YES review judgement (Phase 13).
 */
export async function overrideLeadState(db: Db, args: { companyId: string; state: State; actor: string; reason: string; now?: Date }) {
  required(args.actor, args.reason);
  if (args.state === "OUTREACH_READY") {
    throw new LeadActionError("OUTREACH_READY needs a human YES review judgement, which arrives in Phase 13; it cannot be set by override");
  }
  const now = args.now ?? new Date();
  const lead = await openLead(db, args.companyId);
  const actor = args.actor.trim();
  const reason = args.reason.trim();
  return db.transaction(async (tx) => {
    const gate =
      args.state === "COMMERCIAL_OPPORTUNITY" && lead.intentGateStatus !== "PASSED"
        ? { intentGateStatus: "PASSED" as const, intentGateBasis: "human_override" as const, intentGateEvaluatedAt: now, intentGateOverrideBy: actor, intentGateOverrideReason: reason }
        : {};
    await tx
      .update(s.leads)
      .set({ stateOverride: args.state, stateOverrideBy: actor, stateOverrideReason: reason, stateOverrideAt: now, leadState: args.state, ...gate, updatedAt: now })
      .where(eq(s.leads.id, lead.id));
    await tx.insert(s.leadStateTransitions).values({
      leadId: lead.id,
      fromState: lead.leadState,
      toState: args.state,
      systemState: lead.systemLeadState,
      cause: "human_override",
      actor,
      detail: reason,
      occurredAt: now,
    });
    return { leadId: lead.id, from: lead.leadState, to: args.state, systemState: lead.systemLeadState };
  });
}

/** Removes a human override: the effective state and gate return to the system's. */
export async function clearLeadOverride(db: Db, args: { companyId: string; actor: string; reason: string; now?: Date }) {
  required(args.actor, args.reason);
  const now = args.now ?? new Date();
  const lead = await openLead(db, args.companyId);
  if (!lead.stateOverride && lead.intentGateBasis !== "human_override") throw new LeadActionError("The lead has no override to clear");
  return db.transaction(async (tx) => {
    await tx
      .update(s.leads)
      .set({
        stateOverride: null,
        stateOverrideBy: null,
        stateOverrideReason: null,
        stateOverrideAt: null,
        leadState: lead.systemLeadState,
        intentGateStatus: lead.systemGateStatus,
        intentGateBasis: lead.systemGateBasis,
        intentGateEvaluatedAt: lead.systemGateStatus === "NOT_EVALUATED" ? null : (lead.intentGateEvaluatedAt ?? now),
        intentGateOverrideBy: null,
        intentGateOverrideReason: null,
        updatedAt: now,
      })
      .where(eq(s.leads.id, lead.id));
    await tx.insert(s.leadStateTransitions).values({
      leadId: lead.id,
      fromState: lead.leadState,
      toState: lead.systemLeadState,
      systemState: lead.systemLeadState,
      cause: "override_cleared",
      actor: args.actor.trim(),
      detail: args.reason.trim(),
      occurredAt: now,
    });
    return { leadId: lead.id, from: lead.leadState, to: lead.systemLeadState };
  });
}

/**
 * Channel suitability is not disqualification: a business can be a genuine fit and still be
 * unsuitable for cold outreach (benchmark category 15). It never changes the lead state; it
 * only blocks OUTREACH_READY when disallowed.
 */
export async function setChannelSuitability(
  db: Db,
  args: { companyId: string; value: (typeof s.channelSuitability.enumValues)[number]; actor: string; reason: string; now?: Date },
) {
  required(args.actor, args.reason);
  const lead = await openLead(db, args.companyId);
  await db
    .update(s.leads)
    .set({
      outreachChannelSuitability: args.value,
      channelSuitabilityReason: args.reason.trim(),
      channelSuitabilitySetBy: args.actor.trim(),
      channelSuitabilitySetAt: args.now ?? new Date(),
    })
    .where(eq(s.leads.id, lead.id));
  return { leadId: lead.id, value: args.value };
}

/**
 * An operator records a disqualifier they have grounds for. The statement becomes REPORTED
 * operator evidence (the only evidence a human-only disqualifier accepts), and the lead is
 * re-evaluated at once.
 */
export async function recordOperatorDisqualification(
  db: Db,
  args: { companyId: string; disqualifierKey: string; basis: string; actor: string; now?: Date },
): Promise<{ disqualificationId: string; evaluation: LeadEvaluation }> {
  required(args.actor, args.basis);
  const now = args.now ?? new Date();
  const [d] = await db.select().from(s.disqualifiers).where(eq(s.disqualifiers.key, args.disqualifierKey));
  if (!d || !d.active) throw new LeadActionError(`No active disqualifier ${args.disqualifierKey}`);
  const id = await db.transaction(async (tx) => {
    const lead = await getOrCreateClusterLead(tx, args.companyId, now);
    const [source] = await tx.select({ id: s.sources.id }).from(s.sources).where(eq(s.sources.key, "human_operator"));
    if (!source) throw new Error("Source human_operator is missing; run npm run db:setup");
    const statement = JSON.stringify({ disqualifier: d.key, basis: args.basis.trim() });
    const [rec] = await tx
      .insert(s.sourceRecords)
      .values({
        sourceId: source.id,
        companyId: lead.companyId,
        retrievalMethod: "operator_statement",
        fetchedAt: now,
        fetchOutcome: "NOT_APPLICABLE",
        rawContent: statement,
        contentHash: createHash("sha256").update(statement).digest("hex"),
        attributedTo: args.actor.trim(),
      })
      .returning({ id: s.sourceRecords.id });
    const [ev] = await tx
      .insert(s.evidence)
      .values({
        companyId: lead.companyId,
        sourceRecordId: rec?.id as string,
        producer: "operator",
        claimKey: `disqualifier.${d.key}`,
        claim: `Operator reports ${d.name}`,
        claimType: "REPORTED",
        value: args.basis.trim(),
        observedAt: now,
      })
      .returning({ id: s.evidence.id });
    const [row] = await tx
      .insert(s.leadDisqualifications)
      .values({ leadId: lead.id, disqualifierId: d.id, evidenceId: ev?.id as string, recordedBy: `operator:${args.actor.trim()}` })
      .returning({ id: s.leadDisqualifications.id });
    return row?.id as string;
  });
  return { disqualificationId: id, evaluation: await evaluateLead(db, args.companyId, now) };
}

/** Lifts a disqualification (operator-recorded or rule-fired) with a reason, then re-evaluates. Kept as history. */
export async function liftDisqualification(db: Db, args: { disqualificationId: string; actor: string; reason: string; now?: Date }) {
  required(args.actor, args.reason);
  const now = args.now ?? new Date();
  const [row] = await db
    .update(s.leadDisqualifications)
    .set({ retractedAt: now, retractedBy: args.actor.trim(), retractionReason: args.reason.trim() })
    .where(and(eq(s.leadDisqualifications.id, args.disqualificationId), isNull(s.leadDisqualifications.retractedAt)))
    .returning({ leadId: s.leadDisqualifications.leadId });
  if (!row) throw new LeadActionError(`No active disqualification ${args.disqualificationId}`);
  const [lead] = await db.select({ companyId: s.leads.companyId }).from(s.leads).where(eq(s.leads.id, row.leadId));
  return evaluateLead(db, lead?.companyId as string, now);
}

/**
 * Segment fit is an operator judgement (Phase 11): ICP criteria are not configured for
 * automatic matching, so icp_fit can only be evaluated once someone assigns it. Re-evaluates
 * the lead at once so the score reflects it.
 */
export async function setSegmentFit(
  db: Db,
  args: { companyId: string; fit: "fit" | "potentially_valid" | "not_fit"; segmentKey?: string; actor: string; reason: string; now?: Date },
): Promise<LeadEvaluation> {
  required(args.actor, args.reason);
  const now = args.now ?? new Date();
  let segmentId: string | null = null;
  if (args.segmentKey) {
    const [seg] = await db.select({ id: s.icpSegments.id }).from(s.icpSegments).where(eq(s.icpSegments.key, args.segmentKey));
    if (!seg) throw new LeadActionError(`No ICP segment ${args.segmentKey}`);
    segmentId = seg.id;
  }
  await db.transaction(async (tx) => {
    const lead = await getOrCreateClusterLead(tx, args.companyId, now);
    await tx
      .update(s.leads)
      .set({ segmentFit: args.fit, icpSegmentId: segmentId ?? lead.icpSegmentId, segmentFitSetBy: args.actor.trim(), segmentFitSetAt: now, segmentFitReason: args.reason.trim() })
      .where(eq(s.leads.id, lead.id));
  });
  return evaluateLead(db, args.companyId, now);
}
