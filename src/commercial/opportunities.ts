// Writes opportunities: the first code permitted to write the INFERRED claim type. An
// opportunity is an interpretation ("this business may need X, served by Y"), resting on
// named signals and, through them, on audit findings and their evidence.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getCompanyOpportunities, getCompanySignalsNow, inCompanyCluster } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import { parseSetting } from "@/db/validation";
import { type Derivation, type DerivationConfig, type SupportSignal, deriveOpportunities } from "./derive";

type Db = NodePgDatabase<typeof s>;

async function setting<K extends "opportunity_derivation" | "confidence_verifiability">(db: Db, key: K) {
  const [row] = await db.select({ value: s.settings.value }).from(s.settings).where(eq(s.settings.key, key));
  if (!row) throw new Error(`Setting ${key} is missing; run npm run db:setup`);
  return parseSetting(key, row.value);
}

export async function loadDerivationConfig(db: Db): Promise<DerivationConfig> {
  const maps = await db
    .select({ signal: s.signalTypes.key, type: s.opportunityTypes.key, preference: s.signalTypeOpportunityTypes.preference })
    .from(s.signalTypeOpportunityTypes)
    .innerJoin(s.signalTypes, eq(s.signalTypes.id, s.signalTypeOpportunityTypes.signalTypeId))
    .innerJoin(s.opportunityTypes, eq(s.opportunityTypes.id, s.signalTypeOpportunityTypes.opportunityTypeId))
    .where(and(eq(s.signalTypes.active, true), eq(s.opportunityTypes.active, true)))
    .orderBy(asc(s.signalTypeOpportunityTypes.preference));
  const svcs = await db
    .select({ type: s.opportunityTypes.key, key: s.covenantServices.key, name: s.covenantServices.name })
    .from(s.opportunityTypeServices)
    .innerJoin(s.opportunityTypes, eq(s.opportunityTypes.id, s.opportunityTypeServices.opportunityTypeId))
    .innerJoin(s.covenantServices, eq(s.covenantServices.id, s.opportunityTypeServices.covenantServiceId))
    .where(eq(s.covenantServices.active, true))
    .orderBy(asc(s.opportunityTypeServices.preference));
  const mappings: Record<string, { typeKey: string; preference: number }[]> = {};
  for (const m of maps) (mappings[m.signal] ??= []).push({ typeKey: m.type, preference: m.preference });
  const services: Record<string, { serviceKey: string; serviceName: string }[]> = {};
  for (const v of svcs) (services[v.type] ??= []).push({ serviceKey: v.key, serviceName: v.name });
  const verifiability = await setting(db, "confidence_verifiability");
  return { mappings, services, params: await setting(db, "opportunity_derivation"), inferredVerifiability: verifiability.INFERRED };
}

/** The company's active signals as derivation input: decayed strength, evidence, findings, basis confidence. */
export async function loadSupportSignals(db: Db, companyId: string, now: Date): Promise<SupportSignal[]> {
  const signals = await getCompanySignalsNow(db, companyId, now);
  if (!signals.length) return [];
  const ids = signals.map((x) => x.id);
  const evidence = await db.select().from(s.signalEvidence).where(inArray(s.signalEvidence.signalId, ids));
  const findings = await db
    .select({ signalId: s.signalFindings.signalId, findingId: s.signalFindings.auditFindingId, confidence: s.auditFindings.confidence })
    .from(s.signalFindings)
    .innerJoin(s.auditFindings, eq(s.auditFindings.id, s.signalFindings.auditFindingId))
    .where(inArray(s.signalFindings.signalId, ids));
  const reported = (await setting(db, "confidence_verifiability")).REPORTED;
  return signals.map((x) => {
    const fs = findings.filter((f) => f.signalId === x.id);
    return {
      id: x.id,
      typeKey: x.typeKey,
      detectedBy: x.detectedBy,
      strengthNow: x.strengthNow,
      evidenceIds: evidence.filter((e) => e.signalId === x.id).map((e) => e.evidenceId),
      findingIds: fs.map((f) => f.findingId),
      basisConfidence: x.detectedBy === "operator" ? reported : fs.length ? fs.reduce((a, f) => a + Number(f.confidence), 0) / fs.length : 0,
    };
  });
}

