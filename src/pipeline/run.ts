// The pipeline: audit → detect → derive → gate, as one ordered operation per business.
// Running the steps by hand is still possible, but this is the path the benchmark uses, and
// evaluation re-runs detection and derivation itself, so a stale opportunity can never feed
// the gate (or, later, a brief).
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { type AuditOutcome, runAudit } from "@/audit/run";
import type * as s from "@/db/schema/index";
import type { FetchRun } from "@/fetch/fetcher";
import { type LeadEvaluation, evaluateLead, rootOf } from "@/leads/evaluate";

type Db = NodePgDatabase<typeof s>;

export interface PipelineResult {
  companyId: string;
  audit: AuditOutcome | null;
  evaluation: LeadEvaluation;
}

/**
 * Audits the business (its identity cluster's root company) through the fetch layer, then
 * evaluates its lead. `skipAudit` re-evaluates on stored audits only (no network).
 */
export async function runPipeline(
  db: Db,
  fetchRun: FetchRun | null,
  companyId: string,
  opts: { skipAudit?: boolean; targetUrl?: string; traceId?: string; now?: () => Date } = {},
): Promise<PipelineResult> {
  const root = await rootOf(db, companyId);
  let audit: AuditOutcome | null = null;
  if (!opts.skipAudit) {
    if (!fetchRun) throw new Error("An audit needs a fetch run");
    audit = await runAudit(db, fetchRun, { companyId: root, targetUrl: opts.targetUrl, traceId: opts.traceId });
  }
  const evaluation = await evaluateLead(db, root, opts.now?.() ?? new Date());
  return { companyId: root, audit, evaluation };
}
