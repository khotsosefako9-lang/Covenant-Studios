import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "@/db/seed";
import { PG, adminUrl, createTestDb, rejects } from "./harness";

let pool: Pool;
let teardown: () => Promise<void>;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
  const rows = await q<T>(text, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}`);
  return rows[0] as T;
};
const idOf = async (table: string, key: string) =>
  (await one<{ id: string }>(`select id from ${table} where key = $1`, [key])).id;

let seq = 0;
async function company(domain: string | null = null, name = "Acme Supplies") {
  seq += 1;
  const d = domain ?? `acme${seq}.co.za`;
  return (
    await one<{ id: string }>(
      `insert into companies (domain, display_name, normalised_name, created_via) values ($1, $2, lower($2), 'manual') returning id`,
      [d, name],
    )
  ).id;
}
async function fetchRecord(companyId: string, url = "https://acme.co.za/") {
  return (
    await one<{ id: string }>(
      `insert into source_records (source_id, company_id, retrieval_method, url, fetched_at, fetch_outcome, http_status)
       values ($1, $2, 'http_fetch', $3, now(), 'ok', 200) returning id`,
      [await idOf("sources", "website_fetch"), companyId, url],
    )
  ).id;
}
async function evidenceRow(companyId: string, srId: string, claimType = "VERIFIED", extra: { value?: string | null; rule?: string } = {}) {
  return (
    await one<{ id: string }>(
      `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, value, inference_rule, observed_at)
       values ($1, $2, 'audit', 'homepage.primary_cta', 'No primary CTA above the fold', $3, $4, $5, now()) returning id`,
      [companyId, srId, claimType, extra.value === undefined ? "absent" : extra.value, extra.rule ?? null],
    )
  ).id;
}
async function lead(companyId: string) {
  return (await one<{ id: string }>(`insert into leads (company_id) values ($1) returning id`, [companyId])).id;
}
async function score(leadId: string, total = 50) {
  const ws = await one<{ id: string }>(`select id from weight_sets where is_active`);
  return (
    await one<{ id: string }>(
      `insert into scores (lead_id, weight_set_id, total, confidence, evidence_quality) values ($1, $2, $3, 0.5, 0.5) returning id`,
      [leadId, ws.id, total],
    )
  ).id;
}

describe.skipIf(!adminUrl)("M0 schema against real PostgreSQL", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
  }, 60_000);

  afterAll(async () => {
    await teardown?.();
  });

  describe("migration", () => {
    it("creates every table and the provenance view from a clean database", async () => {
      const tables = await q<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
      );
      expect(tables).toHaveLength(46);
      const names = tables.map((t) => t.table_name);
      for (const t of ["companies", "evidence", "source_records", "audits", "audit_findings", "signals", "opportunities", "scores", "judgements", "weight_sets", "benchmark_cases"]) {
        expect(names).toContain(t);
      }
      expect(names).not.toContain("outreach_messages");
      await one(`select 1 from information_schema.views where table_name = 'evidence_provenance'`);
    });
  });

  describe("configuration seed", () => {
    it("loads the 16 services with published prices only where documented", async () => {
      const rows = await q<{ key: string; published: boolean; price_low_zar: number | null; revenue_model: string }>(
        `select key, published, price_low_zar, revenue_model from covenant_services`,
      );
      expect(rows).toHaveLength(16);
      const unpublished = rows.filter((r) => !r.published).map((r) => r.key).sort();
      expect(unpublished).toEqual(["enterprise_growth_retainer", "key_account_outreach_architecture", "onsite_revenue_leak_audit"]);
      expect(rows.filter((r) => !r.published).every((r) => r.price_low_zar === null)).toBe(true);
      const matchday = rows.find((r) => r.key === "matchday_sla_retainer");
      expect(matchday?.revenue_model).toBe("recurring");
    });

    it("maps every opportunity type, including the case-study types, to existing services", async () => {
      const unmapped = await q(
        `select ot.key from opportunity_types ot left join opportunity_type_services m on m.opportunity_type_id = ot.id where m.opportunity_type_id is null`,
      );
      expect(unmapped).toEqual([]);
      const caseStudy = await q<{ type: string; service: string }>(
        `select ot.key as type, cs.key as service from opportunity_types ot
         join opportunity_type_services m on m.opportunity_type_id = ot.id
         join covenant_services cs on cs.id = m.covenant_service_id
         where ot.origin = 'case_study' order by ot.key, m.preference`,
      );
      expect(caseStudy).toEqual([
        { type: "client_portal", service: "full_revenue_business_site" },
        { type: "client_portal", service: "sports_platform_build" },
        { type: "payment_checkout", service: "full_revenue_business_site" },
        { type: "rfq_system", service: "custom_business_website" },
        { type: "rfq_system", service: "full_revenue_business_site" },
      ]);
      expect((await q(`select 1 from opportunity_types`)).length).toBe(20);
    });

    it("seeds the Phase 0 weights as an active, operator-adjustable weight set", async () => {
      const ws = await one<{ w_buying_signal: string; w_digital_opportunity: string; sum: string }>(
        `select w_buying_signal, w_digital_opportunity,
           w_buying_signal + w_icp_fit + w_digital_opportunity + w_service_fit + w_commercial_potential + w_contactability + w_evidence_quality as sum
         from weight_sets where is_active`,
      );
      expect(ws.w_buying_signal).toBe("0.2200");
      expect(ws.w_digital_opportunity).toBe("0.1500");
      expect(Number(ws.sum)).toBe(1);
    });

    it("loads triggers, friction signals and benchmark categories as evaluation data only", async () => {
      expect((await q(`select 1 from signal_types where kind = 'documented_trigger'`)).length).toBe(5);
      expect((await q(`select 1 from signal_types where kind = 'friction'`)).length).toBe(15);
      await one(`select 1 from signal_types where key = 'procurement_scorecard' and human_only`);
      const dist = await q<{ expected_verdict: string; n: number }>(
        `select expected_verdict, count(*)::int as n from benchmark_categories group by 1 order by 1`,
      );
      expect(dist).toEqual([
        { expected_verdict: "YES", n: 7 },
        { expected_verdict: "MAYBE", n: 4 },
        { expected_verdict: "NO", n: 5 },
      ]);
      expect((await q(`select 1 from companies c join benchmark_cases b on b.company_id = c.id`)).length).toBe(0);
    });

    it("leaves undocumented settings NOT_CONFIGURED", async () => {
      const s = await one<{ value: unknown }>(`select value from settings where key = 'delivery_slots_total'`);
      expect(s.value).toBeNull();
    });

    it("is idempotent", async () => {
      const before = await one<{ n: number }>(`select count(*)::int as n from opportunity_type_services`);
      await seed(db);
      const after = await one<{ n: number }>(`select count(*)::int as n from opportunity_type_services`);
      expect(after.n).toBe(before.n);
      expect((await q(`select 1 from weight_sets`)).length).toBe(1);
    });
  });

  describe("weight sets", () => {
    it("rejects weights that do not sum to 1", async () => {
      await rejects(
        pool.query(
          `insert into weight_sets (name, version, w_buying_signal, w_icp_fit, w_digital_opportunity, w_service_fit, w_commercial_potential, w_contactability, w_evidence_quality)
           values ('bad', 1, 0.5, 0.5, 0.5, 0, 0, 0, 0)`,
        ),
        PG.check,
        "weight_sets_sum_to_one",
      );
    });

    it("allows only one active set", async () => {
      await rejects(
        pool.query(
          `insert into weight_sets (name, version, is_active, w_buying_signal, w_icp_fit, w_digital_opportunity, w_service_fit, w_commercial_potential, w_contactability, w_evidence_quality)
           values ('other', 1, true, 0.22, 0.18, 0.15, 0.15, 0.12, 0.10, 0.08)`,
        ),
        PG.unique,
        "weight_sets_single_active",
      );
    });
  });

  describe("company identity", () => {
    it("keeps domain unique among active companies but allows name collisions", async () => {
      await company("covenantkreative.co.za", "Covenant Kreative");
      await company("covenantdigital.co.za", "Covenant Kreative");
      await rejects(company("covenantkreative.co.za", "Someone Else"), PG.unique, "companies_active_domain");
    });

    it("requires normalised domains", async () => {
      await rejects(company("www.example.co.za"), PG.check, "companies_domain_normalised");
      await rejects(company("Example.co.za"), PG.check, "companies_domain_normalised");
      await rejects(company("https://example.co.za"), PG.check, "companies_domain_normalised");
    });

    it("records possible duplicates separately, ordered and unresolved until a human acts", async () => {
      const [a, b] = [await company(), await company()].sort();
      await pool.query(
        `insert into company_duplicate_candidates (company_a_id, company_b_id, match_basis, matched_value, similarity) values ($1, $2, 'normalised_name', 'acme supplies', 1)`,
        [a, b],
      );
      await rejects(
        pool.query(
          `insert into company_duplicate_candidates (company_a_id, company_b_id, match_basis, matched_value) values ($1, $2, 'phone', '+27410000000')`,
          [b, a],
        ),
        PG.check,
        "company_duplicate_candidates_ordered",
      );
      await rejects(
        pool.query(`update company_duplicate_candidates set status = 'confirmed_duplicate' where company_a_id = $1`, [a]),
        PG.check,
        "company_duplicate_candidates_resolution",
      );
    });

    it("represents a merge without deleting the merged identity", async () => {
      const keep = await company("keep.co.za");
      const gone = await company("gone.co.za");
      await rejects(pool.query(`update companies set status = 'merged' where id = $1`, [gone]), PG.check, "companies_merge_consistent");
      await pool.query(`update companies set status = 'merged', merged_into_id = $2 where id = $1`, [gone, keep]);
      await company("gone.co.za");
    });
  });

  describe("provenance", () => {
    it("cannot insert evidence without a source record", async () => {
      const c = await company();
      await rejects(
        pool.query(
          `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, observed_at) values ($1, null, 'audit', 'k', 'c', 'VERIFIED', now())`,
          [c],
        ),
        PG.notNull,
      );
      await rejects(
        pool.query(
          `insert into evidence (company_id, source_record_id, producer, claim_key, claim, claim_type, observed_at) values ($1, gen_random_uuid(), 'audit', 'k', 'c', 'VERIFIED', now())`,
          [c],
        ),
        PG.foreignKey,
      );
    });

    it("enforces the claim taxonomy rules", async () => {
      const c = await company();
      const sr = await fetchRecord(c);
      await rejects(evidenceRow(c, sr, "INFERRED"), PG.check, "evidence_inferred_has_rule");
      await evidenceRow(c, sr, "INFERRED", { rule: "catalogue_pdf + no_search => browsing friction" });
      await rejects(evidenceRow(c, sr, "UNKNOWN", { value: "R20m" }), PG.check, "evidence_unknown_has_no_value");
      await evidenceRow(c, sr, "UNKNOWN", { value: null });
    });

    it("requires a URL for fetched sources and attribution for operator statements", async () => {
      const c = await company();
      const src = await idOf("sources", "human_operator");
      await rejects(
        pool.query(
          `insert into source_records (source_id, company_id, retrieval_method, fetched_at, fetch_outcome) values ($1, $2, 'http_fetch', now(), 'ok')`,
          [src, c],
        ),
        PG.check,
        "source_records_fetch_has_url",
      );
      await rejects(
        pool.query(
          `insert into source_records (source_id, company_id, retrieval_method, fetched_at, fetch_outcome) values ($1, $2, 'operator_statement', now(), 'not_applicable')`,
          [src, c],
        ),
        PG.check,
        "source_records_human_attributed",
      );
    });

    it("keeps evidence immutable and allows supersession only", async () => {
      const c = await company();
      const sr = await fetchRecord(c);
      const e1 = await evidenceRow(c, sr);
      const e2 = await evidenceRow(c, sr);
      await rejects(pool.query(`update evidence set value = 'present' where id = $1`, [e1]), PG.check);
      await pool.query(`update evidence set superseded_by_id = $2 where id = $1`, [e1, e2]);
      await rejects(pool.query(`update evidence set superseded_by_id = null where id = $1`, [e1]), PG.check);
    });

    it("exposes source URL and retrieval time for every evidence row", async () => {
      const c = await company();
      const sr = await fetchRecord(c, "https://acme.co.za/catalogue");
      const e = await evidenceRow(c, sr);
      const row = await one<{ source_url: string; retrieved_at: Date }>(
        `select source_url, retrieved_at from evidence_provenance where evidence_id = $1`,
        [e],
      );
      expect(row.source_url).toBe("https://acme.co.za/catalogue");
      expect(row.retrieved_at).toBeInstanceOf(Date);
    });
  });

  describe("audits", () => {
    it("records a robots block as a valid result with proof", async () => {
      const c = await company();
      await rejects(
        pool.query(
          `insert into audits (company_id, target_url, status, check_set_version, trace_id, completed_at) values ($1, 'https://x.co.za', 'SOURCE_BLOCKED', 'v1', 't', now())`,
          [c],
        ),
        PG.check,
      );
      const robots = (
        await one<{ id: string }>(
          `insert into source_records (source_id, company_id, retrieval_method, url, fetched_at, fetch_outcome, http_status, raw_content)
           values ($1, $2, 'http_fetch', 'https://x.co.za/robots.txt', now(), 'blocked_by_robots', 200, 'User-agent: *\nDisallow: /') returning id`,
          [await idOf("sources", "website_fetch"), c],
        )
      ).id;
      await pool.query(
        `insert into audits (company_id, target_url, status, block_reason, block_source_record_id, check_set_version, trace_id, completed_at)
         values ($1, 'https://x.co.za', 'SOURCE_BLOCKED', 'robots_disallow', $2, 'v1', 't', now())`,
        [c, robots],
      );
    });

    it("stores findings with status, severity and evidence links", async () => {
      const c = await company();
      const sr = await fetchRecord(c);
      const e = await evidenceRow(c, sr);
      const a = (
        await one<{ id: string }>(
          `insert into audits (company_id, target_url, status, check_set_version, trace_id, completed_at) values ($1, 'https://acme.co.za', 'COMPLETED', 'v1', 't', now()) returning id`,
          [c],
        )
      ).id;
      await rejects(
        pool.query(
          `insert into audit_findings (audit_id, check_key, check_version, status, detail, observed_at) values ($1, 'cta.above_fold', '1', 'FAIL', 'd', now())`,
          [a],
        ),
        PG.check,
        "audit_findings_fail_has_severity",
      );
      const f = (
        await one<{ id: string }>(
          `insert into audit_findings (audit_id, check_key, check_version, status, severity, detail, observed_at) values ($1, 'cta.above_fold', '1', 'FAIL', 'medium', 'd', now()) returning id`,
          [a],
        )
      ).id;
      await pool.query(`insert into audit_finding_evidence (audit_finding_id, evidence_id) values ($1, $2)`, [f, e]);
      await pool.query(`insert into finding_verifications (audit_finding_id, verdict, verified_by) values ($1, 'false_positive', 'operator')`, [f]);
    });
  });

  describe("signals and opportunities", () => {
    it("only lets a human raise a procurement_scorecard signal", async () => {
      const c = await company();
      const t = await idOf("signal_types", "procurement_scorecard");
      const insert = (by: string) =>
        pool.query(
          `insert into signals (company_id, signal_type_id, strength, observed_at, detected_by, detector_ref) values ($1, $2, 0.8, now(), $3, 'x')`,
          [c, t, by],
        );
      await rejects(insert("rule"), PG.check);
      await insert("operator");
    });

    it("only lets an opportunity name a service its type maps to", async () => {
      const c = await company();
      const rfq = await idOf("opportunity_types", "rfq_system");
      const insert = (svc: string) =>
        idOf("covenant_services", svc).then((sid) =>
          pool.query(
            `insert into opportunities (company_id, opportunity_type_id, covenant_service_id, rank, rationale, inference_rule) values ($1, $2, $3, 1, 'r', 'rule')`,
            [c, rfq, sid],
          ),
        );
      await insert("custom_business_website");
      await rejects(insert("matchday_sla_retainer"), PG.foreignKey);
    });

    it("keeps opportunities as interpretations, never VERIFIED fact", async () => {
      const c = await company();
      const t = await idOf("opportunity_types", "ecommerce");
      await rejects(
        pool.query(
          `insert into opportunities (company_id, opportunity_type_id, rank, claim_type, rationale, inference_rule) values ($1, $2, 1, 'VERIFIED', 'r', 'rule')`,
          [c, t],
        ),
        PG.check,
        "opportunities_interpretation",
      );
    });
  });

  describe("intent gate", () => {
    it("never lets a lead qualify without a passed gate", async () => {
      const l = await lead(await company());
      await rejects(pool.query(`update leads set lead_state = 'OUTREACH_READY' where id = $1`, [l]), PG.check, "leads_qualified_requires_gate");
      await rejects(
        pool.query(
          `update leads set lead_state = 'COMMERCIAL_OPPORTUNITY', intent_gate_status = 'FAILED', intent_gate_evaluated_at = now() where id = $1`,
          [l],
        ),
        PG.check,
        "leads_qualified_requires_gate",
      );
      await pool.query(
        `update leads set lead_state = 'WATCH_WEAKNESS_ONLY', intent_gate_status = 'FAILED', intent_gate_evaluated_at = now() where id = $1`,
        [l],
      );
    });

    it("requires a reason for a human override and for disallowing cold outreach", async () => {
      const l = await lead(await company());
      await rejects(
        pool.query(
          `update leads set intent_gate_status = 'PASSED', intent_gate_basis = 'human_override', intent_gate_evaluated_at = now() where id = $1`,
          [l],
        ),
        PG.check,
        "leads_override_has_reason",
      );
      await rejects(
        pool.query(`update leads set outreach_channel_suitability = 'cold_outreach_disallowed' where id = $1`, [l]),
        PG.check,
        "leads_channel_disallowed_has_reason",
      );
      await pool.query(
        `update leads set segment_fit = 'potentially_valid', outreach_channel_suitability = 'cold_outreach_disallowed', channel_suitability_reason = 'procurement_cycle' where id = $1`,
        [l],
      );
    });
  });

  describe("scores", () => {
    it("bounds score and confidence, and keeps score runs immutable", async () => {
      const l = await lead(await company());
      await rejects(score(l, 101), PG.check, "scores_total_range");
      const s = await score(l);
      await rejects(pool.query(`update scores set total = 99 where id = $1`, [s]), PG.check);
    });

    it("freezes a weight set's weights once a score uses it", async () => {
      await score(await lead(await company()));
      await rejects(
        pool.query(`update weight_sets set w_buying_signal = 0.30, w_icp_fit = 0.10 where is_active`),
        PG.check,
      );
      await pool.query(`update weight_sets set notes = 'still editable' where is_active`);
    });
  });

  describe("human judgement", () => {
    it("ties a review judgement to a score of the same lead", async () => {
      const l1 = await lead(await company());
      const l2 = await lead(await company());
      const s2 = await score(l2);
      const judge = (leadId: string, scoreId: string | null, context = "review") =>
        pool.query(
          `insert into judgements (lead_id, context, score_id, verdict, reason_code, actor) values ($1, $2, $3, 'YES', 'good_service_fit', 'operator') returning id`,
          [leadId, context, scoreId],
        );
      await rejects(judge(l1, null), PG.check, "judgements_review_has_score");
      await rejects(judge(l1, s2), PG.foreignKey);
      const ok = await judge(l2, s2);
      await rejects(pool.query(`update judgements set verdict = 'NO' where id = $1`, [ok.rows[0].id]), PG.check);
      await rejects(judge(l2, s2, "benchmark_blind"), PG.check, "judgements_blind_has_no_score");
    });
  });

  describe("benchmark", () => {
    it("stores a selected company with its rationale and a blind verdict only", async () => {
      const c = await company();
      const l = await lead(c);
      const s = await score(l);
      const cat = (await one<{ id: string }>(`select id from benchmark_categories where number = 2`)).id;
      const blind = (
        await one<{ id: string }>(
          `insert into judgements (lead_id, context, verdict, reason_code, actor) values ($1, 'benchmark_blind', 'YES', 'strong_commercial_opportunity', 'operator') returning id`,
          [l],
        )
      ).id;
      const review = (
        await one<{ id: string }>(
          `insert into judgements (lead_id, context, score_id, verdict, reason_code, actor) values ($1, 'review', $2, 'YES', 'good_service_fit', 'operator') returning id`,
          [l, s],
        )
      ).id;
      const insertCase = (judgementId: string, context: string) =>
        pool.query(
          `insert into benchmark_cases (category_id, company_id, lead_id, selection_criteria, typicality_rationale, alternatives_considered, selected_by, human_judgement_id, human_judgement_context)
           values ($1, $2, $3, 'criteria', 'typical', 'none', 'operator', $4, $5)`,
          [cat, c, l, judgementId, context],
        );
      await rejects(insertCase(review, "review"), PG.check, "benchmark_cases_judgement_is_blind");
      await rejects(insertCase(review, "benchmark_blind"), PG.foreignKey);
      await insertCase(blind, "benchmark_blind");
      await rejects(
        pool.query(`update benchmark_cases set outcome = 'false_positive', system_score_id = $2, system_lead_state = 'WATCH_WEAKNESS_ONLY', compared_at = now() where company_id = $1`, [c, s]),
        PG.check,
        "benchmark_cases_disagreement_diagnosed",
      );
    });
  });

  describe("AI brief evidence binding", () => {
    it("rejects a claim citing evidence that was not in the run's packet", async () => {
      const c = await company();
      const sr = await fetchRecord(c);
      const inPacket = await evidenceRow(c, sr);
      const notInPacket = await evidenceRow(c, sr);
      const run = (
        await one<{ id: string }>(
          `insert into ai_runs (provider, model, task_key, prompt_name, prompt_version, company_id, status, trace_id, started_at)
           values ('anthropic', 'm', 'opportunity_brief', 'opportunity_brief', 1, $1, 'succeeded', 't', now()) returning id`,
          [c],
        )
      ).id;
      await pool.query(`insert into ai_run_packet_evidence (ai_run_id, evidence_id) values ($1, $2)`, [run, inPacket]);
      const brief = (await one<{ id: string }>(`insert into opportunity_briefs (company_id, ai_run_id) values ($1, $2) returning id`, [c, run])).id;
      const claim = (
        await one<{ id: string }>(
          `insert into brief_claims (brief_id, ai_run_id, field, text, claim_type) values ($1, $2, 'evidence', 'No primary CTA', 'VERIFIED') returning id`,
          [brief, run],
        )
      ).id;
      const cite = (e: string) =>
        pool.query(`insert into brief_claim_evidence (brief_claim_id, ai_run_id, evidence_id) values ($1, $2, $3)`, [claim, run, e]);
      await rejects(cite(notInPacket), PG.foreignKey);
      await cite(inPacket);
    });
  });
});
