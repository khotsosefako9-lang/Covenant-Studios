// The default read path for anything company-scoped. A merged company keeps its own
// rows, so reading by companies.id alone silently misses everything a cluster absorbed.
// Reads go through the identity cluster instead: any member id resolves to the root
// and then to every member.
import { type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import * as s from "./schema/index";

type Db = NodePgDatabase<typeof s>;

/** Subquery: every company id in the identity cluster of `companyId` (any member). */
export function clusterMemberIds(companyId: string): SQL {
  return sql`(select cr.company_id from company_roots cr
             where cr.root_id = (select r.root_id from company_roots r where r.company_id = ${companyId}))`;
}

/** WHERE fragment: `column` belongs to the identity cluster of `companyId`. */
export function inCompanyCluster(column: AnyPgColumn, companyId: string): SQL {
  return sql`${column} in ${clusterMemberIds(companyId)}`;
}

/** All evidence for a business, with provenance, across its identity cluster. */
export async function getCompanyEvidence(db: Db, companyId: string) {
  return db
    .select()
    .from(s.evidenceProvenance)
    .where(inCompanyCluster(s.evidenceProvenance.companyId, companyId))
    .orderBy(s.evidenceProvenance.observedAt);
}

/** All audit findings for a business across its identity cluster, with the audited company. */
export async function getCompanyFindings(db: Db, companyId: string) {
  return db
    .select({
      findingId: s.auditFindings.id,
      auditId: s.audits.id,
      auditedCompanyId: s.audits.companyId,
      checkKey: s.auditFindings.checkKey,
      status: s.auditFindings.status,
      severity: s.auditFindings.severity,
      detail: s.auditFindings.detail,
      observedAt: s.auditFindings.observedAt,
    })
    .from(s.auditFindings)
    .innerJoin(s.audits, sql`${s.audits.id} = ${s.auditFindings.auditId}`)
    .where(inCompanyCluster(s.audits.companyId, companyId))
    .orderBy(s.auditFindings.observedAt);
}

/** All signals for a business across its identity cluster. */
export async function getCompanySignals(db: Db, companyId: string) {
  return db.select().from(s.signals).where(inCompanyCluster(s.signals.companyId, companyId)).orderBy(s.signals.observedAt);
}
