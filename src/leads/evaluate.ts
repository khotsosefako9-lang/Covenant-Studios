// Evaluates a business's lead: brings signal detection and opportunity derivation up to
// date with the latest completed audit, fires code-detectable disqualifiers, runs the gate
// and records the result. Every step is idempotent, so evaluating is always safe and never
// reads stale opportunities: it derives them itself first.
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { capacityProfile } from "@/commercial/capacity";
import { deriveCompanyOpportunities } from "@/commercial/opportunities";
import { getCompanyOpportunities, inCompanyCluster } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";
import { companySignalView, detectSignalsForAudit, loadAuditSnapshot } from "@/signals/detect";
import type { FindingFact } from "@/signals/detectors";
import { type GateOutcome, evaluateGate } from "./gate";

type Db = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Lead = typeof s.leads.$inferSelect;

export const SYSTEM_ACTOR = "system";

async function setting<K extends "intent_gate" | "commercial_potential_floor_zar">(db: Db | Tx, key: K) {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, key));
  if (!row) throw new Error(`Setting ${key} is missing; run npm run db:setup`);
  return parseSetting(key, row.value);
}

export async function rootOf(db: Db | Tx, companyId: string): Promise<string> {
  const [r] = await db.select({ id: s.companyRoots.rootId }).from(s.companyRoots).where(eq(s.companyRoots.companyId, companyId));
  if (!r) throw new Error(`No company ${companyId}`);
  return r.id;
}

/** The identity cluster's open lead, if any. A cluster holds at most one (see src/leads/merge.ts). */
export async function findClusterLead(db: Db | Tx, companyId: string): Promise<Lead | null> {
  const rows = await db.select().from(s.leads).where(and(inCompanyCluster(s.leads.companyId, companyId), eq(s.leads.status, "open")));
  if (rows.length > 1) throw new Error(`Identity cluster of ${companyId} holds ${rows.length} open leads; resolve with the merge rule`);
  return rows[0] ?? null;
}

/** The cluster's open lead, created (on the root company, PENDING_EVALUATION) when there is none. */
export async function getOrCreateClusterLead(tx: Tx, companyId: string, now: Date): Promise<Lead> {
  const existing = await findClusterLead(tx, companyId);
  if (existing) return existing;
  const [lead] = await tx.insert(s.leads).values({ companyId: await rootOf(tx, companyId) }).returning();
  if (!lead) throw new Error("lead insert returned no row");
  await tx.insert(s.leadStateTransitions).values({
    leadId: lead.id,
    fromState: null,
    toState: lead.leadState,
    systemState: lead.systemLeadState,
    cause: "created",
    actor: SYSTEM_ACTOR,
    detail: "Lead opened for the business",
    occurredAt: now,
  });
  return lead;
}

async function latestAudits(db: Db, companyId: string) {
  const rows = await db
    .select({ id: s.audits.id, status: s.audits.status, completedAt: s.audits.completedAt, createdAt: s.audits.createdAt })
    .from(s.audits)
    .where(inCompanyCluster(s.audits.companyId, companyId))
    .orderBy(desc(s.audits.createdAt));
  const completed = rows.filter((a) => a.status === "COMPLETED" && a.completedAt).sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
  return { latest: rows[0] ? { id: rows[0].id, status: rows[0].status } : null, completedId: completed?.id ?? null };
}

/**
 * Code-detectable disqualifiers fire on the latest completed audit's evidence; those fired
 * on an older audit are retracted (they live and die with the audit, like friction
 * signals). Human-only disqualifiers have no detection check and cannot fire here; the
 * database refuses them without operator evidence regardless.
 */
async function applyDetectedDisqualifiers(tx: Tx, leadId: string, auditId: string | null, findings: readonly FindingFact[], minConfidence: number, now: Date) {
  const rules = await tx
    .select()
    .from(s.disqualifiers)
    .where(and(eq(s.disqualifiers.active, true), eq(s.disqualifiers.humanOnly, false), sql`${s.disqualifiers.detectionCheckKey} is not null`));
  const ref = auditId ? `@audit:${auditId}` : null;
  if (auditId && rules.length) {
    for (const d of rules) {
      const f = findings.find((x) => x.checkKey === d.detectionCheckKey && x.status === "PRESENT" && x.confidence >= minConfidence && x.evidenceIds.length);
      if (!f) continue;
      await tx
        .insert(s.leadDisqualifications)
        .values(f.evidenceIds.map((evidenceId) => ({ leadId, disqualifierId: d.id, evidenceId, recordedBy: `rule:${d.detectionCheckKey}${ref}` })))
        .onConflictDoNothing();
    }
  }
  // Retract rule-fired rows that the latest audit (or the current configuration) no longer supports.
  const stale = await tx
    .select({ id: s.leadDisqualifications.id, recordedBy: s.leadDisqualifications.recordedBy, disqualifierId: s.leadDisqualifications.disqualifierId })
    .from(s.leadDisqualifications)
    .where(and(eq(s.leadDisqualifications.leadId, leadId), isNull(s.leadDisqualifications.retractedAt), like(s.leadDisqualifications.recordedBy, "rule:%")));
  const live = new Set(rules.map((r) => `rule:${r.detectionCheckKey}${ref}`));
  const gone = stale.filter((r) => !ref || !live.has(r.recordedBy) || !rules.some((x) => x.id === r.disqualifierId));
  if (gone.length) {
    await tx
      .update(s.leadDisqualifications)
      .set({ retractedAt: now, retractedBy: SYSTEM_ACTOR, retractionReason: "The latest audit no longer evidences it" })
      .where(inArray(s.leadDisqualifications.id, gone.map((g) => g.id)));
  }
}

