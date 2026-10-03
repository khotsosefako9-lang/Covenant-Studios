import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCompanyEvidence, getCompanyFindings, getCompanySignals } from "@/db/company-scope";
import { confirmDuplicate, deferDuplicate, getIdentityCluster, rejectDuplicate, unmerge } from "@/identity/resolution";
import { importCsv } from "@/ingest/companies";
import { PG, adminUrl, createTestDb, rejects } from "./harness";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
  const rows = await q<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${text}`);
  return rows[0] as T;
};
const idOf = async (table: string, key: string) => (await one<{ id: string }>(`select id from ${table} where key = $1`, [key])).id;

// Tables a merge or unmerge is allowed to change. Everything else must be untouched.
const IDENTITY_TABLES = new Set([
  "companies",
  "company_aliases",
  "company_duplicate_candidates",
  "company_merges",
  "company_non_matches",
  "duplicate_resolutions",
]);

async function snapshotData(): Promise<Record<string, unknown[]>> {
  const tables = await q<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  const out: Record<string, unknown[]> = {};
  for (const { table_name } of tables) {
    if (IDENTITY_TABLES.has(table_name)) continue;
    out[table_name] = (await q<{ r: unknown }>(`select row_to_json(t)::text as r from ${table_name} t order by 1`)).map((x) => x.r);
  }
  return out;
}

const pair = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

/** A company with a full set of rows in every layer the pipeline will write. */
async function richCompany(domain: string, name: string) {
  const c = (
    await one<{ id: string }>(
      `insert into companies (domain, display_name, normalised_name, created_via) values ($1, $2, lower($2), 'csv') returning id`,
      [domain, name],
    )
  ).id;
  await pool.query(`insert into company_aliases (company_id, kind, value, normalised_value) values ($1, 'legal_name', $2, lower($2))`, [
    c,
    `${name} (Pty) Ltd`,
  ]);
  const fetchSr = (
    await one<{ id: string }>(
      `insert into source_records (source_id, company_id, retrieval_method, url, fetched_at, fetch_outcome, http_status, raw_content, purpose, host, user_agent)
       values ($1, $2, 'http_fetch', $3, now(), 'OK', 200, '<html></html>', 'page', 'test', 'test') returning id`,
      [await idOf("sources", "website_fetch"), c, `https://${domain}/`],
    )
  ).id;
  const opSr = (
    await one<{ id: string }>(
      `insert into source_records (source_id, company_id, retrieval_method, fetched_at, fetch_outcome, attributed_to, raw_content)
       values ($1, $2, 'manual_entry', now(), 'NOT_APPLICABLE', 'Khotso', '{}') returning id`,
      [await idOf("sources", "manual_entry"), c],
    )
  ).id;
  const verified = (
    await one<{ id: string }>(
      `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, value, observed_at)
       values ($1, $2, 'audit', 'homepage.primary_cta', 'No primary CTA above the fold', 'VERIFIED', 'absent', now()) returning id`,
      [c, fetchSr],
    )
  ).id;
  const reported = (
    await one<{ id: string }>(
      `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, value, observed_at)
       values ($1, $2, 'ingest', 'company.phone', 'Phone as reported', 'REPORTED', '041 123 4567', now()) returning id`,
      [c, opSr],
    )
  ).id;
  await pool.query(
    `insert into contact_channels (company_id, kind, value, normalised_value, evidence_id) values ($1, 'phone', '041 123 4567', $2, $3)`,
    [c, "+27411234567", reported],
  );
  const audit = (
    await one<{ id: string }>(
      `insert into audits (company_id, target_url, status, check_set_version, trace_id, completed_at)
       values ($1, $2, 'COMPLETED', 'v1', 'trace', now()) returning id`,
      [c, `https://${domain}/`],
    )
  ).id;
  const finding = (
    await one<{ id: string }>(
      `insert into audit_findings (audit_id, check_key, check_version, status, severity, detail, observed_at)
       values ($1, 'cta.above_fold', '1', 'FAIL', 'medium', 'No CTA', now()) returning id`,
      [audit],
    )
  ).id;
  await pool.query(`insert into audit_finding_evidence (audit_finding_id, evidence_id) values ($1, $2)`, [finding, verified]);
  await pool.query(`insert into finding_verifications (audit_finding_id, verdict, verified_by) values ($1, 'confirmed_true', 'Khotso')`, [finding]);
  const signal = (
    await one<{ id: string }>(
      `insert into signals (company_id, signal_type_id, strength, observed_at, detected_by, detector_ref)
       values ($1, $2, 0.7, now(), 'rule', 'cta_rule') returning id`,
      [c, await idOf("signal_types", "web_underperformance")],
    )
  ).id;
  await pool.query(`insert into signal_evidence (signal_id, evidence_id) values ($1, $2)`, [signal, verified]);
  await pool.query(`insert into signal_findings (signal_id, audit_finding_id) values ($1, $2)`, [signal, finding]);
  const opp = (
    await one<{ id: string }>(
      `insert into opportunities (company_id, opportunity_type_id, covenant_service_id, rank, rationale, inference_rule)
       values ($1, $2, $3, 1, 'No CTA suggests conversion friction', 'cta_absent => conversion_landing_page') returning id`,
      [c, await idOf("opportunity_types", "conversion_landing_page"), await idOf("covenant_services", "campaign_conversion_page")],
    )
  ).id;
  await pool.query(`insert into opportunity_findings (opportunity_id, audit_finding_id) values ($1, $2)`, [opp, finding]);
  const lead = (await one<{ id: string }>(`insert into leads (company_id) values ($1) returning id`, [c])).id;
  await pool.query(
    `insert into scores (lead_id, weight_set_id, audit_id, total, confidence, evidence_quality)
     select $1, id, $2, 42, 0.5, 0.6 from weight_sets where is_active`,
    [lead, audit],
  );
  return { id: c, evidence: [verified, reported] };
}

