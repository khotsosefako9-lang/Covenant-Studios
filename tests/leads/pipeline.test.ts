// End to end: fixture site → pipeline (audit → detect → derive → gate) → lead state, against
// real Postgres. This is where the control set and the weak fixture meet the gate.
import { writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getCompanyOpportunities } from "@/db/company-scope";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter } from "@/fetch/limiter";
import { confirmDuplicate, unmerge } from "@/identity/resolution";
import { addCompanyManually } from "@/ingest/companies";
import { LeadActionError, clearLeadOverride, liftDisqualification, overrideLeadState, recordOperatorDisqualification, setChannelSuitability } from "@/leads/actions";
import { findClusterLead } from "@/leads/evaluate";
import { runPipeline } from "@/pipeline/run";
import { runInvariants } from "@/quality/invariants";
import { fixture } from "../audit/helpers";
import { PG, adminUrl, createTestDb, rejects } from "../db/harness";
import { FakeClock, type Fixture, type Handler, html, robots, serve } from "../fetch/fixture";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
const clock = new FakeClock();
const sites: Fixture[] = [];
const runs: { close(): Promise<void> }[] = [];
let n = 0;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];
// Tests never reach the live internet: external profile links are removed from served pages.
const offline = (h: string) => h.replace(/https:\/\/www\.(facebook|instagram|linkedin|youtube)\.com\/[^"']*/g, "#");
const page = (body: () => string): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(offline(body()));
};

async function site(body: () => string, extra: Record<string, Handler> = {}) {
  const f = await serve({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": page(body), ...extra }, html("<p>sub page</p>"));
  sites.push(f);
  return f;
}

async function company(name: string) {
  n++;
  const r = await addCompanyManually(db, { input: { name, website: `fixture${n}.co.za` }, actor: "test" });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.companyId;
}

async function pipeline(companyId: string, f: Fixture | null) {
  const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(clock), clock);
  runs.push(run);
  return runPipeline(db, run, companyId, { skipAudit: !f, targetUrl: f ? `${f.origin}/` : undefined, now: () => new Date(clock.now()) });
}

const CONTROLS = [
  ["plumber.html", "Bay Plumbing"],
  ["industrial.html", "EC Safety Supply"],
  ["rugby.html", "Eastern Cape Rugby Union"],
  ["lawfirm.html", "Mbeki & Partners"],
  ["nextjs-ssr.html", "Karoo Leather Goods"],
  ["wordpress.html", "Reel Coast Studios"],
] as const;

const catalogue: Handler = (_req, res) => {
  res.writeHead(200, { "content-type": "application/pdf", "content-length": String(48_000_000) });
  res.write("%PDF");
  res.end();
};

describe.skipIf(!adminUrl)("the pipeline and the gate, end to end", () => {
  const outcome: Record<string, { state: string; gate: string; basis: string | null; opportunities: string[]; potential: number | null; reasons: string[] }> = {};
  let supplierId: string;
  let supplierHtml = fixture("weak/supplier.html");
  let supplierSite: Fixture;

  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
    for (const [file, name] of CONTROLS) {
      const id = await company(name);
      const r = await pipeline(id, await site(() => fixture(`controls/${file}`)));
      const e = r.evaluation;
      outcome[file] = { state: e.state, gate: e.outcome.gateStatus, basis: e.outcome.gateBasis, opportunities: e.outcome.detail.opportunities, potential: e.outcome.commercialPotentialZar, reasons: e.outcome.reasons };
    }
    supplierId = await company("Bayside Valves");
    supplierSite = await site(() => supplierHtml, { "/files/bayside-full-catalogue-2019.pdf": catalogue });
    const r = await pipeline(supplierId, supplierSite);
    const e = r.evaluation;
    outcome["weak/supplier.html"] = { state: e.state, gate: e.outcome.gateStatus, basis: e.outcome.gateBasis, opportunities: e.outcome.detail.opportunities, potential: e.outcome.commercialPotentialZar, reasons: e.outcome.reasons };
    // For the phase report.
    if (process.env.GATE_REPORT) writeFileSync(process.env.GATE_REPORT, JSON.stringify(outcome, null, 2));
  }, 120_000);

  afterEach(async () => {
    await Promise.all(runs.splice(0).map((r) => r.close()));
  });

  afterAll(async () => {
    await Promise.all(sites.map((s) => s.close()));
    await teardown?.();
  });

  describe("what the gate does to the control set and the weak fixture", () => {
    it("holds five controls at WATCH_WEAKNESS_ONLY: nothing weak, nothing intended", () => {
      for (const file of ["plumber.html", "industrial.html", "lawfirm.html", "nextjs-ssr.html", "wordpress.html"]) {
        expect(outcome[file], file).toMatchObject({ state: "WATCH_WEAKNESS_ONLY", gate: "FAILED", opportunities: [] });
        expect(outcome[file]?.reasons, file).toContain("No weakness found either");
      }
    });

    it("qualifies the rugby union without an operator: its sponsorship offer is an Intent signal", () => {
      expect(outcome["rugby.html"]).toMatchObject({ state: "COMMERCIAL_OPPORTUNITY", gate: "PASSED", basis: "buying_signal", opportunities: ["sports_platform"] });
    });

    it("holds the weak supplier at WATCH_WEAKNESS_ONLY: a rebuild opportunity, no intent, no evidenced capacity", () => {
      expect(outcome["weak/supplier.html"]).toMatchObject({ state: "WATCH_WEAKNESS_ONLY", gate: "FAILED", opportunities: ["website_rebuild"], potential: null });
      expect(outcome["weak/supplier.html"]?.reasons).toContain("Entry price R5500 (custom_business_website) is not evidenced as payable: 0 of 2 capacity markers PRESENT");
    });

    it("records each lead's creation and its first evaluation as transitions, with cause and time", async () => {
      const ts = await q<{ cause: string; from_state: string | null; to_state: string; actor: string; occurred_at: Date }>(
        `select t.* from lead_state_transitions t join leads l on l.id = t.lead_id where l.company_id = $1 order by t.occurred_at, t.created_at`,
        [supplierId],
      );
      expect(ts.map((t) => [t.cause, t.from_state, t.to_state, t.actor])).toEqual([
        ["created", null, "PENDING_EVALUATION", "system"],
        ["evaluation", "PENDING_EVALUATION", "WATCH_WEAKNESS_ONLY", "system"],
      ]);
      expect(ts.every((t) => t.occurred_at instanceof Date)).toBe(true);
    });
  });

  describe("re-evaluation", () => {
    it("records a new evaluation but no transition when nothing changed", async () => {
      const before = (await q(`select 1 from lead_state_transitions`)).length;
      const r = await pipeline(supplierId, null);
      expect(r.evaluation).toMatchObject({ previousState: "WATCH_WEAKNESS_ONLY", state: "WATCH_WEAKNESS_ONLY" });
      expect((await q(`select 1 from lead_state_transitions`)).length).toBe(before);
      expect((await q(`select 1 from lead_evaluations e join leads l on l.id = e.lead_id where l.company_id = $1`, [supplierId])).length).toBe(2);
    });

    it("re-derives opportunities in the same run after a re-audit, so none is ever stale", async () => {
      supplierHtml = supplierHtml.replace("<head>", '<head><meta name="viewport" content="width=device-width, initial-scale=1">');
      clock.advance(25 * 3600 * 1000);
      await pipeline(supplierId, supplierSite);
      const stale = (await runInvariants(db)).find((x) => x.key === "current_opportunity_signals_active");
      expect(stale?.status).toBe("ok");
      const signals = await q<{ key: string }>(
        `select st.key from opportunities o join opportunity_signals os on os.opportunity_id = o.id join signals sg on sg.id = os.signal_id
         join signal_types st on st.id = sg.signal_type_id where o.superseded_at is null and o.company_id = $1`,
        [supplierId],
      );
      expect(signals.map((x) => x.key)).not.toContain("mobile_commercial_friction");
    });
  });

  describe("human override", () => {
    it("requires an actor and a reason, and refuses OUTREACH_READY before Phase 13", async () => {
      await expect(overrideLeadState(db, { companyId: supplierId, state: "COMMERCIAL_OPPORTUNITY", actor: "Khotso", reason: " " })).rejects.toBeInstanceOf(LeadActionError);
      await expect(overrideLeadState(db, { companyId: supplierId, state: "OUTREACH_READY", actor: "Khotso", reason: "Looks great" })).rejects.toThrow(/Phase 13/);
    });

    it("keeps the system's state beside the human one, and keeps recomputing it", async () => {
      await overrideLeadState(db, { companyId: supplierId, state: "COMMERCIAL_OPPORTUNITY", actor: "Khotso", reason: "Owner told me they are replacing the site this quarter", now: new Date(clock.now()) });
      let lead = await findClusterLead(db, supplierId);
      expect(lead).toMatchObject({ leadState: "COMMERCIAL_OPPORTUNITY", systemLeadState: "WATCH_WEAKNESS_ONLY", stateOverrideBy: "Khotso", intentGateStatus: "PASSED", intentGateBasis: "human_override", systemGateStatus: "FAILED" });
      const r = await pipeline(supplierId, null);
      expect(r.evaluation).toMatchObject({ state: "COMMERCIAL_OPPORTUNITY", systemState: "WATCH_WEAKNESS_ONLY", overridden: true });
      lead = await findClusterLead(db, supplierId);
      expect(lead?.intentGateBasis).toBe("human_override");
    });

    it("clears back to the system's state and gate", async () => {
      await clearLeadOverride(db, { companyId: supplierId, actor: "Khotso", reason: "Owner went quiet", now: new Date(clock.now()) });
      expect(await findClusterLead(db, supplierId)).toMatchObject({ leadState: "WATCH_WEAKNESS_ONLY", stateOverride: null, intentGateStatus: "FAILED", intentGateBasis: null });
      const causes = await q<{ cause: string; detail: string }>(
        `select t.cause, t.detail from lead_state_transitions t join leads l on l.id = t.lead_id where l.company_id = $1 and t.cause in ('human_override', 'override_cleared') order by t.occurred_at, t.created_at`,
        [supplierId],
      );
      expect(causes).toEqual([
        { cause: "human_override", detail: "Owner told me they are replacing the site this quarter" },
        { cause: "override_cleared", detail: "Owner went quiet" },
      ]);
    });
  });

  describe("channel suitability is not disqualification", () => {
    it("marks a fit business unsuitable for cold outreach without changing its state", async () => {
      const rugby = (await q<{ company_id: string }>(`select l.company_id from leads l where l.lead_state = 'COMMERCIAL_OPPORTUNITY'`))[0]?.company_id as string;
      await setChannelSuitability(db, { companyId: rugby, value: "cold_outreach_disallowed", actor: "Khotso", reason: "Union sponsorship goes through a formal procurement cycle" });
      const r = await pipeline(rugby, null);
      expect(r.evaluation.state).toBe("COMMERCIAL_OPPORTUNITY");
      expect(await findClusterLead(db, rugby)).toMatchObject({ outreachChannelSuitability: "cold_outreach_disallowed", channelSuitabilitySetBy: "Khotso" });
    });
  });

  describe("disqualifiers", () => {
    it("lets an operator record a human-only disqualifier on attributed evidence, and lift it", async () => {
      const r = await recordOperatorDisqualification(db, {
        companyId: supplierId,
        disqualifierKey: "zero_revenue_speculative",
        basis: "Owner said on 5 October the business has not traded since 2023",
        actor: "Khotso",
        now: new Date(clock.now()),
      });
      expect(r.evaluation.state).toBe("DISQUALIFIED");
      const [ev] = await q<{ producer: string; claim_type: string }>(
        `select e.producer, e.claim_type from lead_disqualifications d join evidence e on e.id = d.evidence_id where d.id = $1`,
        [r.disqualificationId],
      );
      expect(ev).toEqual({ producer: "operator", claim_type: "REPORTED" });
      expect((await liftDisqualification(db, { disqualificationId: r.disqualificationId, actor: "Khotso", reason: "Recorded on the wrong company", now: new Date(clock.now()) })).state).toBe("WATCH_WEAKNESS_ONLY");
    });

    it("never lets code fire a human-only disqualifier", async () => {
      const [lead] = await q<{ id: string }>(`select id from leads where company_id = $1`, [supplierId]);
      const [auditEvidence] = await q<{ id: string }>(`select id from evidence where producer = 'audit' and company_id = $1 limit 1`, [supplierId]);
      await rejects(
        pool.query(
          `insert into lead_disqualifications (lead_id, disqualifier_id, evidence_id, recorded_by) select $1, id, $2, 'rule:x' from disqualifiers where key = 'uncapitalised_micro_operator'`,
          [lead?.id, auditEvidence?.id],
        ),
        PG.check,
      );
      await rejects(pool.query(`update disqualifiers set detection_check_key = 'commercial.procurement_portal' where key = 'zero_revenue_speculative'`), PG.check, "disqualifiers_human_only_not_detected");
    });

    it("fires bureaucratic_procurement on a published tender portal, and retracts it when the portal is gone", async () => {
      let body = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Sundays River Water Board</title></head><body><h1>Sundays River Water Board</h1><p>${"We supply bulk water to farms and towns across the valley, and you can contact us about your account. ".repeat(4)}</p><a href="/tenders/">Current tenders</a><a href="tel:0425550100">042 555 0100</a></body></html>`;
      const f = await site(() => body);
      const id = await company("Sundays River Water Board");
      const first = await pipeline(id, f);
      expect(first.evaluation.state).toBe("DISQUALIFIED");
      const [d] = await q<{ recorded_by: string; retracted_at: Date | null }>(`select d.recorded_by, d.retracted_at from lead_disqualifications d join leads l on l.id = d.lead_id where l.company_id = $1`, [id]);
      expect(d?.recorded_by).toMatch(/^rule:commercial\.procurement_portal@audit:/);

      body = body.replace('<a href="/tenders/">Current tenders</a>', "");
      clock.advance(25 * 3600 * 1000);
      const second = await pipeline(id, f);
      expect(second.evaluation.state).toBe("WATCH_WEAKNESS_ONLY");
      const rows = await q<{ retracted_at: Date | null; retraction_reason: string }>(`select d.retracted_at, d.retraction_reason from lead_disqualifications d join leads l on l.id = d.lead_id where l.company_id = $1`, [id]);
      expect(rows.every((r) => r.retracted_at && r.retraction_reason === "The latest audit no longer evidences it")).toBe(true);
    });
  });

  describe("one business, one open lead", () => {
    it("closes one of two open leads on merge, keeping the human decision, and reopens it on unmerge", async () => {
      const dup = await company("Bayside Valves (Pty) Ltd");
      await pipeline(dup, await site(() => fixture("weak/supplier.html"), { "/files/bayside-full-catalogue-2019.pdf": catalogue }));
      // The company that will be merged away carries the only human override.
      await overrideLeadState(db, { companyId: dup, state: "COMMERCIAL_OPPORTUNITY", actor: "Khotso", reason: "Met the owner at the trade show", now: new Date(clock.now()) });
      const [a, b] = supplierId < dup ? [supplierId, dup] : [dup, supplierId];
      // Ingest already proposed the pair on name similarity; a human confirms it.
      const [cand] = await q<{ id: string }>(`select id from company_duplicate_candidates where company_a_id = $1 and company_b_id = $2 limit 1`, [a, b]);
      const merged = await confirmDuplicate(db, { candidateId: cand?.id as string, keepCompanyId: supplierId, actor: "Khotso", reason: "Same business" });
      if (!merged.ok) throw new Error(merged.message);
      const open = await q<{ company_id: string; state_override: string }>(`select company_id, state_override from leads where status = 'open' and company_id in ($1, $2)`, [supplierId, dup]);
      expect(open).toEqual([{ company_id: dup, state_override: "COMMERCIAL_OPPORTUNITY" }]);
      expect(merged.leadSurvivor).toBe((await findClusterLead(db, supplierId))?.id);

      // Evaluating through either company reaches the one surviving lead, with combined evidence.
      const r = await pipeline(supplierId, null);
      expect(r.evaluation.leadId).toBe(merged.leadSurvivor);
      expect((await runInvariants(db)).find((x) => x.key === "one_open_lead_per_cluster")?.status).toBe("ok");
      expect((await getCompanyOpportunities(db, supplierId)).length).toBeGreaterThan(0);

      const un = await unmerge(db, { mergeId: merged.mergeId, actor: "Khotso", reason: "Different owners after all" });
      if (!un.ok) throw new Error(un.message);
      expect(un.leadsReopened).toEqual([merged.leadClosed]);
      expect((await q(`select 1 from leads where status = 'open' and company_id in ($1, $2)`, [supplierId, dup])).length).toBe(2);
    });
  });

  it("leaves every data-quality invariant holding", async () => {
    expect((await runInvariants(db)).filter((r) => r.status === "violated")).toEqual([]);
  });

  it("the Phase 10 invariants detect each kind of violation they claim to", async () => {
    // Two open leads in one cluster: merge two companies behind the merge rule's back.
    const x = await company("Corrupt One");
    const y = await company("Corrupt Two");
    await pipeline(x, null);
    await pipeline(y, null);
    await pool.query(`update companies set status = 'merged', merged_into_id = $1 where id = $2`, [x, y]);
    // A state that disagrees with the last recorded transition and evaluation.
    const [rugby] = await q<{ id: string }>(`select id from leads where lead_state = 'COMMERCIAL_OPPORTUNITY' and state_override is null`);
    await pool.query(`update leads set lead_state = 'DISQUALIFIED', system_lead_state = 'DISQUALIFIED' where id = $1`, [rugby?.id]);
    // A qualified lead whose opportunities are gone.
    const [supplier] = await q<{ id: string }>(`select id from leads where company_id = $1`, [supplierId]);
    await pool.query(
      `update leads set system_lead_state = 'COMMERCIAL_OPPORTUNITY', lead_state = 'COMMERCIAL_OPPORTUNITY', system_gate_status = 'PASSED', system_gate_basis = 'buying_signal',
         intent_gate_status = 'PASSED', intent_gate_basis = 'buying_signal', intent_gate_evaluated_at = now() where id = $1`,
      [supplier?.id],
    );
    await pool.query(`update opportunities set superseded_at = now() where company_id = $1`, [supplierId]);
    // A detection rule pointing at a check that is not a commercial-offer check.
    await pool.query(`update disqualifiers set detection_check_key = 'tech.title' where key = 'bureaucratic_procurement'`);

    const violated = (await runInvariants(db)).filter((r) => r.status === "violated").map((r) => r.key).sort();
    expect(violated).toEqual(
      [
        "disqualifier_detection_check_valid",
        "lead_state_matches_last_transition",
        "lead_system_matches_last_evaluation",
        "one_open_lead_per_cluster",
        "system_disqualified_has_disqualification",
        "system_qualified_has_opportunity",
      ].sort(),
    );
  });
});