export interface DerivationOutcome {
  status: "derived" | "unchanged";
  derivation: Derivation;
  opportunityIds: string[];
  superseded: number;
}

/**
 * Derives a company's opportunities from its active signals and replaces the current set.
 * Re-deriving with nothing changed (same types, services, ranks and supporting signals) is a
 * no-op; otherwise the previous set is superseded, never deleted.
 */
export async function deriveCompanyOpportunities(db: Db, companyId: string, now = new Date()): Promise<DerivationOutcome> {
  const [root] = await db.select({ id: s.companyRoots.rootId }).from(s.companyRoots).where(eq(s.companyRoots.companyId, companyId));
  if (!root) throw new Error(`No company ${companyId}`);
  const config = await loadDerivationConfig(db);
  const derivation = deriveOpportunities(await loadSupportSignals(db, companyId, now), config);

  const typeIds = new Map((await db.select({ id: s.opportunityTypes.id, key: s.opportunityTypes.key }).from(s.opportunityTypes)).map((r) => [r.key, r.id]));
  const serviceIds = new Map((await db.select({ id: s.covenantServices.id, key: s.covenantServices.key }).from(s.covenantServices)).map((r) => [r.key, r.id]));

  const current = await getCompanyOpportunities(db, companyId);
  const currentSignals = current.length
    ? await db.select().from(s.opportunitySignals).where(inArray(s.opportunitySignals.opportunityId, current.map((c) => c.opportunity.id)))
    : [];
  const signature = (rows: { type: string; service: string | null; rank: number; signals: string[] }[]) =>
    JSON.stringify(rows.map((r) => [r.rank, r.type, r.service, [...r.signals].sort()]).sort());
  const before = signature(
    current.map((c) => ({
      type: c.typeKey,
      service: c.serviceKey,
      rank: c.opportunity.rank,
      signals: currentSignals.filter((x) => x.opportunityId === c.opportunity.id).map((x) => x.signalId),
    })),
  );
  const after = signature(derivation.opportunities.map((o) => ({ type: o.typeKey, service: o.serviceKey, rank: o.rank, signals: o.signals.map((x) => x.id) })));
  if (before === after) return { status: "unchanged", derivation, opportunityIds: current.map((c) => c.opportunity.id), superseded: 0 };

  return db.transaction(async (tx) => {
    const superseded = await tx
      .update(s.opportunities)
      .set({ supersededAt: now })
      .where(and(inCompanyCluster(s.opportunities.companyId, companyId), sql`${s.opportunities.supersededAt} is null`))
      .returning({ id: s.opportunities.id });
    const ids: string[] = [];
    for (const o of derivation.opportunities) {
      const opportunityTypeId = typeIds.get(o.typeKey);
      if (!opportunityTypeId) throw new Error(`Unknown opportunity type ${o.typeKey}`);
      const [row] = await tx
        .insert(s.opportunities)
        .values({
          companyId: root.id,
          opportunityTypeId,
          covenantServiceId: o.serviceKey ? (serviceIds.get(o.serviceKey) ?? null) : null,
          rank: o.rank,
          relevance: String(o.relevance),
          confidence: String(o.confidence),
          claimType: "INFERRED",
          rationale: o.rationale,
          inferenceRule: derivation.inferenceRule,
          derivedAt: now,
        })
        .returning({ id: s.opportunities.id });
      if (!row) throw new Error("opportunity insert returned no row");
      ids.push(row.id);
      await tx.insert(s.opportunitySignals).values(o.signals.map((x) => ({ opportunityId: row.id, signalId: x.id })));
      if (o.findingIds.length) await tx.insert(s.opportunityFindings).values(o.findingIds.map((auditFindingId) => ({ opportunityId: row.id, auditFindingId })));
    }
    return { status: "derived" as const, derivation, opportunityIds: ids, superseded: superseded.length };
  });
}
