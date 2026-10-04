// Writes signals: rule-detected ones from a completed audit's findings, and operator-
// recorded ones from an attributed statement. Every signal rests on stored evidence.
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, notLike, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getCompanySignalsNow } from "@/db/company-scope";
import * as s from "@/db/schema/index";
import { type ActiveSignal, axisContributions } from "./axes";
import { type AuditSnapshot, detectAll, resolveDetectorParams } from "./detectors";

type Db = NodePgDatabase<typeof s>;

export class HumanOnlySignalError extends Error {}

async function signalTypes(db: Db) {
  const rows = await db.select().from(s.signalTypes);
  return new Map(rows.map((r) => [r.key, r]));
}

export async function loadAuditSnapshot(db: Db, auditId: string): Promise<{ snapshot: AuditSnapshot; audit: typeof s.audits.$inferSelect } | null> {
  const [audit] = await db.select().from(s.audits).where(eq(s.audits.id, auditId));
  if (!audit) throw new Error(`No audit ${auditId}`);
  if (audit.status !== "COMPLETED") return null;
  const findings = await db.select().from(s.auditFindings).where(eq(s.auditFindings.auditId, auditId));
  const links = findings.length
    ? await db
        .select({ findingId: s.auditFindingEvidence.auditFindingId, evidenceId: s.auditFindingEvidence.evidenceId, declared: s.sourceRecords.declaredLength })
        .from(s.auditFindingEvidence)
        .innerJoin(s.evidence, eq(s.evidence.id, s.auditFindingEvidence.evidenceId))
        .innerJoin(s.sourceRecords, eq(s.sourceRecords.id, s.evidence.sourceRecordId))
        .where(inArray(s.auditFindingEvidence.auditFindingId, findings.map((f) => f.id)))
    : [];
  const declaredLength: Record<string, number | null> = {};
  for (const l of links) declaredLength[l.evidenceId] = l.declared;
  return {
    audit,
    snapshot: {
      auditId,
      companyId: audit.companyId,
      declaredLength,
      findings: findings.map((f) => ({
        id: f.id,
        checkKey: f.checkKey,
        status: f.status,
        severity: f.severity,
        confidence: Number(f.confidence),
        evidenceIds: links.filter((l) => l.findingId === f.id).map((l) => l.evidenceId),
      })),
    },
  };
}

export interface DetectionResult {
  auditId: string;
  status: "detected" | "abstained";
  reason?: string;
  created: { typeKey: string; strength: number; signalId: string }[];
  existing: number;
  retracted: number;
}

/**
 * Detects signals from one completed audit. Idempotent per audit. When this is the
 * company's latest completed audit, rule-detected signals from older audits are retracted:
 * friction signals live and die with the audit that produced them.
 */
export async function detectSignalsForAudit(db: Db, auditId: string): Promise<DetectionResult> {
  const loaded = await loadAuditSnapshot(db, auditId);
  if (!loaded) return { auditId, status: "abstained", reason: "audit is not COMPLETED; nothing to interpret", created: [], existing: 0, retracted: 0 };
  const { snapshot, audit } = loaded;
  const types = await signalTypes(db);
  // Strengths and thresholds come from signal_types.detector_params; an invalid row stops
  // detection rather than running on a value the operator did not choose.
  const params = resolveDetectorParams(Object.fromEntries([...types.values()].map((t) => [t.key, t.detectorParams])));
  const candidates = detectAll(snapshot, params);
  for (const c of candidates) {
    const t = types.get(c.typeKey);
    if (!t) throw new Error(`Unknown signal type ${c.typeKey}`);
    if (t.humanOnly) throw new HumanOnlySignalError(`Detector produced human-only signal type ${c.typeKey}; only an operator may record it`);
  }

  return db.transaction(async (tx) => {
    const created: DetectionResult["created"] = [];
    let existing = 0;
    const ref = `@audit:${auditId}`;
    for (const c of candidates) {
      const [obs] = await tx
        .select({ at: sql<Date>`max(${s.evidence.observedAt})` })
        .from(s.evidence)
        .where(inArray(s.evidence.id, c.evidenceIds));
      const [row] = await tx
        .insert(s.signals)
        .values({
          companyId: snapshot.companyId,
          signalTypeId: types.get(c.typeKey)?.id as string,
          strength: String(c.strength),
          observedAt: obs?.at ? new Date(obs.at) : (audit.completedAt ?? new Date()),
          detectedBy: "rule",
          detectorRef: `${c.typeKey}${ref}`,
          detectorParams: params[c.typeKey],
        })
        .onConflictDoNothing()
        .returning({ id: s.signals.id });
      if (!row) {
        existing++;
        continue;
      }
      await tx.insert(s.signalEvidence).values(c.evidenceIds.map((evidenceId) => ({ signalId: row.id, evidenceId })));
      await tx.insert(s.signalFindings).values(c.findingIds.map((auditFindingId) => ({ signalId: row.id, auditFindingId })));
      created.push({ typeKey: c.typeKey, strength: c.strength, signalId: row.id });
    }

    // Retract older audits' rule signals only if this audit is the company's latest.
    const [latest] = await tx
      .select({ id: s.audits.id })
      .from(s.audits)
      .where(and(eq(s.audits.companyId, snapshot.companyId), eq(s.audits.status, "COMPLETED"), isNotNull(s.audits.completedAt)))
      .orderBy(desc(s.audits.completedAt))
      .limit(1);
    let retracted = 0;
    if (latest?.id === auditId) {
      const r = await tx
        .update(s.signals)
        .set({ status: "retracted" })
        .where(
          and(
            eq(s.signals.companyId, snapshot.companyId),
            eq(s.signals.detectedBy, "rule"),
            eq(s.signals.status, "active"),
            notLike(s.signals.detectorRef, `%${ref}`),
          ),
        )
        .returning({ id: s.signals.id });
      retracted = r.length;
    }
    return { auditId, status: "detected" as const, created, existing, retracted };
  });
}

