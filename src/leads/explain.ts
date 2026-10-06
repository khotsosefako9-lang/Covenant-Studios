// Decomposes a stored score to the evidence it rests on: each dimension's raw value,
// weight, decay and contribution, and under it the findings, signals, opportunities,
// channels and evidence that produced it. Decay is applied here, at read.
import { desc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decayedStrength } from "@/core/freshness";
import { DIMENSIONS, type Dimension, totalNow } from "@/core/scoring";
import * as s from "@/db/schema/index";

type Db = NodePgDatabase<typeof s>;

const noisyOr = (xs: number[]) => 1 - xs.reduce((a, x) => a * (1 - x), 1);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface ExplainedDimension {
  dimension: Dimension;
  value: number;
  weight: number;
  decay: number;
  decayNow: number;
  contribution: number;
  contributionNow: number;
  coverage: number;
  recency: number;
  verifiability: number;
  explanation: string;
  components: Record<string, number | null> | null;
  findings: { id: string; checkKey: string; status: string; severity: string | null; confidence: number; detail: string }[];
  signals: { id: string; typeKey: string; detectedBy: string; strength: number; strengthNow: number; observedAt: Date; status: string }[];
  opportunities: { id: string; rank: number; typeKey: string; serviceKey: string | null; relevance: number | null; superseded: boolean }[];
  channels: { id: string; kind: string; value: string; verification: string }[];
  evidence: { id: string; claimType: string; claim: string; value: string | null; sourceUrl: string | null; retrievalMethod: string | null }[];
}

export interface ExplainedScore {
  leadId: string;
  scoreId: string;
  computedAt: Date;
  weightSet: string;
  auditId: string | null;
  total: number;
  totalNow: number;
  confidence: number;
  opportunityAxis: number | null;
  intentAxis: number | null;
  treatment: string | null;
  rule: string | null;
  dimensions: ExplainedDimension[];
}

