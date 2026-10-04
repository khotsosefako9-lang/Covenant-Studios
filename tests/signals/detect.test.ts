// Signal detection end to end: fixture site → audit → signals, against real Postgres.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "@/audit/run";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter } from "@/fetch/limiter";
import { addCompanyManually } from "@/ingest/companies";
import { chainForEvidence, loadFreshnessConfig } from "@/provenance/chain";
import { runInvariants } from "@/quality/invariants";
import { DETECTORS } from "@/signals/detectors";
import { HumanOnlySignalError, companySignalView, detectSignalsForAudit, recordOperatorSignal } from "@/signals/detect";
import { fixture } from "../audit/helpers";
import { PG, adminUrl, createTestDb, rejects } from "../db/harness";
import { FakeClock, type Fixture, robots, serve } from "../fetch/fixture";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
let site: Fixture;
let companyId: string;
let firstAuditId: string;
let pageHtml = fixture("weak/supplier.html");
const clock = new FakeClock();
const open: { close(): Promise<void> }[] = [];

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

async function audit() {
  const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(clock), clock);
  open.push(run);
  return runAudit(db, run, { companyId, targetUrl: `${site.origin}/` });
}

describe.skipIf(!adminUrl)("signal detection end to end", () => {
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
    const a = await audit();
    expect(a.status).toBe("COMPLETED");
    firstAuditId = a.auditId;
  }, 60_000);

  afterEach(async () => {
    await Promise.all(open.splice(0).map((x) => x.close()));
  });

  afterAll(async () => {
    await site?.close();
    await teardown?.();
  });

  it("detects Opportunity signals from the audit, each resting on that audit's evidence", async () => {
    const r = await detectSignalsForAudit(db, firstAuditId);
    expect(r.created.map((c) => c.typeKey).sort()).toEqual(["catalogue_friction", "lead_response_friction", "mobile_commercial_friction", "web_underperformance"]);
    const rows = await q<{ id: string; detected_by: string; detector_ref: string; observed_at: Date; axis: string }>(
      `select sg.*, st.axis from signals sg join signal_types st on st.id = sg.signal_type_id`,
    );
    expect(rows.every((x) => x.detected_by === "rule" && x.detector_ref.endsWith(`@audit:${firstAuditId}`) && x.axis === "opportunity")).toBe(true);
    for (const sg of rows) {
      const ev = await q<{ observed_at: Date; audit_id: string }>(
        `select e.observed_at, f.audit_id from signal_evidence se join evidence e on e.id = se.evidence_id
         join audit_finding_evidence fe on fe.evidence_id = e.id join audit_findings f on f.id = fe.audit_finding_id where se.signal_id = $1`,
        [sg.id],
      );
      expect(ev.length).toBeGreaterThan(0);
      expect(ev.every((e) => e.audit_id === firstAuditId)).toBe(true);
      expect(sg.observed_at.getTime()).toBe(Math.max(...ev.map((e) => e.observed_at.getTime())));
      expect((await q(`select 1 from signal_findings where signal_id = $1`, [sg.id])).length).toBeGreaterThan(0);
      // The parameters the detector ran on are recorded with the signal.
      const [p] = await q<{ detector_params: Record<string, number> }>(`select detector_params from signals where id = $1`, [sg.id]);
      expect(p?.detector_params.max_strength).toBe(0.9);
    }
  });

  it("is idempotent per audit", async () => {
    const again = await detectSignalsForAudit(db, firstAuditId);
    expect(again).toMatchObject({ created: [], existing: 4, retracted: 0 });
    expect((await q(`select 1 from signals`)).length).toBe(4);
  });

  it("puts nothing on the Intent axis from weakness alone", async () => {
    const v = await companySignalView(db, companyId, clock.now() ? new Date(clock.now()) : new Date());
    expect(v.axes.intent).toEqual([]);
    expect(v.axes.opportunity.map((c) => c.typeKey).sort()).toEqual(["catalogue_friction", "lead_response_friction", "mobile_commercial_friction", "web_underperformance"]);
  });

  describe("human-only types", () => {
    it("refuses a detector that emits procurement_scorecard, writing nothing", async () => {
      const before = (await q(`select 1 from signals`)).length;
      DETECTORS.push({
        typeKey: "procurement_scorecard",
        rule: "test-only rogue detector",
        params: {},
        detect: (s) => ({ typeKey: "procurement_scorecard", strength: 0.9, findingIds: [s.findings[0]?.id as string], evidenceIds: s.findings.flatMap((f) => f.evidenceIds).slice(0, 1), rationale: "rogue" }),
      });
      try {
        await expect(detectSignalsForAudit(db, firstAuditId)).rejects.toBeInstanceOf(HumanOnlySignalError);
      } finally {
        DETECTORS.pop();
      }
      expect((await q(`select 1 from signals`)).length).toBe(before);
    });

    it("is refused by the database for any non-operator writer", async () => {
      for (const key of ["procurement_scorecard", "agency_fatigue"]) {
        await rejects(
          pool.query(
            `insert into signals (company_id, signal_type_id, strength, observed_at, detected_by, detector_ref)
             select $1, id, 0.9, now(), 'rule', 'sneaky' from signal_types where key = $2`,
            [companyId, key],
          ),
          PG.check,
        );
      }
    });
  });

  describe("operator-recorded intent", () => {
    it("records an attributed statement as REPORTED evidence and rests the signal on it", async () => {
      const r = await recordOperatorSignal(db, {
        companyId,
        typeKey: "agency_fatigue",
        strength: 0.7,
        basis: "Owner said on a call on 2 October that their agency missed three deadlines this year",
        actor: "Khotso",
        observedAt: new Date(clock.now()),
      });
      const chain = await chainForEvidence(db, r.evidenceId, await loadFreshnessConfig(db));
      expect(chain.claim).toMatchObject({ claimType: "REPORTED", producer: "operator", claimKey: "signal.agency_fatigue" });
      expect(chain.source).toMatchObject({ method: "operator_statement", attributedTo: "Khotso" });
    });

    it("puts the operator's signal on Intent and leaves web_underperformance on Opportunity only", async () => {
      const v = await companySignalView(db, companyId, new Date(clock.now()));
      expect(v.axes.intent.map((c) => c.typeKey)).toEqual(["agency_fatigue"]);
      expect(v.axes.opportunity.map((c) => c.typeKey)).toContain("web_underperformance");
    });
  });

  it("retracts the previous audit's signals when a newer audit no longer supports them", async () => {
    pageHtml = pageHtml.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
    clock.advance(25 * 3600 * 1000); // past the page cache, so the site is fetched again
    const second = await audit();
    expect(second.status).toBe("COMPLETED");
    const r = await detectSignalsForAudit(db, second.auditId);
    expect(r.retracted).toBe(4);
    expect(r.created.map((c) => c.typeKey).sort()).toEqual(["catalogue_friction", "lead_response_friction", "web_underperformance"]);
    const v = await companySignalView(db, companyId, new Date(clock.now()));
    const rules = v.signals.filter((x) => x.detectedBy === "rule");
    expect(rules.every((x) => x.detectorRef.endsWith(`@audit:${second.auditId}`))).toBe(true);
    expect(v.signals.map((x) => x.typeKey)).not.toContain("mobile_commercial_friction");
    // The operator's signal is not an audit's to retract.
    expect(v.signals.filter((x) => x.detectedBy === "operator").map((x) => x.typeKey)).toEqual(["agency_fatigue"]);
    const history = await (await import("@/db/company-scope")).getCompanySignalsNow(db, companyId, new Date(clock.now()), { includeRetracted: true });
    expect(history.filter((x) => x.status === "retracted")).toHaveLength(4);
    // Detecting the older audit again revives nothing.
    expect((await detectSignalsForAudit(db, firstAuditId)).retracted).toBe(0);
    expect((await companySignalView(db, companyId)).signals.filter((x) => x.detectorRef.endsWith(`@audit:${firstAuditId}`))).toEqual([]);
  });

  it("abstains on an audit that did not complete", async () => {
    const [a] = await q<{ id: string }>(
      `insert into audits (company_id, target_url, status, check_set_version, trace_id, completed_at, status_detail, page_source_record_id)
       select company_id, 'x', 'RENDER_REQUIRED', 'm0.1', 't', now(), 'shell', page_source_record_id from audits where id = $1 returning id`,
      [firstAuditId],
    );
    expect(await detectSignalsForAudit(db, a?.id as string)).toMatchObject({ status: "abstained", created: [] });
  });

  it("leaves every data-quality invariant holding", async () => {
    expect((await runInvariants(db)).filter((r) => r.status === "violated")).toEqual([]);
  });
});
