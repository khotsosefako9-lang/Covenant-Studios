// Loads a lead's scoring inputs from stored evidence and configuration, runs the pure
// scoring function (src/core/scoring.ts) and stores the result as an immutable snapshot:
// scores + score_dimensions + score_dimension_evidence, recording the weight set, the audit
// it was computed against, the rule and every parameter. Decay is applied at read.
import { desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { capacityProfile } from "@/commercial/capacity";
import { dataClassOf, freshness } from "@/core/freshness";
import { type ClaimType, type ScoreResult, type ScoringInput, type ScoringParams, type Treatment, type Weights, scoreLead, treatmentOf } from "@/core/scoring";
import { getCompanyOpportunities, getCompanySignalsNow, inCompanyCluster } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";
import { loadFreshnessConfig } from "@/provenance/chain";
import { DETECTORS, type FindingFact } from "@/signals/detectors";

type Db = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function setting<K extends Parameters<typeof parseSetting>[0]>(db: Db, key: K) {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, key));
  if (!row) throw new Error(`Setting ${key} is missing; run npm run db:setup`);
  return parseSetting(key, row.value);
}

/** Sites where the audit observes a usable channel when the check PASSes. */
const OBSERVED_CHANNEL_CHECKS = ["conv.contact_path", "conv.click_to_call", "conv.enquiry_form"];

export interface ScoringContext {
  input: ScoringInput;
  weightSetId: string;
  thresholds: { score: number | null; confidence: number | null };
  params: Record<string, unknown>;
}