/** Explains a lead's current score (or a given score id), with decay applied at `now`. */
export async function explainScore(db: Db, args: { leadId: string; scoreId?: string; now?: Date }): Promise<ExplainedScore> {
  const now = args.now ?? new Date();
  const [lead] = await db.select().from(s.leads).where(eq(s.leads.id, args.leadId));
  if (!lead) throw new Error(`No lead ${args.leadId}`);
  const scoreId = args.scoreId ?? lead.currentScoreId;
  const [score] = scoreId
    ? await db.select().from(s.scores).where(eq(s.scores.id, scoreId))
    : await db.select().from(s.scores).where(eq(s.scores.leadId, lead.id)).orderBy(desc(s.scores.computedAt)).limit(1);
  if (!score || score.leadId !== lead.id) throw new Error(`Lead ${lead.id} has no score${args.scoreId ? ` ${args.scoreId}` : ""}; run the pipeline`);
  const [ws] = await db.select().from(s.weightSets).where(eq(s.weightSets.id, score.weightSetId));
  const dims = await db.select().from(s.scoreDimensions).where(eq(s.scoreDimensions.scoreId, score.id));
  type Inputs = { signals?: string[]; findings?: string[]; opportunities?: string[]; channels?: string[]; evidence?: string[]; components?: Record<string, number | null> };
  const inputsOf = (d: (typeof dims)[number]) => (d.inputs ?? {}) as Inputs;
  const all = (k: keyof Omit<Inputs, "components">) => [...new Set(dims.flatMap((d) => inputsOf(d)[k] ?? []))];

  const signalIds = all("signals");
  const signals = signalIds.length
    ? await db
        .select({ sg: s.signals, typeKey: s.signalTypes.key, decayDays: s.signalTypes.decayDays })
        .from(s.signals)
        .innerJoin(s.signalTypes, eq(s.signalTypes.id, s.signals.signalTypeId))
        .where(inArray(s.signals.id, signalIds))
    : [];
  const signalRows = signals.map((x) => ({
    id: x.sg.id,
    typeKey: x.typeKey,
    detectedBy: x.sg.detectedBy,
    strength: Number(x.sg.strength),
    strengthNow: decayedStrength({ strength: Number(x.sg.strength), observedAt: x.sg.observedAt, decayDays: x.decayDays, now }),
    observedAt: x.sg.observedAt,
    status: x.sg.status,
  }));
  const findingIds = all("findings");
  const findings = findingIds.length ? await db.select().from(s.auditFindings).where(inArray(s.auditFindings.id, findingIds)) : [];
  const opIds = all("opportunities");
  const ops = opIds.length
    ? await db
        .select({ o: s.opportunities, typeKey: s.opportunityTypes.key, serviceKey: s.covenantServices.key })
        .from(s.opportunities)
        .innerJoin(s.opportunityTypes, eq(s.opportunityTypes.id, s.opportunities.opportunityTypeId))
        .leftJoin(s.covenantServices, eq(s.covenantServices.id, s.opportunities.covenantServiceId))
        .where(inArray(s.opportunities.id, opIds))
    : [];
  const channelIds = all("channels");
  const channels = channelIds.length ? await db.select().from(s.contactChannels).where(inArray(s.contactChannels.id, channelIds)) : [];
  const links = await db.select().from(s.scoreDimensionEvidence).where(eq(s.scoreDimensionEvidence.scoreId, score.id));
  const evidence = links.length
    ? await db.select().from(s.evidenceProvenance).where(inArray(s.evidenceProvenance.evidenceId, [...new Set(links.map((l) => l.evidenceId))]))
    : [];

  // Decay at read: buying_signal's decay recomputed from its signals' strengths now.
  const bs = dims.find((d) => d.dimension === "buying_signal");
  const bsSignals = signalRows.filter((x) => (bs ? (inputsOf(bs).signals ?? []).includes(x.id) : false));
  const raw = noisyOr(bsSignals.map((x) => x.strength));
  const buyingDecayNow = bsSignals.length && raw ? r3(noisyOr(bsSignals.map((x) => x.strengthNow)) / raw) : null;

  const ordered = DIMENSIONS.map((name) => dims.find((d) => d.dimension === name)).filter((d): d is (typeof dims)[number] => !!d);
  const explained: ExplainedDimension[] = ordered.map((d) => {
    const inputs = inputsOf(d);
    const value = Number(d.value);
    const weight = Number(d.weight);
    const decay = Number(d.decay);
    const decayNow = d.dimension === "buying_signal" && buyingDecayNow !== null ? buyingDecayNow : decay;
    return {
      dimension: d.dimension,
      value,
      weight,
      decay,
      decayNow,
      contribution: Number(d.contribution),
      contributionNow: Math.round(100 * weight * value * decayNow * 100) / 100,
      coverage: Number(d.coverage),
      recency: Number(d.recency),
      verifiability: Number(d.verifiability),
      explanation: d.explanation ?? "",
      components: inputs.components ?? null,
      findings: findings
        .filter((f) => (inputs.findings ?? []).includes(f.id))
        .map((f) => ({ id: f.id, checkKey: f.checkKey, status: f.status, severity: f.severity, confidence: Number(f.confidence), detail: f.detail })),
      signals: signalRows.filter((x) => (inputs.signals ?? []).includes(x.id)),
      opportunities: ops
        .filter((x) => (inputs.opportunities ?? []).includes(x.o.id))
        .map((x) => ({ id: x.o.id, rank: x.o.rank, typeKey: x.typeKey, serviceKey: x.serviceKey, relevance: x.o.relevance === null ? null : Number(x.o.relevance), superseded: x.o.supersededAt !== null })),
      channels: channels.filter((c) => (inputs.channels ?? []).includes(c.id)).map((c) => ({ id: c.id, kind: c.kind, value: c.value, verification: c.verification })),
      evidence: evidence
        .filter((e) => links.some((l) => l.dimension === d.dimension && l.evidenceId === e.evidenceId))
        .map((e) => ({ id: e.evidenceId, claimType: e.claimType, claim: e.claim, value: e.value, sourceUrl: e.sourceUrl, retrievalMethod: e.retrievalMethod })),
    };
  });

  return {
    leadId: lead.id,
    scoreId: score.id,
    computedAt: score.computedAt,
    weightSet: ws ? `${ws.name} v${ws.version}` : score.weightSetId,
    auditId: score.auditId,
    total: Number(score.total),
    totalNow: totalNow(explained.map((d) => ({ dimension: d.dimension, weight: d.weight, value: d.value, decay: d.decay })), buyingDecayNow),
    confidence: Number(score.confidence),
    opportunityAxis: score.opportunityAxis === null ? null : Number(score.opportunityAxis),
    intentAxis: score.intentAxis === null ? null : Number(score.intentAxis),
    treatment: score.treatment,
    rule: score.rule,
    dimensions: explained,
  };
}
