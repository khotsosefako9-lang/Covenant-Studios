// Human resolution of proposed duplicates: confirm (merge), reject (permanent
// non-match), defer, and unmerge. A merge moves no rows: the loser keeps everything it
// owns and points at the winner, so nothing can be lost and an unmerge is exact.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { normaliseCompanyName } from "@/core/identity/name";
import * as s from "@/db/schema/index";
import { reconcileLeadsOnMerge, reopenLeadsOnUnmerge } from "@/leads/merge";

type Db = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type Failure = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Failure => ({ ok: false, code, message });

const OPEN = ["proposed", "deferred"] as const;

function checkDecision(actor: string, reason: string): Failure | null {
  if (actor.trim() === "") return fail("actor_missing", "An operator name is required");
  if (reason.trim() === "") return fail("reason_missing", "A reason is required");
  return null;
}

async function lockCandidate(tx: Tx, candidateId: string) {
  const rows = await tx
    .select()
    .from(s.companyDuplicateCandidates)
    .where(eq(s.companyDuplicateCandidates.id, candidateId))
    .for("update");
  return rows[0];
}

// Every still-open candidate for the same pair (a pair can be proposed on several bases).
async function openCandidatesForPair(tx: Tx, a: string, b: string) {
  return tx
    .select({ id: s.companyDuplicateCandidates.id })
    .from(s.companyDuplicateCandidates)
    .where(
      and(
        eq(s.companyDuplicateCandidates.companyAId, a),
        eq(s.companyDuplicateCandidates.companyBId, b),
        inArray(s.companyDuplicateCandidates.status, [...OPEN]),
      ),
    )
    .for("update");
}

export type ConfirmResult =
  | { ok: true; mergeId: string; winnerId: string; loserId: string; aliasesAdded: number; leadClosed: string | null; leadSurvivor: string | null }
  | Failure;

/** Confirms a candidate and merges the other company into `keepCompanyId`. */
export async function confirmDuplicate(
  db: Db,
  args: { candidateId: string; keepCompanyId: string; actor: string; reason: string },
): Promise<ConfirmResult> {
  const bad = checkDecision(args.actor, args.reason);
  if (bad) return bad;
  return db.transaction(async (tx) => {
    const cand = await lockCandidate(tx, args.candidateId);
    if (!cand) return fail("not_found", `No duplicate candidate ${args.candidateId}`);
    if (!(OPEN as readonly string[]).includes(cand.status)) {
      return fail(`candidate_${cand.status}`, `Candidate is already ${cand.status.replace("_", " ")}`);
    }
    if (args.keepCompanyId !== cand.companyAId && args.keepCompanyId !== cand.companyBId) {
      return fail("keep_not_in_pair", "The company to keep must be one of the two in the candidate");
    }
    const winnerId = args.keepCompanyId;
    const loserId = winnerId === cand.companyAId ? cand.companyBId : cand.companyAId;

    const pair = await tx
      .select()
      .from(s.companies)
      .where(inArray(s.companies.id, [winnerId, loserId]))
      .orderBy(s.companies.id)
      .for("update");
    for (const c of pair) {
      if (c.status !== "active") {
        return fail("company_not_active", `${c.displayName} is already merged into ${c.mergedIntoId}; resolve against that company`);
      }
    }
    const loser = pair.find((c) => c.id === loserId);
    if (!loser || pair.length !== 2) return fail("not_found", "One of the companies no longer exists");

    const [nonMatch] = await tx
      .select({ id: s.companyNonMatches.id })
      .from(s.companyNonMatches)
      .where(and(eq(s.companyNonMatches.companyAId, cand.companyAId), eq(s.companyNonMatches.companyBId, cand.companyBId)));
    if (nonMatch) return fail("non_match", "These companies are recorded as a non-match");

    const [merge] = await tx
      .insert(s.companyMerges)
      .values({ candidateId: cand.id, winnerId, loserId, mergedBy: args.actor.trim(), reason: args.reason.trim() })
      .returning({ id: s.companyMerges.id });
    if (!merge) throw new Error("merge insert returned no row");

    // The losing identity's names and domain become aliases of the winner, tagged with
    // the merge so an unmerge removes exactly these.
    const loserAliases = await tx
      .select({ value: s.companyAliases.value })
      .from(s.companyAliases)
      .where(and(eq(s.companyAliases.companyId, loserId), isNull(s.companyAliases.mergeId)));
    const names = [loser.displayName, ...loserAliases.map((a) => a.value)];
    const aliasRows = [
      ...names.map((value) => ({ kind: "merged_identity" as const, value, normalisedValue: normaliseCompanyName(value) })),
      ...(loser.domain ? [{ kind: "merged_domain" as const, value: loser.domain, normalisedValue: loser.domain }] : []),
    ].map((a) => ({ ...a, companyId: winnerId, mergeId: merge.id }));
    const added = await tx.insert(s.companyAliases).values(aliasRows).onConflictDoNothing().returning({ id: s.companyAliases.id });

    await tx.update(s.companies).set({ status: "merged", mergedIntoId: winnerId }).where(eq(s.companies.id, loserId));

    const open = await openCandidatesForPair(tx, cand.companyAId, cand.companyBId);
    const now = new Date();
    // One business, one pursuit (src/leads/merge.ts).
    const leads = await reconcileLeadsOnMerge(tx, { mergeId: merge.id, winnerId, loserId, actor: args.actor.trim(), at: now });
    for (const c of open) {
      await tx
        .update(s.companyDuplicateCandidates)
        .set({ status: "confirmed_duplicate", resolvedBy: args.actor.trim(), resolvedAt: now })
        .where(eq(s.companyDuplicateCandidates.id, c.id));
      await tx.insert(s.duplicateResolutions).values({
        candidateId: c.id,
        action: "confirm",
        actor: args.actor.trim(),
        reason: c.id === cand.id ? args.reason.trim() : `Resolved by merge ${merge.id}: ${args.reason.trim()}`,
        actedAt: now,
        mergeId: merge.id,
      });
    }
    return { ok: true as const, mergeId: merge.id, winnerId, loserId, aliasesAdded: added.length, leadClosed: leads.closedId, leadSurvivor: leads.survivorId };
  });
}

