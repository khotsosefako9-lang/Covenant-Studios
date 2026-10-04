// Nightly data-quality invariants (Phase 0 "Data-quality invariants", plus provenance
// invariants for what M0 has built). Each is a query for violations: zero rows = holds.
// Results are reported, not alerted on.
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as s from "@/db/schema/index";

type Db = NodePgDatabase<typeof s>;

export interface Invariant {
  key: string;
  description: string;
  /** Returns one row per violation: an id and a short explanation. Null = not built yet. */
  violations: ReturnType<typeof sql> | null;
}

export interface InvariantResult {
  key: string;
  description: string;
  status: "ok" | "violated" | "not_applicable";
  count: number;
  sample: string[];
}

const contactWindow = sql`(select (value->>'contact_channel')::int from settings where key = 'freshness_refresh_days')`;

export const INVARIANTS: Invariant[] = [
  // --- Phase 0 ---
  {
    key: "evidence_has_source_record",
    description: "No evidence row without a source record (also enforced by NOT NULL + foreign key).",
    violations: sql`select e.id::text, 'source record ' || coalesce(e.source_record_id::text, 'null') || ' missing' as detail
      from evidence e left join source_records sr on sr.id = e.source_record_id where sr.id is null`,
  },
  {
    key: "one_active_company_per_domain",
    description: "No company with two active records sharing a domain.",
    violations: sql`select domain as id, count(*) || ' active companies' as detail from companies
      where status = 'active' and domain is not null group by domain having count(*) > 1`,
  },
  {
    key: "score_in_range",
    description: "No score outside 0–100 (totals, axes, dimension contributions).",
    violations: sql`select id::text, 'total ' || total as detail from scores where total not between 0 and 100
      or coalesce(opportunity_axis, 0) not between 0 and 100 or coalesce(intent_axis, 0) not between 0 and 100
      union all select score_id::text, dimension || ' contribution ' || contribution from score_dimensions where contribution not between 0 and 100`,
  },
  {
    key: "confidence_in_range",
    description: "No confidence outside 0–1 (scores, evidence, audit findings, signals strength).",
    violations: sql`select id::text, 'score confidence ' || confidence as detail from scores where confidence not between 0 and 1 or evidence_quality not between 0 and 1
      union all select id::text, 'evidence confidence ' || confidence from evidence where confidence not between 0 and 1
      union all select id::text, 'finding confidence ' || confidence from audit_findings where confidence not between 0 and 1
      union all select id::text, 'signal strength ' || strength from signals where strength not between 0 and 1`,
  },
  {
    key: "qualified_lead_score_current",
    description: "No lead in a qualified state whose current score predates its company's latest completed audit.",
    violations: sql`select l.id::text, 'score ' || sc.computed_at || ' before audit ' || la.completed_at as detail
      from leads l join scores sc on sc.id = l.current_score_id
      join lateral (select max(a.completed_at) as completed_at from audits a
        join company_roots r on r.company_id = a.company_id
        where r.root_id = (select root_id from company_roots where company_id = l.company_id) and a.status = 'COMPLETED') la on true
      where l.lead_state in ('COMMERCIAL_OPPORTUNITY', 'OUTREACH_READY') and la.completed_at > sc.computed_at`,
  },
  {
    key: "no_fresh_mark_past_window",
    description:
      "No record marked fresh past its refresh window. Freshness itself is computed, never stored; the only stored freshness mark is a contact channel's 'verified' state (180 days).",
    violations: sql`select id::text, kind || ' ' || value || ' verified ' || coalesce(last_verified_at, created_at) as detail
      from contact_channels where verification = 'verified'
      and coalesce(last_verified_at, created_at) < now() - make_interval(days => ${contactWindow})`,
  },
  {
    key: "outreach_claims_have_evidence",
    description: "No outreach message containing a claim without a linked evidence id. Outreach is not built (M3).",
    violations: null,
  },
  {
    key: "no_approved_message_to_suppressed",
    description: "No approved message to an address on the suppression list. Outreach is not built (M3).",
    violations: null,
  },
  // --- Provenance (Phase 7) ---
  {
    key: "source_record_locatable",
    description: "Every source record behind evidence names where it came from: a URL, a file name, or an attributed person.",
    violations: sql`select distinct sr.id::text, sr.retrieval_method || ' with no URL, file name or attribution' as detail
      from evidence e join source_records sr on sr.id = e.source_record_id
      where (sr.retrieval_method = 'http_fetch' and sr.url is null)
         or (sr.retrieval_method = 'csv_import' and sr.file_name is null)
         or (sr.retrieval_method in ('manual_entry', 'operator_statement') and sr.attributed_to is null)`,
  },
  {
    key: "writer_claim_types",
    description: "Each writer uses its claim type: ingest and operator write REPORTED (or UNKNOWN), the audit writes VERIFIED.",
    violations: sql`select id::text, producer || ' wrote ' || claim_type as detail from evidence
      where (producer in ('ingest', 'operator') and claim_type not in ('REPORTED', 'UNKNOWN'))
         or (producer = 'audit' and claim_type <> 'VERIFIED')`,
  },
  {
    key: "no_inferred_evidence_yet",
    description: "Nothing in M0 writes INFERRED evidence yet; any INFERRED row has no known writer.",
    violations: sql`select id::text, producer || ' wrote INFERRED ' || claim_key as detail from evidence where claim_type = 'INFERRED'`,
  },
  {
    key: "audit_evidence_matches_retrieval",
    description: "Audit evidence was written by the audit producer, against an HTTP retrieval, observed no earlier than that retrieval.",
    violations: sql`select e.id::text, 'audit evidence on ' || sr.retrieval_method || ' observed ' || e.observed_at || ' fetched ' || sr.fetched_at as detail
      from evidence e join source_records sr on sr.id = e.source_record_id
      where e.producer = 'audit' and (sr.retrieval_method <> 'http_fetch' or e.observed_at < sr.fetched_at - interval '1 second')`,
  },
  {
    key: "finding_evidence_same_company",
    description: "Evidence behind an audit finding belongs to the audited company's identity cluster.",
    violations: sql`select fe.audit_finding_id::text, 'evidence ' || e.id || ' belongs to another company' as detail
      from audit_finding_evidence fe join audit_findings f on f.id = fe.audit_finding_id
      join audits a on a.id = f.audit_id join evidence e on e.id = fe.evidence_id
      join company_roots ra on ra.company_id = a.company_id join company_roots re on re.company_id = e.company_id
      where ra.root_id <> re.root_id`,
  },
  {
    key: "fail_findings_cite_evidence",
    description: "Every FAIL finding cites at least one evidence row.",
    violations: sql`select f.id::text, f.check_key || ' FAIL with no evidence' as detail from audit_findings f
      where f.status = 'FAIL' and not exists (select 1 from audit_finding_evidence fe where fe.audit_finding_id = f.id)`,
  },
  {
    key: "completed_audit_has_page",
    description: "Every completed or triaged audit names the page retrieval its result came from.",
    violations: sql`select id::text, status || ' audit without page record' as detail from audits
      where status in ('COMPLETED', 'RENDER_REQUIRED', 'NO_CONTENT') and page_source_record_id is null`,
  },
  {
    key: "company_name_evidenced",
    description: "Every imported company's name is backed by REPORTED evidence from its import.",
    violations: sql`select c.id::text, c.display_name || ' has no company.name evidence' as detail from companies c
      where not exists (select 1 from evidence e where e.company_id = c.id and e.claim_key = 'company.name')`,
  },
];

const SAMPLE = 5;

export async function runInvariants(db: Db): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  for (const inv of INVARIANTS) {
    if (!inv.violations) {
      results.push({ key: inv.key, description: inv.description, status: "not_applicable", count: 0, sample: [] });
      continue;
    }
    const rows = (await db.execute<{ id: string; detail: string }>(inv.violations)).rows;
    results.push({
      key: inv.key,
      description: inv.description,
      status: rows.length ? "violated" : "ok",
      count: rows.length,
      sample: rows.slice(0, SAMPLE).map((r) => `${r.id}: ${r.detail}`),
    });
  }
  return results;
}