async function candidate(x: string, y: string, basis = "normalised_name", value = "acme") {
  const [a, b] = pair(x, y);
  return (
    await one<{ id: string }>(
      `insert into company_duplicate_candidates (company_a_id, company_b_id, match_basis, matched_value) values ($1, $2, $3, $4) returning id`,
      [a, b, basis, value],
    )
  ).id;
}

describe.skipIf(!adminUrl)("identity resolution against real PostgreSQL", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
  }, 60_000);

  afterAll(async () => {
    await teardown?.();
  });

  describe("merge and unmerge", () => {
    let winner: Awaited<ReturnType<typeof richCompany>>;
    let loser: Awaited<ReturnType<typeof richCompany>>;
    let candId: string;
    let secondCandId: string;
    let before: Record<string, unknown[]>;
    let companiesBefore: unknown[];
    let aliasesBefore: unknown[];
    let mergeId: string;

    beforeAll(async () => {
      winner = await richCompany("acme.co.za", "Acme Supplies");
      loser = await richCompany("acmesupplies.co.za", "Acme Suplies");
      candId = await candidate(winner.id, loser.id, "normalised_name", "acme supplies ~ acme suplies");
      secondCandId = await candidate(winner.id, loser.id, "phone", "+27411234567");
      before = await snapshotData();
      companiesBefore = await q(`select id, domain, display_name, normalised_name, status, merged_into_id from companies order by id`);
      aliasesBefore = await q(`select * from company_aliases order by id`);
    });

    it("merges identity without moving or deleting any other row", async () => {
      const r = await confirmDuplicate(db, { candidateId: candId, keepCompanyId: winner.id, actor: "Khotso", reason: "Same business, typo in name" });
      if (!r.ok) throw new Error(r.message);
      mergeId = r.mergeId;
      expect(r).toMatchObject({ winnerId: winner.id, loserId: loser.id });

      expect(await snapshotData()).toEqual(before);
      const [l] = await q<{ status: string; merged_into_id: string; domain: string }>(
        `select status, merged_into_id, domain from companies where id = $1`,
        [loser.id],
      );
      expect(l).toEqual({ status: "merged", merged_into_id: winner.id, domain: "acmesupplies.co.za" });
    });

    it("surfaces the merged company's evidence, findings and signals in cluster reads", async () => {
      for (const via of [winner.id, loser.id]) {
        const ev = await getCompanyEvidence(db, via);
        expect(ev.map((e) => e.evidenceId).sort()).toEqual([...winner.evidence, ...loser.evidence].sort());
        expect(ev.every((e) => e.retrievedAt instanceof Date)).toBe(true);
        const findings = await getCompanyFindings(db, via);
        expect(findings.map((f) => f.auditedCompanyId).sort()).toEqual([winner.id, loser.id].sort());
        expect((await getCompanySignals(db, via)).map((x) => x.companyId).sort()).toEqual([winner.id, loser.id].sort());
      }
      // A direct read by the winner's id alone misses the absorbed company: the failure mode the view exists for.
      expect((await q(`select 1 from evidence where company_id = $1`, [winner.id])).length).toBe(2);
    });

    it("preserves the losing domain and names as aliases of the winner", async () => {
      const aliases = await q<{ kind: string; value: string }>(
        `select kind, value from company_aliases where company_id = $1 and merge_id = $2 order by kind::text, value`,
        [winner.id, mergeId],
      );
      expect(aliases).toEqual([
        { kind: "merged_domain", value: "acmesupplies.co.za" },
        { kind: "merged_identity", value: "Acme Suplies" },
        { kind: "merged_identity", value: "Acme Suplies (Pty) Ltd" },
      ]);
    });

    it("keeps every provenance chain intact and readable through the identity cluster", async () => {
      const cluster = await getIdentityCluster(db, loser.id);
      expect(cluster?.rootId).toBe(winner.id);
      expect(cluster?.memberIds.sort()).toEqual([winner.id, loser.id].sort());
      const prov = await q<{ evidence_id: string; source_url: string | null; retrieved_at: Date; retrieval_method: string }>(
        `select p.evidence_id, p.source_url, p.retrieved_at, p.retrieval_method
         from evidence_provenance p join company_roots r on r.company_id = p.company_id where r.root_id = $1`,
        [winner.id],
      );
      expect(prov.map((p) => p.evidence_id).sort()).toEqual([...winner.evidence, ...loser.evidence].sort());
      for (const p of prov) {
        expect(p.retrieved_at).toBeInstanceOf(Date);
        if (p.retrieval_method === "http_fetch") expect(p.source_url).toMatch(/^https:\/\//);
      }
      const chain = await q(
        `select f.id from audit_findings f
         join audits a on a.id = f.audit_id
         join audit_finding_evidence fe on fe.audit_finding_id = f.id
         join evidence e on e.id = fe.evidence_id
         join source_records sr on sr.id = e.source_record_id
         join company_roots r on r.company_id = a.company_id
         where r.root_id = $1`,
        [winner.id],
      );
      expect(chain).toHaveLength(2);
    });

    it("resolves every open candidate for the pair and records the decision", async () => {
      const cands = await q<{ id: string; status: string; resolved_by: string }>(
        `select id, status, resolved_by from company_duplicate_candidates where id in ($1, $2)`,
        [candId, secondCandId],
      );
      expect(cands.every((c) => c.status === "confirmed_duplicate" && c.resolved_by === "Khotso")).toBe(true);
      const hist = await q<{ action: string; actor: string; reason: string; merge_id: string }>(
        `select action, actor, reason, merge_id from duplicate_resolutions where candidate_id = $1`,
        [candId],
      );
      expect(hist).toEqual([{ action: "confirm", actor: "Khotso", reason: "Same business, typo in name", merge_id: mergeId }]);
    });

    it("resolves the merged domain to the winner on later import", async () => {
      const r = await importCsv(db, { content: "name,website\nAcme Suplies,https://acmesupplies.co.za\n", fileName: "later.csv", actor: "Khotso" });
      if (!r.ok) throw new Error(r.message);
      expect(r.report.rows[0]).toMatchObject({ status: "matched_existing", companyId: winner.id });
      await pool.query(`delete from csv_import_rows; delete from source_records where retrieval_method = 'csv_import'`);
    });

    it("refuses to merge a company that is already merged", async () => {
      const third = (
        await one<{ id: string }>(
          `insert into companies (domain, display_name, normalised_name, created_via) values ('third.co.za', 'Third', 'third', 'manual') returning id`,
        )
      ).id;
      const c = await candidate(loser.id, third);
      expect(await confirmDuplicate(db, { candidateId: c, keepCompanyId: third, actor: "K", reason: "r" })).toMatchObject({
        ok: false,
        code: "company_not_active",
      });
      await rejects(pool.query(`update companies set status = 'merged', merged_into_id = $1 where id = $2`, [loser.id, third]), PG.check);
    });

    it("unmerges back to exactly the state before the merge", async () => {
      const r = await unmerge(db, { mergeId, actor: "Khotso", reason: "Different branches, separate owners" });
      if (!r.ok) throw new Error(r.message);
      expect(r).toMatchObject({ restoredCompanyId: loser.id, aliasesRemoved: 3 });

      expect(await snapshotData()).toEqual(before);
      const companiesAfter = await q(
        `select id, domain, display_name, normalised_name, status, merged_into_id from companies where id in ($1, $2) order by id`,
        [winner.id, loser.id],
      );
      expect(companiesAfter).toEqual(
        (companiesBefore as { id: string }[]).filter((c) => c.id === winner.id || c.id === loser.id),
      );
      expect(await q(`select * from company_aliases where company_id in ($1, $2) order by id`, [winner.id, loser.id])).toEqual(
        (aliasesBefore as { company_id: string }[]).filter((a) => a.company_id === winner.id || a.company_id === loser.id),
      );
      expect((await getIdentityCluster(db, loser.id))?.rootId).toBe(loser.id);
      expect((await getCompanyEvidence(db, winner.id)).map((e) => e.evidenceId).sort()).toEqual([...winner.evidence].sort());
      expect((await getCompanyFindings(db, loser.id)).map((f) => f.auditedCompanyId)).toEqual([loser.id]);
    });

    it("keeps the merge history and reopens the candidates for a fresh decision", async () => {
      const [m] = await q<{ unmerged_by: string; unmerge_reason: string; unmerged_at: Date | null }>(
        `select unmerged_by, unmerge_reason, unmerged_at from company_merges where id = $1`,
        [mergeId],
      );
      expect(m?.unmerged_by).toBe("Khotso");
      expect(m?.unmerged_at).toBeInstanceOf(Date);
      const hist = await q<{ action: string }>(`select action from duplicate_resolutions where candidate_id = $1 order by acted_at, action`, [candId]);
      expect(hist.map((h) => h.action)).toEqual(["confirm", "unmerge"]);
      const [c] = await q<{ status: string; resolved_by: string | null }>(`select status, resolved_by from company_duplicate_candidates where id = $1`, [candId]);
      expect(c).toEqual({ status: "proposed", resolved_by: null });
      expect(await unmerge(db, { mergeId, actor: "K", reason: "again" })).toMatchObject({ ok: false, code: "already_unmerged" });
    });

    it("allows the pair to be merged again after an unmerge", async () => {
      const r = await confirmDuplicate(db, { candidateId: candId, keepCompanyId: loser.id, actor: "Khotso", reason: "Reconsidered: same owner" });
      expect(r).toMatchObject({ ok: true, winnerId: loser.id, loserId: winner.id });
      expect(await snapshotData()).toEqual(before);
    });
  });

  describe("reject", () => {
    it("records a permanent non-match that blocks the pair from being proposed again", async () => {
      const a = await richCompany("covenantkreative.co.za", "Covenant Kreative");
      const b = await richCompany("covenantconsultancy.co.za", "Covenant Consultancy");
      const c1 = await candidate(a.id, b.id, "normalised_name", "covenant");
      const c2 = await candidate(a.id, b.id, "phone", "+27411234567");
      const before = await snapshotData();
      const r = await rejectDuplicate(db, { candidateId: c1, actor: "Khotso", reason: "Separate SA marketing businesses" });
      expect(r.ok).toBe(true);
      const [x, y] = pair(a.id, b.id);
      const [nm] = await q<{ decided_by: string; reason: string }>(
        `select decided_by, reason from company_non_matches where company_a_id = $1 and company_b_id = $2`,
        [x, y],
      );
      expect(nm).toEqual({ decided_by: "Khotso", reason: "Separate SA marketing businesses" });
      expect((await q<{ status: string }>(`select status from company_duplicate_candidates where id in ($1, $2)`, [c1, c2])).map((s) => s.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      await rejects(candidate(a.id, b.id, "email", "info@covenant.co.za"), PG.check);
      expect(await confirmDuplicate(db, { candidateId: c1, keepCompanyId: a.id, actor: "K", reason: "r" })).toMatchObject({
        ok: false,
        code: "candidate_rejected",
      });
      expect(await snapshotData()).toEqual(before);
    });
  });

  describe("defer", () => {
    it("parks a candidate with a recorded reason and still allows a later decision", async () => {
      const a = await richCompany("bay.co.za", "Bay Pumps");
      const b = await richCompany("baypumps.co.za", "Bay Pumping");
      const c = await candidate(a.id, b.id);
      expect(await deferDuplicate(db, { candidateId: c, actor: "Khotso", reason: "Need to call them" })).toEqual({ ok: true });
      const [row] = await q<{ status: string; resolved_by: string }>(`select status, resolved_by from company_duplicate_candidates where id = $1`, [c]);
      expect(row).toEqual({ status: "deferred", resolved_by: "Khotso" });
      expect((await rejectDuplicate(db, { candidateId: c, actor: "Khotso", reason: "Called: different owners" })).ok).toBe(true);
      const hist = await q<{ action: string; reason: string }>(`select action, reason from duplicate_resolutions where candidate_id = $1 order by acted_at`, [c]);
      expect(hist).toEqual([
        { action: "defer", reason: "Need to call them" },
        { action: "reject", reason: "Called: different owners" },
      ]);
    });
  });

  describe("input checks", () => {
    it("requires an actor and a reason, and a kept company from the pair", async () => {
      const a = await richCompany("one.co.za", "One");
      const b = await richCompany("two.co.za", "Two");
      const c = await candidate(a.id, b.id);
      expect(await confirmDuplicate(db, { candidateId: c, keepCompanyId: a.id, actor: "", reason: "x" })).toMatchObject({ code: "actor_missing" });
      expect(await rejectDuplicate(db, { candidateId: c, actor: "K", reason: "  " })).toMatchObject({ code: "reason_missing" });
      expect(await deferDuplicate(db, { candidateId: c, actor: "K", reason: "" })).toMatchObject({ code: "reason_missing" });
      expect(await confirmDuplicate(db, { candidateId: c, keepCompanyId: c, actor: "K", reason: "x" })).toMatchObject({ code: "keep_not_in_pair" });
      expect(await confirmDuplicate(db, { candidateId: a.id, keepCompanyId: a.id, actor: "K", reason: "x" })).toMatchObject({ code: "not_found" });
    });
  });
});