export type RejectResult = { ok: true; nonMatchId: string } | Failure;

/** Records a permanent non-match: the pair is never proposed again. */
export async function rejectDuplicate(db: Db, args: { candidateId: string; actor: string; reason: string }): Promise<RejectResult> {
  const bad = checkDecision(args.actor, args.reason);
  if (bad) return bad;
  return db.transaction(async (tx) => {
    const cand = await lockCandidate(tx, args.candidateId);
    if (!cand) return fail("not_found", `No duplicate candidate ${args.candidateId}`);
    if (!(OPEN as readonly string[]).includes(cand.status)) {
      return fail(`candidate_${cand.status}`, `Candidate is already ${cand.status.replace("_", " ")}`);
    }
    const [nm] = await tx
      .insert(s.companyNonMatches)
      .values({
        companyAId: cand.companyAId,
        companyBId: cand.companyBId,
        candidateId: cand.id,
        decidedBy: args.actor.trim(),
        reason: args.reason.trim(),
      })
      .onConflictDoUpdate({
        target: [s.companyNonMatches.companyAId, s.companyNonMatches.companyBId],
        set: { updatedAt: sql`now()` },
      })
      .returning({ id: s.companyNonMatches.id });
    if (!nm) throw new Error("non-match insert returned no row");
    const now = new Date();
    for (const c of await openCandidatesForPair(tx, cand.companyAId, cand.companyBId)) {
      await tx
        .update(s.companyDuplicateCandidates)
        .set({ status: "rejected", resolvedBy: args.actor.trim(), resolvedAt: now })
        .where(eq(s.companyDuplicateCandidates.id, c.id));
      await tx.insert(s.duplicateResolutions).values({
        candidateId: c.id,
        action: "reject",
        actor: args.actor.trim(),
        reason: args.reason.trim(),
        actedAt: now,
      });
    }
    return { ok: true as const, nonMatchId: nm.id };
  });
}

/** Parks a candidate for later. It stays open and can still be confirmed or rejected. */
export async function deferDuplicate(
  db: Db,
  args: { candidateId: string; actor: string; reason: string },
): Promise<{ ok: true } | Failure> {
  const bad = checkDecision(args.actor, args.reason);
  if (bad) return bad;
  return db.transaction(async (tx) => {
    const cand = await lockCandidate(tx, args.candidateId);
    if (!cand) return fail("not_found", `No duplicate candidate ${args.candidateId}`);
    if (!(OPEN as readonly string[]).includes(cand.status)) {
      return fail(`candidate_${cand.status}`, `Candidate is already ${cand.status.replace("_", " ")}`);
    }
    const now = new Date();
    await tx
      .update(s.companyDuplicateCandidates)
      .set({ status: "deferred", resolvedBy: args.actor.trim(), resolvedAt: now })
      .where(eq(s.companyDuplicateCandidates.id, cand.id));
    await tx.insert(s.duplicateResolutions).values({
      candidateId: cand.id,
      action: "defer",
      actor: args.actor.trim(),
      reason: args.reason.trim(),
      actedAt: now,
    });
    return { ok: true as const };
  });
}

export type UnmergeResult = { ok: true; restoredCompanyId: string; aliasesRemoved: number; leadsReopened: string[] } | Failure;