export async function loadScoringContext(
  db: Db,
  args: { companyId: string; lead: typeof s.leads.$inferSelect; auditId: string | null; findings: readonly FindingFact[]; now: Date },
): Promise<ScoringContext> {
  const { companyId, lead, auditId, findings, now } = args;
  const [ws] = await db.select().from(s.weightSets).where(eq(s.weightSets.isActive, true)).orderBy(desc(s.weightSets.version)).limit(1);
  if (!ws) throw new Error("No active weight set; run npm run db:setup");
  const weights: Weights = {
    buying_signal: Number(ws.buyingSignal),
    icp_fit: Number(ws.icpFit),
    digital_opportunity: Number(ws.digitalOpportunity),
    service_fit: Number(ws.serviceFit),
    commercial_potential: Number(ws.commercialPotential),
    contactability: Number(ws.contactability),
    evidence_quality: Number(ws.evidenceQuality),
  };
  const scoring = (await setting(db, "scoring")) as ScoringParams;
  const verifiability = (await setting(db, "confidence_verifiability")) as Record<ClaimType, number>;
  const gate = await setting(db, "intent_gate");
  const fresh = await loadFreshnessConfig(db);
  const recency = (claimKey: string, observedAt: Date, lastVerifiedAt?: Date | null) =>
    freshness({ dataClass: dataClassOf(claimKey), observedAt, lastVerifiedAt, now, windows: fresh.windows, recencyFloor: fresh.recencyFloor }).recency;

  // The audit's own recency: when its page was retrieved.
  let auditRecency: number | null = null;
  if (auditId) {
    const [a] = await db
      .select({ fetchedAt: s.sourceRecords.fetchedAt })
      .from(s.audits)
      .innerJoin(s.sourceRecords, eq(s.sourceRecords.id, s.audits.pageSourceRecordId))
      .where(eq(s.audits.id, auditId));
    auditRecency = a ? recency("audit.page", a.fetchedAt) : null;
  }

  // Intent signals, with the claim type and recency of the evidence they rest on.
  const types = await db.select().from(s.signalTypes).where(eq(s.signalTypes.active, true));
  const intentKeys = new Set(types.filter((t) => t.axis === "intent").map((t) => t.key));
  const signals = (await getCompanySignalsNow(db, companyId, now)).filter((x) => intentKeys.has(x.typeKey) && x.strengthNow > 0);
  const sigEvidence = signals.length
    ? await db
        .select({ signalId: s.signalEvidence.signalId, evidenceId: s.evidence.id, claimType: s.evidence.claimType, claimKey: s.evidence.claimKey, observedAt: s.evidence.observedAt })
        .from(s.signalEvidence)
        .innerJoin(s.evidence, eq(s.evidence.id, s.signalEvidence.evidenceId))
        .where(inArray(s.signalEvidence.signalId, signals.map((x) => x.id)))
    : [];
  const sigFindings = signals.length
    ? await db.select().from(s.signalFindings).where(inArray(s.signalFindings.signalId, signals.map((x) => x.id)))
    : [];
  const RANK: Record<ClaimType, number> = { UNKNOWN: 0, INFERRED: 1, REPORTED: 2, VERIFIED: 3 };
  const intentSignals = signals.map((x) => {
    const ev = sigEvidence.filter((e) => e.signalId === x.id);
    // A claim is only as verifiable as the least verifiable evidence it rests on.
    const claimType = ev.reduce<ClaimType>((acc, e) => (RANK[e.claimType] < RANK[acc] ? e.claimType : acc), "VERIFIED");
    const newest = ev.sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())[0];
    return {
      id: x.id,
      typeKey: x.typeKey,
      strength: Number(x.strength),
      strengthNow: x.strengthNow,
      claimType,
      recency: newest ? recency(newest.claimKey, newest.observedAt) : 0,
      evidenceIds: ev.map((e) => e.evidenceId),
      findingIds: sigFindings.filter((f) => f.signalId === x.id).map((f) => f.auditFindingId),
    };
  });
  const detectable = DETECTORS.filter((d) => intentKeys.has(d.typeKey)).length;

  // Current opportunities, their services and the FAIL findings beneath them.
  const ops = await getCompanyOpportunities(db, companyId);
  const services = await db.select().from(s.covenantServices);
  const opIds = ops.map((o) => o.opportunity.id);
  const opFindings = opIds.length
    ? await db
        .select({ opportunityId: s.opportunityFindings.opportunityId, id: s.auditFindings.id, checkKey: s.auditFindings.checkKey, status: s.auditFindings.status, severity: s.auditFindings.severity, confidence: s.auditFindings.confidence })
        .from(s.opportunityFindings)
        .innerJoin(s.auditFindings, eq(s.auditFindings.id, s.opportunityFindings.auditFindingId))
        .where(inArray(s.opportunityFindings.opportunityId, opIds))
    : [];
  const findingEvidence = opFindings.length
    ? await db.select().from(s.auditFindingEvidence).where(inArray(s.auditFindingEvidence.auditFindingId, opFindings.map((f) => f.id)))
    : [];
  const opSignals = opIds.length ? await db.select().from(s.opportunitySignals).where(inArray(s.opportunitySignals.opportunityId, opIds)) : [];
  const opportunities = ops.map((o) => {
    const svc = services.find((x) => x.id === o.opportunity.covenantServiceId);
    return {
      id: o.opportunity.id,
      rank: o.opportunity.rank,
      typeKey: o.typeKey,
      relevance: Number(o.opportunity.relevance ?? 0),
      service: svc ? { key: svc.key, active: svc.active, unit: svc.unit, priceLowZar: svc.priceLowZar } : null,
      failFindings: opFindings
        .filter((f) => f.opportunityId === o.opportunity.id && f.status === "FAIL" && f.severity)
        .map((f) => ({
          id: f.id,
          checkKey: f.checkKey,
          severity: f.severity as string,
          confidence: Number(f.confidence),
          evidenceIds: findingEvidence.filter((e) => e.auditFindingId === f.id).map((e) => e.evidenceId),
        })),
      signalIds: opSignals.filter((x) => x.opportunityId === o.opportunity.id).map((x) => x.signalId),
    };
  });
  const prices = services.filter((x) => x.active && x.priceLowZar !== null).map((x) => x.priceLowZar as number);

  const profile = capacityProfile(findings);
  const markers = profile.present.filter((m) => m.confidence >= gate.min_capacity_confidence);

  // Segment fit: an operator's judgement, or not evaluable.
  let segment: ScoringInput["segment"] = null;
  if (lead.segmentFit !== "unknown" && lead.segmentFitSetAt) {
    const [seg] = lead.icpSegmentId ? await db.select({ key: s.icpSegments.key }).from(s.icpSegments).where(eq(s.icpSegments.id, lead.icpSegmentId)) : [];
    segment = { fit: lead.segmentFit, segmentKey: seg?.key ?? null, recency: recency("company.segment", lead.segmentFitSetAt) };
  }

  // Contactability.
  const channels = await db
    .select({ id: s.contactChannels.id, kind: s.contactChannels.kind, verification: s.contactChannels.verification, lastVerifiedAt: s.contactChannels.lastVerifiedAt, evidenceId: s.evidence.id, claimType: s.evidence.claimType, claimKey: s.evidence.claimKey, observedAt: s.evidence.observedAt })
    .from(s.contactChannels)
    .innerJoin(s.evidence, eq(s.evidence.id, s.contactChannels.evidenceId))
    .where(inCompanyCluster(s.contactChannels.companyId, companyId));
  const contacts = await db
    .select({ id: s.contacts.id, isDecisionMaker: s.contacts.isDecisionMaker, claimType: s.evidence.claimType })
    .from(s.contacts)
    .innerJoin(s.evidence, eq(s.evidence.id, s.contacts.evidenceId))
    .where(inCompanyCluster(s.contacts.companyId, companyId));
  const observed = findings
    .filter((f) => OBSERVED_CHANNEL_CHECKS.includes(f.checkKey) && f.status === "PASS" && f.evidenceIds.length)
    .map((f) => ({ findingId: f.id, checkKey: f.checkKey, evidenceIds: f.evidenceIds }));

  const input: ScoringInput = {
    now,
    weights,
    params: scoring,
    verifiability,
    auditRecency,
    auditId,
    intentSignals,
    intentTypes: { detectable, total: intentKeys.size },
    opportunities,
    referencePriceZar: prices.length ? Math.max(...prices) : null,
    capacity: { markers: markers.map((m) => ({ checkKey: m.checkKey, findingId: m.findingId, evidenceIds: m.evidenceIds })), required: gate.min_capacity_markers },
    segment,
    contact: {
      channels: channels.map((c) => ({ id: c.id, kind: c.kind, verification: c.verification, claimType: c.claimType, recency: recency(c.claimKey, c.observedAt, c.lastVerifiedAt), evidenceId: c.evidenceId })),
      observed,
      decisionMaker: contacts.length
        ? { contactIds: contacts.map((c) => c.id), present: contacts.some((c) => c.isDecisionMaker), claimType: contacts.find((c) => c.isDecisionMaker)?.claimType ?? contacts[0]?.claimType ?? "UNKNOWN" }
        : null,
      suppressed: null,
    },
  };
  const thresholds = { score: await setting(db, "qualify_score_threshold"), confidence: await setting(db, "qualify_confidence_threshold") };
  return {
    input,
    weightSetId: ws.id,
    thresholds,
    params: { scoring, verifiability, recency: fresh, capacity: { min_capacity_markers: gate.min_capacity_markers, min_capacity_confidence: gate.min_capacity_confidence }, thresholds },
  };
}

