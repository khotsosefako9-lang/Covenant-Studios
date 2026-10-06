// End to end: fixture site → audit → signals → opportunities, against real Postgres.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "@/audit/run";
import { capacityProfile } from "@/commercial/capacity";
import { deriveCompanyOpportunities } from "@/commercial/opportunities";
import { getCompanyOpportunities } from "@/db/company-scope";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter } from "@/fetch/limiter";
import { addCompanyManually } from "@/ingest/companies";
import { runInvariants } from "@/quality/invariants";
import { detectSignalsForAudit, loadAuditSnapshot, recordOperatorSignal } from "@/signals/detect";
import { fixture } from "../audit/helpers";
import { PG, adminUrl, createTestDb, rejects } from "../db/harness";
import { FakeClock, type Fixture, robots, serve } from "../fetch/fixture";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
let site: Fixture;
let companyId: string;
let pageHtml = fixture("weak/supplier.html");
const clock = new FakeClock();
const open: { close(): Promise<void> }[] = [];
const now = () => new Date(clock.now());

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

async function auditAndDetect() {
  const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(clock), clock);
  open.push(run);
  const a = await runAudit(db, run, { companyId, targetUrl: `${site.origin}/` });
  expect(a.status).toBe("COMPLETED");
  await detectSignalsForAudit(db, a.auditId);
  return a.auditId;
}

