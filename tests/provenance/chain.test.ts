// End-to-end provenance: a company imported by CSV and then audited. Every stored claim
// must resolve backwards to a locatable retrieval, with nothing orphaned at any link.
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "@/audit/run";
import { getCompanySignalsNow } from "@/db/company-scope";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter } from "@/fetch/limiter";
import { importCsv } from "@/ingest/companies";
import { type FreshnessConfig, chainForEvidence, chainsForCompany, chainsForFinding, loadFreshnessConfig } from "@/provenance/chain";
import { runInvariants } from "@/quality/invariants";
import { recordInvariantRun } from "@/quality/job";
import { fixture } from "../audit/helpers";
import { PG, adminUrl, createTestDb, rejects } from "../db/harness";
import { FakeClock, type Fixture, html, robots, serve } from "../fetch/fixture";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
let site: Fixture;
let cfg: FreshnessConfig;
let companyId: string;
let csvRecordId: string;
let auditId: string;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
const DAY = 24 * 3600 * 1000;

describe.skipIf(!adminUrl)("provenance holds end to end: CSV import → audit", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
    cfg = await loadFreshnessConfig(db);

    const csv = [
      "Company Name,Website,Phone,Email,Industry,City",
      "Bay Plumbing (Pty) Ltd,bayplumbing.co.za,041 555 0101,info@bayplumbing.co.za,Plumbing,Gqeberha",
      "Coastal Pumps,coastalpumps.co.za,,,,",
      "Broken Row,not a site,,,,",
    ].join("\n");
    const imp = await importCsv(db, { content: csv, fileName: "eastern-cape-prospects.csv", actor: "Khotso" });
    if (!imp.ok) throw new Error(imp.message);
    csvRecordId = imp.report.sourceRecordId;
    companyId = imp.report.rows[0]?.companyId as string;

    const page = fixture("controls/plumber.html").replace(/https:\/\/www\.facebook\.com\/[^"]*/g, "#");
    site = await serve(
      {
        "/robots.txt": robots("User-agent: *\nAllow: /"),
        "/": (_req, res) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(page);
        },
      },
      html("sub page"),
    );
    const clock = new FakeClock();
    const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(clock), clock);
    const a = await runAudit(db, run, { companyId, targetUrl: `${site.origin}/` });
    await run.close();
    expect(a.status).toBe("COMPLETED");
    auditId = a.auditId;
  }, 60_000);

  afterAll(async () => {
    await site?.close();
    await teardown?.();
  });

  it("resolves every stored claim to a locatable retrieval with a timestamp and claim type", async () => {
    const all = await q<{ id: string }>(`select id from evidence`);
    expect(all.length).toBeGreaterThan(25);
    for (const { id } of all) {
      const c = await chainForEvidence(db, id, cfg);
      expect(c.source.location.length, id).toBeGreaterThan(0);
      expect(c.source.retrievedAt, id).toBeInstanceOf(Date);
      expect(["VERIFIED", "REPORTED"], id).toContain(c.claim.claimType);
      if (c.claim.producer === "ingest") {
        expect(c.claim.claimType).toBe("REPORTED");
        expect(c.source).toMatchObject({ id: csvRecordId, method: "csv_import", location: 'CSV file "eastern-cape-prospects.csv"', attributedTo: "Khotso" });
        expect(c.claim.locator).toMatch(/^row \d+, column "/);
      } else {
        expect(c.claim.producer).toBe("audit");
        expect(c.claim.claimType).toBe("VERIFIED");
        expect(c.source.method).toBe("http_fetch");
        expect(c.source.location).toContain(site.origin);
        expect(c.source.userAgent).toMatch(/^CovenantStudiosBot\//);
        expect(c.source.robotsRecordId).toBeTruthy();
      }
    }
  });

  it("leaves no orphan at any link", async () => {
    // Every finding's evidence, every channel's evidence, every imported row's company and claims.
    const orphans = await q(`
      select 'finding evidence' as link, fe.evidence_id::text as id from audit_finding_evidence fe left join evidence e on e.id = fe.evidence_id where e.id is null
      union all select 'channel evidence', c.id::text from contact_channels c left join evidence e on e.id = c.evidence_id where e.id is null
      union all select 'import row company', r.id::text from csv_import_rows r where r.status = 'imported' and not exists (select 1 from companies c where c.id = r.company_id)
      union all select 'import row source', r.id::text from csv_import_rows r left join source_records sr on sr.id = r.source_record_id where sr.id is null
      union all select 'robots record', sr.id::text from source_records sr left join source_records rr on rr.id = sr.robots_source_record_id where sr.robots_source_record_id is not null and rr.id is null
      union all select 'audit page record', a.id::text from audits a left join source_records sr on sr.id = a.page_source_record_id where a.status = 'COMPLETED' and sr.id is null`);
    expect(orphans).toEqual([]);
    const imported = await q<{ company_id: string }>(`select company_id from csv_import_rows where status = 'imported'`);
    for (const { company_id } of imported) {
      const [name] = await q<{ source_record_id: string }>(`select source_record_id from evidence where company_id = $1 and claim_key = 'company.name'`, [company_id]);
      expect(name?.source_record_id).toBe(csvRecordId);
    }
    expect((await q<{ status: string }>(`select status from csv_import_rows where row_number = 4`))[0]?.status).toBe("invalid");
  });

  it("traces every FAIL finding to the exact page or probe it was observed in", async () => {
    const fails = await q<{ id: string }>(`select id from audit_findings where audit_id = $1 and status = 'FAIL'`, [auditId]);
    expect(fails.length).toBeGreaterThan(0);
    for (const { id } of fails) {
      const { finding, chains } = await chainsForFinding(db, id, cfg);
      expect(chains.length, finding.checkKey).toBeGreaterThan(0);
      for (const c of chains) expect(c.findings.map((f) => f.findingId)).toContain(id);
    }
  });

  it("computes freshness at read time against the Phase 0 windows", async () => {
    const [auditEv] = await q<{ id: string; observed_at: Date }>(`select id, observed_at from evidence where producer = 'audit' limit 1`);
    const [phoneEv] = await q<{ id: string; observed_at: Date }>(`select id, observed_at from evidence where claim_key = 'company.phone'`);
    const at = (base: Date, days: number) => new Date(base.getTime() + days * DAY);
    const auditNow = await chainForEvidence(db, auditEv?.id as string, cfg, at(auditEv?.observed_at as Date, 10));
    expect(auditNow.freshness).toMatchObject({ dataClass: "website_audit", windowDays: 90, state: "fresh", recency: 1 });
    const auditLater = await chainForEvidence(db, auditEv?.id as string, cfg, at(auditEv?.observed_at as Date, 100));
    expect(auditLater.freshness).toMatchObject({ state: "stale", windowDays: 90 });
    const phoneLater = await chainForEvidence(db, phoneEv?.id as string, cfg, at(phoneEv?.observed_at as Date, 100));
    expect(phoneLater.freshness).toMatchObject({ dataClass: "contact_channel", windowDays: 180, state: "fresh" });
    // Nothing about freshness is stored: the same row reads differently at different times.
    expect(await q(`select column_name from information_schema.columns where table_schema = 'public' and column_name in ('freshness', 'is_fresh', 'is_stale', 'decays_at')`)).toEqual([]);
  });

  it("reads signal strength decayed from observed_at, never stored", async () => {
    const [type] = await q<{ id: string }>(`select id from signal_types where key = 'matchday_scramble'`);
    const observed = new Date("2026-09-01T00:00:00Z");
    await pool.query(`insert into signals (company_id, signal_type_id, strength, observed_at, detected_by, detector_ref) values ($1, $2, 0.8, $3, 'rule', 'test')`, [
      companyId,
      type?.id,
      observed,
    ]);
    const now = new Date(observed.getTime() + 30 * DAY);
    const [sig] = await getCompanySignalsNow(db, companyId, now);
    expect(sig).toMatchObject({ typeKey: "matchday_scramble", decayDays: 60, strengthNow: 0.4 });
    const [later] = await getCompanySignalsNow(db, companyId, new Date(observed.getTime() + 90 * DAY));
    expect(later?.strengthNow).toBe(0);
    await pool.query(`delete from signals`);
  });

  it("lists a company's claims through its identity cluster", async () => {
    const chains = await chainsForCompany(db, companyId, cfg, "company.");
    expect(chains.map((c) => c.claim.claimKey).sort()).toEqual(["company.domain", "company.email", "company.industry", "company.location", "company.name", "company.phone"]);
  });

  describe("the database, not application code, refuses broken provenance", () => {
    it("rejects evidence with no source record or a non-existent one", async () => {
      const insert = (srId: string | null) =>
        pool.query(
          `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, value, observed_at) values ($1, $2, 'audit', 'x', 'x', 'VERIFIED', 'x', now())`,
          [companyId, srId],
        );
      await rejects(insert(null), PG.notNull);
      await rejects(insert("00000000-0000-0000-0000-000000000000"), PG.foreignKey);
    });

    it("refuses to delete a source record that evidence cites", async () => {
      await rejects(pool.query(`delete from source_records where id = $1`, [csvRecordId]), PG.foreignKey);
    });

    it("refuses to rewrite a claim after the fact", async () => {
      // An audit claim, so moving it to the CSV record would be a real change.
      const [e] = await q<{ id: string }>(`select id from evidence where producer = 'audit' limit 1`);
      await rejects(pool.query(`update evidence set value = 'edited' where id = $1`, [e?.id]), PG.check);
      await rejects(pool.query(`update evidence set source_record_id = $2 where id = $1`, [e?.id, csvRecordId]), PG.check);
    });
  });

  describe("data-quality invariants", () => {
    it("all hold on the imported and audited data, and outreach invariants report not built", async () => {
      const results = await runInvariants(db);
      expect(results.filter((r) => r.status === "violated")).toEqual([]);
      expect(results.filter((r) => r.status === "not_applicable").map((r) => r.key).sort()).toEqual([
        "no_approved_message_to_suppressed",
        "outreach_claims_have_evidence",
      ]);
      expect(results.filter((r) => r.status === "ok").length).toBeGreaterThanOrEqual(14);
    });

    it("the nightly job records its results in system_events", async () => {
      await recordInvariantRun(db);
      const [ev] = await q<{ level: string; event: string; context: { key: string; status: string }[] }>(
        `select level, event, context from system_events where stage = 'data_quality' order by occurred_at desc limit 1`,
      );
      expect(ev).toMatchObject({ level: "info", event: "invariants_ok" });
      expect(ev?.context.map((r) => r.key)).toContain("evidence_has_source_record");
    });

    it("detect each kind of violation they claim to", async () => {
      const [csvRec] = await q<{ id: string }>(`select id from source_records where id = $1`, [csvRecordId]);
      const [pageRec] = await q<{ id: string }>(`select page_source_record_id as id from audits where id = $1`, [auditId]);
      const ins = (producer: string, type: string, srId: string, extra = "") =>
        pool.query(
          `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, value, inference_rule, observed_at) values ($1, $2, $3, 'x', 'x', $4, ${type === "UNKNOWN" ? "null" : "'v'"}, ${type === "INFERRED" ? "'rule'" : "null"}, now() ${extra}) returning id`,
          [companyId, srId, producer, type],
        );
      await ins("ingest", "INFERRED", csvRec?.id as string);
      await ins("audit", "REPORTED", pageRec?.id as string);
      await ins("audit", "VERIFIED", csvRec?.id as string);
      await pool.query(`update contact_channels set verification = 'verified', last_verified_at = now() - interval '200 days' where kind = 'phone'`);
      await pool.query(`update audits set page_source_record_id = null where id = $1`, [auditId]).catch(() => {});

      const violated = Object.fromEntries((await runInvariants(db)).filter((r) => r.status === "violated").map((r) => [r.key, r]));
      expect(Object.keys(violated).sort()).toEqual(
        ["audit_evidence_matches_retrieval", "completed_audit_has_page", "no_fresh_mark_past_window", "no_inferred_evidence_yet", "writer_claim_types"].sort(),
      );
      expect(violated.no_inferred_evidence_yet?.count).toBe(1);
      expect(violated.no_fresh_mark_past_window?.sample[0]).toContain("phone");
    });
  });
});