export interface StoredScore {
  scoreId: string;
  result: ScoreResult;
  treatment: Treatment | null;
}

/** Stores one immutable score snapshot for the lead. */
export async function storeScore(tx: Tx, args: { leadId: string; auditId: string | null; ctx: ScoringContext; now: Date; traceId?: string }): Promise<StoredScore> {
  const result = scoreLead(args.ctx.input);
  const { score, confidence } = args.ctx.thresholds;
  const treatment = score === null || confidence === null ? null : treatmentOf(result.total, result.confidence, { score, confidence });
  const eq_ = result.dimensions.find((d) => d.dimension === "evidence_quality");
  const [row] = await tx
    .insert(s.scores)
    .values({
      leadId: args.leadId,
      weightSetId: args.ctx.weightSetId,
      auditId: args.auditId,
      total: String(result.total),
      opportunityAxis: String(result.opportunityAxis),
      intentAxis: String(result.intentAxis),
      confidence: String(result.confidence),
      evidenceQuality: String(eq_?.value ?? 0),
      rule: result.rule,
      params: args.ctx.params,
      treatment,
      computedAt: args.now,
      traceId: args.traceId,
    })
    .returning({ id: s.scores.id });
  if (!row) throw new Error("score insert returned no row");
  await tx.insert(s.scoreDimensions).values(
    result.dimensions.map((d) => ({
      scoreId: row.id,
      dimension: d.dimension,
      value: String(d.value),
      weight: String(d.weight),
      decay: String(d.decay),
      contribution: String(d.contribution),
      coverage: String(d.coverage),
      recency: String(d.recency),
      verifiability: String(d.verifiability),
      explanation: d.explanation,
      inputs: d.inputs,
    })),
  );
  const links = result.dimensions.flatMap((d) => d.inputs.evidence.map((evidenceId) => ({ scoreId: row.id, dimension: d.dimension, evidenceId })));
  if (links.length) await tx.insert(s.scoreDimensionEvidence).values(links).onConflictDoNothing();
  return { scoreId: row.id, result, treatment };
}