describe.skipIf(!adminUrl)("opportunity derivation end to end", () => {
  let firstAuditId: string;

  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
    site = await serve({
      "/robots.txt": robots("User-agent: *\nAllow: /"),
      "/": (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(pageHtml);
      },
      "/files/bayside-full-catalogue-2019.pdf": (_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(48_000_000) });
        res.write("%PDF");
      },
    });
    const c = await addCompanyManually(db, { input: { name: "Bayside Valves", website: "baysidevalves.co.za" }, actor: "test" });
    if (!c.ok) throw new Error("company");
    companyId = c.companyId;
    firstAuditId = await auditAndDetect();
  }, 60_000);

  afterEach(async () => {
    await Promise.all(open.splice(0).map((x) => x.close()));
  });

  afterAll(async () => {
    await site?.close();
    await teardown?.();
  });

  it("derives one INFERRED opportunity for the weak supplier, not one per weakness", async () => {
    const r = await deriveCompanyOpportunities(db, companyId, now());
    expect(r.status).toBe("derived");
    const ops = await getCompanyOpportunities(db, companyId);
    expect(ops.map((o) => [o.opportunity.rank, o.typeKey, o.serviceKey, o.opportunity.claimType])).toEqual([
      [1, "website_rebuild", "custom_business_website", "INFERRED"],
    ]);
    const [o] = ops;
    expect(Number(o?.opportunity.relevance)).toBeGreaterThan(0.9);
    expect(Number(o?.opportunity.confidence)).toBeGreaterThan(0.4);
    expect(Number(o?.opportunity.confidence)).toBeLessThanOrEqual(0.6); // never above the INFERRED factor
    expect(o?.opportunity.inferenceRule).toMatch(/^opportunity-derivation\/1: /);
    expect(o?.opportunity.rationale).toContain("lead_response_friction");
  });

  it("rests on named signals and, through them, on this audit's findings and evidence", async () => {
    const [o] = await getCompanyOpportunities(db, companyId);
    const signals = await q<{ key: string }>(
      `select st.key from opportunity_signals os join signals sg on sg.id = os.signal_id join signal_types st on st.id = sg.signal_type_id where os.opportunity_id = $1 order by 1`,
      [o?.opportunity.id],
    );
    expect(signals.map((x) => x.key)).toEqual(["catalogue_friction", "mobile_commercial_friction", "web_underperformance"]);
    const chain = await q<{ audit_id: string; claim_type: string; source_url: string }>(
      `select f.audit_id, p.claim_type, p.source_url from opportunity_findings ofn
       join audit_findings f on f.id = ofn.audit_finding_id
       join audit_finding_evidence fe on fe.audit_finding_id = f.id
       join evidence_provenance p on p.evidence_id = fe.evidence_id where ofn.opportunity_id = $1`,
      [o?.opportunity.id],
    );
    expect(chain.length).toBeGreaterThan(0);
    expect(chain.every((c) => c.audit_id === firstAuditId && c.claim_type === "VERIFIED" && c.source_url.startsWith(site.origin))).toBe(true);
  });

  it("is a no-op when nothing has changed", async () => {
    const before = await getCompanyOpportunities(db, companyId);
    const r = await deriveCompanyOpportunities(db, companyId, now());
    expect(r).toMatchObject({ status: "unchanged", superseded: 0 });
    expect((await getCompanyOpportunities(db, companyId)).map((x) => x.opportunity.id)).toEqual(before.map((x) => x.opportunity.id));
  });

  it("adds a second, ranked opportunity only when an independent signal points elsewhere", async () => {
    await recordOperatorSignal(db, { companyId, typeKey: "manual_order_handling", strength: 0.7, basis: "Orders are taken by email and phoned back, per the owner on 3 October", actor: "Khotso", observedAt: now() });
    const r = await deriveCompanyOpportunities(db, companyId, now());
    expect(r).toMatchObject({ status: "derived", superseded: 1 });
    const ops = await getCompanyOpportunities(db, companyId);
    expect(ops.map((o) => [o.opportunity.rank, o.typeKey, o.serviceKey])).toEqual([
      [1, "website_rebuild", "custom_business_website"],
      [2, "payment_checkout", "full_revenue_business_site"],
    ]);
    // An operator signal rests on REPORTED evidence and no audit finding.
    expect(await q(`select 1 from opportunity_findings where opportunity_id = $1`, [ops[1]?.opportunity.id])).toEqual([]);
    // History is kept.
    expect((await getCompanyOpportunities(db, companyId, { includeSuperseded: true })).length).toBe(3);
  });

  it("re-derives after a re-audit retracts a signal, superseding the old set", async () => {
    pageHtml = pageHtml.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
    clock.advance(25 * 3600 * 1000);
    await auditAndDetect();
    // Before re-deriving, the current set rests on a retracted signal: the invariant says so.
    const stale = (await runInvariants(db)).find((x) => x.key === "current_opportunity_signals_active");
    expect(stale?.status).toBe("violated");
    expect((await deriveCompanyOpportunities(db, companyId, now())).status).toBe("derived");
    const [o] = await getCompanyOpportunities(db, companyId);
    const keys = await q<{ key: string }>(
      `select st.key from opportunity_signals os join signals sg on sg.id = os.signal_id join signal_types st on st.id = sg.signal_type_id where os.opportunity_id = $1 order by 1`,
      [o?.opportunity.id],
    );
    expect(keys.map((k) => k.key)).not.toContain("mobile_commercial_friction");
  });

  it("refuses an opportunity whose INFERRED claim has no relevance or confidence", async () => {
    await rejects(
      pool.query(
        `insert into opportunities (company_id, opportunity_type_id, rank, rationale, inference_rule) select $1, id, 1, 'r', 'rule' from opportunity_types where key = 'branding'`,
        [companyId],
      ),
      PG.check,
      "opportunities_inferred_scored",
    );
  });

  it("keeps capacity out of it: the supplier's capacity profile is separate and feeds no opportunity", async () => {
    const loaded = await loadAuditSnapshot(db, firstAuditId);
    const profile = capacityProfile(loaded?.snapshot.findings ?? []);
    expect(profile.present.length + profile.absent.length + profile.unknown.length).toBe(6);
    const used = await q(`select 1 from opportunity_findings ofn join audit_findings f on f.id = ofn.audit_finding_id where f.check_key like 'capacity.%'`);
    expect(used).toEqual([]);
  });

  it("leaves every data-quality invariant holding", async () => {
    expect((await runInvariants(db)).filter((r) => r.status === "violated")).toEqual([]);
  });

  it("the Phase 9 invariants detect each kind of violation they claim to", async () => {
    const [cap] = await q<{ id: string }>(`select id from audit_findings where check_key like 'capacity.%' limit 1`);
    const [sg] = await q<{ id: string }>(`select id from signals where status = 'active' limit 1`);
    await pool.query(`insert into signal_findings (signal_id, audit_finding_id) values ($1, $2)`, [sg?.id, cap?.id]);
    await pool.query(
      `insert into opportunities (company_id, opportunity_type_id, rank, relevance, confidence, rationale, inference_rule) select $1, id, 9, 0.5, 0.3, 'r', 'rule' from opportunity_types where key = 'branding'`,
      [companyId],
    );
    const other = await addCompanyManually(db, { input: { name: "Elsewhere Ltd", website: "elsewhere.co.za" }, actor: "test" });
    if (!other.ok) throw new Error("company");
    const o = (await getCompanyOpportunities(db, companyId)).find((x) => x.typeKey === "website_rebuild");
    const [foreign] = await q<{ id: string }>(
      `insert into signals (company_id, signal_type_id, strength, observed_at, detected_by, detector_ref) select $1, id, 0.5, now(), 'operator', 'x' from signal_types where key = 'brand_upgrade_need' returning id`,
      [other.companyId],
    );
    await pool.query(`insert into opportunity_signals (opportunity_id, signal_id) values ($1, $2)`, [o?.opportunity.id, foreign?.id]);

    const violated = (await runInvariants(db)).filter((r) => r.status === "violated").map((r) => r.key);
    expect(violated.sort()).toEqual(
      ["capacity_not_signal", "opportunity_rests_on_signal", "opportunity_support_same_company", "signal_cites_evidence"].sort(),
    );
  });
});
