// One business, one pursuit. A merge can bring two open leads into one identity cluster
// (the Phase 4 deferred item). The rule:
//   - Exactly one open lead per identity cluster, held as an invariant.
//   - If only one of the two companies has an open lead, it simply becomes the cluster's
//     lead. Nothing moves: it is found through the cluster read path.
//   - If both do, one survives and the other is closed with closed_reason 'merged',
//     pointing at the survivor. The survivor is the lead carrying a human state override
//     when exactly one does (a human decision about the business must not be silently
//     replaced by a fresh system state); otherwise the kept company's lead. The closed
//     lead's evaluations, judgements, disqualifications and transitions stay on it as
//     history, readable across the cluster.
//   - The survivor's state is not touched here; the next evaluation recomputes it on the
//     cluster's combined evidence.
//   - An unmerge reopens exactly the leads that merge closed.
//   - Opportunities are interpretations of one identity's evidence. When the identity
//     changes (merge or unmerge) the current ones of both companies are superseded, never
//     deleted, and the next evaluation re-derives on the new cluster. Otherwise a split
//     cluster would keep opportunities resting on the other business's signals.
// Called inside the merge and unmerge transactions (src/identity/resolution.ts).
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "@/db/schema/index";

type Db = NodePgDatabase<typeof s>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function supersedeOpportunities(tx: Tx, companyIds: string[], at: Date) {
  const rows = await tx
    .update(s.opportunities)
    .set({ supersededAt: at })
    .where(and(inArray(s.opportunities.companyId, companyIds), isNull(s.opportunities.supersededAt)))
    .returning({ id: s.opportunities.id });
  return rows.length;
}

export async function reconcileLeadsOnMerge(tx: Tx, args: { mergeId: string; winnerId: string; loserId: string; actor: string; at: Date }) {
  await supersedeOpportunities(tx, [args.winnerId, args.loserId], args.at);
  const open = await tx
    .select()
    .from(s.leads)
    .where(and(inArray(s.leads.companyId, [args.winnerId, args.loserId]), eq(s.leads.status, "open")))
    .for("update");
  const winnerLead = open.find((l) => l.companyId === args.winnerId);
  const loserLead = open.find((l) => l.companyId === args.loserId);
  if (!winnerLead || !loserLead) {
    const only = winnerLead ?? loserLead;
    if (only) {
      await tx.insert(s.leadStateTransitions).values({
        leadId: only.id,
        fromState: only.leadState,
        toState: only.leadState,
        systemState: only.systemLeadState,
        cause: "merge",
        actor: args.actor,
        detail: `Identity merge ${args.mergeId}: now the only open lead of the merged business`,
        occurredAt: args.at,
      });
    }
    return { survivorId: only?.id ?? null, closedId: null };
  }
  const overridden = [winnerLead, loserLead].filter((l) => l.stateOverride !== null);
  const survivor = overridden.length === 1 ? (overridden[0] as typeof winnerLead) : winnerLead;
  const closed = survivor === winnerLead ? loserLead : winnerLead;
  const why = overridden.length === 1 ? "it carries the only human state override" : "it belongs to the company kept by the merge";

  await tx
    .update(s.leads)
    .set({ status: "closed", closedAt: args.at, closedReason: "merged", mergedIntoLeadId: survivor.id, closedByMergeId: args.mergeId, updatedAt: args.at })
    .where(eq(s.leads.id, closed.id));
  await tx.insert(s.leadStateTransitions).values([
    {
      leadId: closed.id,
      fromState: closed.leadState,
      toState: closed.leadState,
      systemState: closed.systemLeadState,
      cause: "merge",
      actor: args.actor,
      detail: `Closed by identity merge ${args.mergeId}: the pursuit continues on lead ${survivor.id} (${why})`,
      occurredAt: args.at,
    },
    {
      leadId: survivor.id,
      fromState: survivor.leadState,
      toState: survivor.leadState,
      systemState: survivor.systemLeadState,
      cause: "merge",
      actor: args.actor,
      detail: `Identity merge ${args.mergeId}: lead ${closed.id} closed into this one (${why}); re-evaluate on the combined evidence`,
      occurredAt: args.at,
    },
  ]);
  return { survivorId: survivor.id, closedId: closed.id };
}

export async function reopenLeadsOnUnmerge(tx: Tx, args: { mergeId: string; winnerId: string; loserId: string; actor: string; at: Date }) {
  await supersedeOpportunities(tx, [args.winnerId, args.loserId], args.at);
  const closed = await tx.select().from(s.leads).where(eq(s.leads.closedByMergeId, args.mergeId)).for("update");
  for (const lead of closed) {
    await tx
      .update(s.leads)
      .set({ status: "open", closedAt: null, closedReason: null, mergedIntoLeadId: null, closedByMergeId: null, updatedAt: args.at })
      .where(eq(s.leads.id, lead.id));
    await tx.insert(s.leadStateTransitions).values({
      leadId: lead.id,
      fromState: lead.leadState,
      toState: lead.leadState,
      systemState: lead.systemLeadState,
      cause: "unmerge",
      actor: args.actor,
      detail: `Reopened by the reversal of identity merge ${args.mergeId}; re-evaluate before relying on its state`,
      occurredAt: args.at,
    });
  }
  return closed.map((l) => l.id);
}