/**
 * Reverses a merge: the loser becomes active again, the aliases the merge added are
 * removed, and the candidates it confirmed return to `proposed` for a fresh decision.
 * The merge row stays, marked unmerged, so the history is complete.
 */
export async function unmerge(db: Db, args: { mergeId: string; actor: string; reason: string }): Promise<UnmergeResult> {
  const bad = checkDecision(args.actor, args.reason);
  if (bad) return bad;
  return db.transaction(async (tx) => {
    const [merge] = await tx.select().from(s.companyMerges).where(eq(s.companyMerges.id, args.mergeId)).for("update");
    if (!merge) return fail("not_found", `No merge ${args.mergeId}`);
    if (merge.unmergedAt) return fail("already_unmerged", `Merge was already reversed at ${merge.unmergedAt.toISOString()}`);
    const [loser] = await tx.select().from(s.companies).where(eq(s.companies.id, merge.loserId)).for("update");
    if (!loser || loser.status !== "merged" || loser.mergedIntoId !== merge.winnerId) {
      return fail("inconsistent", "The losing company is no longer merged into the winner by this merge");
    }
    if (loser.domain) {
      const [clash] = await tx
        .select({ id: s.companies.id })
        .from(s.companies)
        .where(and(eq(s.companies.domain, loser.domain), eq(s.companies.status, "active")));
      if (clash) return fail("domain_taken", `${loser.domain} now belongs to active company ${clash.id}`);
    }

    const removed = await tx.delete(s.companyAliases).where(eq(s.companyAliases.mergeId, merge.id)).returning({ id: s.companyAliases.id });
    await tx.update(s.companies).set({ status: "active", mergedIntoId: null }).where(eq(s.companies.id, loser.id));
    const now = new Date();
    await tx
      .update(s.companyMerges)
      .set({ unmergedBy: args.actor.trim(), unmergeReason: args.reason.trim(), unmergedAt: now })
      .where(eq(s.companyMerges.id, merge.id));
    const leadsReopened = await reopenLeadsOnUnmerge(tx, { mergeId: merge.id, winnerId: merge.winnerId, loserId: loser.id, actor: args.actor.trim(), at: now });

    const confirmed = await tx
      .selectDistinct({ candidateId: s.duplicateResolutions.candidateId })
      .from(s.duplicateResolutions)
      .where(and(eq(s.duplicateResolutions.mergeId, merge.id), eq(s.duplicateResolutions.action, "confirm")));
    for (const { candidateId } of confirmed) {
      await tx
        .update(s.companyDuplicateCandidates)
        .set({ status: "proposed", resolvedBy: null, resolvedAt: null })
        .where(eq(s.companyDuplicateCandidates.id, candidateId));
      await tx.insert(s.duplicateResolutions).values({
        candidateId,
        action: "unmerge",
        actor: args.actor.trim(),
        reason: args.reason.trim(),
        actedAt: now,
        mergeId: merge.id,
      });
    }
    return { ok: true as const, restoredCompanyId: loser.id, aliasesRemoved: removed.length, leadsReopened };
  });
}

/** The active root of a company's identity cluster and every company merged into it. */
export async function getIdentityCluster(db: Db | Tx, companyId: string) {
  const [root] = await db.select({ rootId: s.companyRoots.rootId }).from(s.companyRoots).where(eq(s.companyRoots.companyId, companyId));
  if (!root) return null;
  const members = await db
    .select({ companyId: s.companyRoots.companyId, depth: s.companyRoots.depth })
    .from(s.companyRoots)
    .where(eq(s.companyRoots.rootId, root.rootId));
  return { rootId: root.rootId, memberIds: members.sort((a, b) => a.depth - b.depth).map((m) => m.companyId) };
}

export async function listCandidates(db: Db, status?: (typeof s.duplicateCandidateStatus.enumValues)[number]) {
  const rows = await db.execute<{
    id: string;
    match_basis: string;
    matched_value: string;
    similarity: string | null;
    status: string;
    company_a_id: string;
    a_name: string;
    a_domain: string | null;
    a_status: string;
    company_b_id: string;
    b_name: string;
    b_domain: string | null;
    b_status: string;
  }>(sql`
    select d.id, d.match_basis, d.matched_value, d.similarity, d.status,
           d.company_a_id, ca.display_name as a_name, ca.domain as a_domain, ca.status as a_status,
           d.company_b_id, cb.display_name as b_name, cb.domain as b_domain, cb.status as b_status
    from company_duplicate_candidates d
    join companies ca on ca.id = d.company_a_id
    join companies cb on cb.id = d.company_b_id
    where ${status ? sql`d.status = ${status}` : sql`d.status in ('proposed', 'deferred')`}
    order by d.created_at`);
  return rows.rows;
}