async function activeDisqualifications(tx: Tx, leadId: string) {
  return tx
    .select({ id: s.leadDisqualifications.id, disqualifierKey: s.disqualifiers.key, recordedBy: s.leadDisqualifications.recordedBy })
    .from(s.leadDisqualifications)
    .innerJoin(s.disqualifiers, eq(s.disqualifiers.id, s.leadDisqualifications.disqualifierId))
    .where(and(eq(s.leadDisqualifications.leadId, leadId), isNull(s.leadDisqualifications.retractedAt)));
}

export interface LeadEvaluation {
  leadId: string;
  evaluationId: string;
  previousState: string;
  state: string;
  systemState: string;
  overridden: boolean;
  outcome: GateOutcome;
  steps: { detection: string; derivation: string };
}

/**
 * Evaluates the identity cluster's lead now. Ordered: detect signals on the latest completed
 * audit → derive opportunities → fire detected disqualifiers → gate → record.
 */
export async function evaluateLead(db: Db, companyId: string, now = new Date()): Promise<LeadEvaluation> {
  const audits = await latestAudits(db, companyId);
  let detection = "no completed audit";
  if (audits.completedId) {
    const d = await detectSignalsForAudit(db, audits.completedId);
    detection = d.status === "abstained" ? `abstained: ${d.reason}` : `${d.created.length} created, ${d.existing} existing, ${d.retracted} retracted`;
  }
  const derived = await deriveCompanyOpportunities(db, companyId, now);
  const derivation = `${derived.status}: ${derived.derivation.opportunities.map((o) => o.typeKey).join(", ") || "none"}`;

  const gateParams = await setting(db, "intent_gate");
  const floorZar = await setting(db, "commercial_potential_floor_zar");
  const view = await companySignalView(db, companyId, now);
  const opportunities = await getCompanyOpportunities(db, companyId);
  const findings = audits.completedId ? ((await loadAuditSnapshot(db, audits.completedId))?.snapshot.findings ?? []) : [];
  const capacity = audits.completedId ? capacityProfile(findings) : null;

  return db.transaction(async (tx) => {
    const lead = await getOrCreateClusterLead(tx, companyId, now);
    await tx.select({ id: s.leads.id }).from(s.leads).where(eq(s.leads.id, lead.id)).for("update");
    await applyDetectedDisqualifiers(tx, lead.id, audits.completedId, findings, gateParams.min_disqualifier_confidence, now);

    const outcome = evaluateGate({
      latestAudit: audits.latest,
      completedAuditId: audits.completedId,
      intentSignals: view.signals
        .filter((x) => view.active.some((a) => a.id === x.id && a.axis === "intent"))
        .map((x) => ({ id: x.id, typeKey: x.typeKey, detectedBy: x.detectedBy, strengthNow: x.strengthNow, evidenceIds: view.active.find((a) => a.id === x.id)?.evidenceIds ?? [] })),
      weaknessSignals: view.active.filter((a) => a.axis === "opportunity" && a.strengthNow > 0).map((a) => ({ id: a.id, typeKey: a.typeKey })),
      opportunities: opportunities.map((o) => ({
        id: o.opportunity.id,
        rank: o.opportunity.rank,
        typeKey: o.typeKey,
        serviceKey: o.serviceKey,
        serviceUnit: o.serviceUnit,
        priceLowZar: o.priceLowZar,
      })),
      capacity,
      disqualifications: await activeDisqualifications(tx, lead.id),
      floorZar,
      params: gateParams,
    });

    const [evaluation] = await tx
      .insert(s.leadEvaluations)
      .values({
        leadId: lead.id,
        auditId: audits.completedId,
        evaluatedAt: now,
        systemState: outcome.systemState,
        gateStatus: outcome.gateStatus,
        gateBasis: outcome.gateBasis,
        commercialPotentialZar: outcome.commercialPotentialZar,
        rule: outcome.rule,
        reasons: outcome.reasons,
        detail: outcome.detail,
      })
      .returning({ id: s.leadEvaluations.id });
    if (!evaluation) throw new Error("evaluation insert returned no row");

    const [current] = await tx.select().from(s.leads).where(eq(s.leads.id, lead.id));
    if (!current) throw new Error("lead vanished");
    const gateOverridden = current.intentGateBasis === "human_override";
    const effectiveState = current.stateOverride ?? outcome.systemState;
    await tx
      .update(s.leads)
      .set({
        systemLeadState: outcome.systemState,
        systemGateStatus: outcome.gateStatus,
        systemGateBasis: outcome.gateBasis,
        leadState: effectiveState,
        ...(gateOverridden
          ? {}
          : {
              intentGateStatus: outcome.gateStatus,
              intentGateBasis: outcome.gateBasis,
              intentGateEvaluatedAt: outcome.gateStatus === "NOT_EVALUATED" ? null : now,
            }),
        lastEvaluationId: evaluation.id,
        updatedAt: now,
      })
      .where(eq(s.leads.id, lead.id));
    if (effectiveState !== current.leadState) {
      await tx.insert(s.leadStateTransitions).values({
        leadId: lead.id,
        fromState: current.leadState,
        toState: effectiveState,
        systemState: outcome.systemState,
        cause: "evaluation",
        evaluationId: evaluation.id,
        actor: SYSTEM_ACTOR,
        detail: outcome.reasons.join("; "),
        occurredAt: now,
      });
    }
    return {
      leadId: lead.id,
      evaluationId: evaluation.id,
      previousState: current.leadState,
      state: effectiveState,
      systemState: outcome.systemState,
      overridden: current.stateOverride !== null,
      outcome,
      steps: { detection, derivation },
    };
  });
}