/**
 * An operator records a signal they have grounds for (a call, a tender notice, a
 * conversation). The statement becomes REPORTED evidence attributed to them, and the
 * signal rests on it. This is the only path for human-only types.
 */
export async function recordOperatorSignal(
  db: Db,
  args: { companyId: string; typeKey: string; strength: number; basis: string; actor: string; observedAt?: Date },
): Promise<{ signalId: string; evidenceId: string }> {
  if (!args.actor.trim()) throw new Error("An operator name is required");
  if (!args.basis.trim()) throw new Error("The basis for the signal is required");
  if (!(args.strength > 0 && args.strength <= 1)) throw new Error("Strength must be in (0, 1]");
  const types = await signalTypes(db);
  const t = types.get(args.typeKey);
  if (!t) throw new Error(`Unknown signal type ${args.typeKey}`);
  const observedAt = args.observedAt ?? new Date();
  return db.transaction(async (tx) => {
    const [source] = await tx.select({ id: s.sources.id }).from(s.sources).where(eq(s.sources.key, "human_operator"));
    if (!source) throw new Error("Source human_operator is missing; run npm run db:setup");
    const statement = JSON.stringify({ signal: args.typeKey, basis: args.basis });
    const [rec] = await tx
      .insert(s.sourceRecords)
      .values({
        sourceId: source.id,
        companyId: args.companyId,
        retrievalMethod: "operator_statement",
        fetchedAt: observedAt,
        fetchOutcome: "NOT_APPLICABLE",
        rawContent: statement,
        contentHash: createHash("sha256").update(statement).digest("hex"),
        attributedTo: args.actor.trim(),
      })
      .returning({ id: s.sourceRecords.id });
    const [ev] = await tx
      .insert(s.evidence)
      .values({
        companyId: args.companyId,
        sourceRecordId: rec?.id as string,
        producer: "operator",
        claimKey: `signal.${args.typeKey}`,
        claim: `Operator reports ${t.name}`,
        claimType: "REPORTED",
        value: args.basis.trim(),
        observedAt,
      })
      .returning({ id: s.evidence.id });
    const [sig] = await tx
      .insert(s.signals)
      .values({
        companyId: args.companyId,
        signalTypeId: t.id,
        strength: String(args.strength),
        observedAt,
        detectedBy: "operator",
        detectorRef: `operator:${args.actor.trim()}:${rec?.id}`,
      })
      .returning({ id: s.signals.id });
    await tx.insert(s.signalEvidence).values({ signalId: sig?.id as string, evidenceId: ev?.id as string });
    return { signalId: sig?.id as string, evidenceId: ev?.id as string };
  });
}

/** A company's active signals now (decayed), with their axis attribution. */
export async function companySignalView(db: Db, companyId: string, now = new Date()) {
  const signals = (await getCompanySignalsNow(db, companyId, now)).filter((x) => x.status === "active");
  const types = await signalTypes(db);
  const evidence = signals.length
    ? await db.select().from(s.signalEvidence).where(inArray(s.signalEvidence.signalId, signals.map((x) => x.id)))
    : [];
  const active: ActiveSignal[] = signals.map((x) => {
    const t = types.get(x.typeKey);
    return {
      id: x.id,
      typeKey: x.typeKey,
      axis: (t?.axis ?? "opportunity") as ActiveSignal["axis"],
      strengthNow: x.strengthNow,
      evidenceIds: evidence.filter((e) => e.signalId === x.id).map((e) => e.evidenceId),
    };
  });
  return { signals, active, axes: axisContributions(active) };
}


