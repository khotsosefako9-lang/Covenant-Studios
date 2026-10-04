// End to end: fixture site → fetch layer → audit → persisted findings and evidence.
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runAudit } from "@/audit/run";
import { FetchRun, loadFetchConfig } from "@/fetch/fetcher";
import { HostLimiter } from "@/fetch/limiter";
import { addCompanyManually } from "@/ingest/companies";
import { adminUrl, createTestDb } from "../db/harness";
import { FakeClock, type Fixture, type Handler, html, robots, serve, status } from "../fetch/fixture";
import { fixture } from "./helpers";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;
const open: { close(): Promise<void> }[] = [];
let n = 0;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

async function site(routes: Parameters<typeof serve>[0], fallback?: Parameters<typeof serve>[1]): Promise<Fixture> {
  const f = await serve(routes, fallback);
  open.push(f);
  return f;
}

// Tests never reach the live internet: external profile links are removed from served pages.
const offline = (html: string) => html.replace(/https:\/\/www\.(facebook|instagram|linkedin|youtube)\.com\/[^"']*/g, "#");

const raw = (body: string, type = "text/html; charset=utf-8"): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": type });
  res.end(body);
};

async function company(name = "Bay Plumbing") {
  n++;
  const r = await addCompanyManually(db, { input: { name: `${name} ${n}`, website: `fixture${n}.co.za` }, actor: "test" });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.companyId;
}

async function audit(companyId: string, targetUrl?: string) {
  const clock = new FakeClock();
  const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(clock), clock);
  open.push(run);
  return runAudit(db, run, { companyId, targetUrl });
}

describe.skipIf(!adminUrl)("audit runs against fixture sites", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
  }, 60_000);

  afterEach(async () => {
    await Promise.all(open.splice(0).map((x) => x.close()));
  });

  afterAll(async () => {
    await teardown?.();
  });

  it("audits a well-built site and stores every result with VERIFIED evidence", async () => {
    const f = await site({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/sitemap.xml": raw("<urlset/>", "application/xml"), "/": raw(offline(fixture("controls/plumber.html"))) }, html("sub page"));
    const id = await company();
    const r = await audit(id, `${f.origin}/`);
    expect(r).toMatchObject({ status: "COMPLETED", findings: 36 });

    const [a] = await q<{ status: string; page_source_record_id: string; check_set_version: string }>(`select * from audits where id = $1`, [r.auditId]);
    expect(a?.page_source_record_id).toBeTruthy();
    const findings = await q<{ check_key: string; status: string; severity: string | null; confidence: string }>(`select * from audit_findings where audit_id = $1`, [r.auditId]);
    expect(findings).toHaveLength(36);
    expect(findings.filter((x) => x.status !== "FAIL").every((x) => x.severity === null)).toBe(true);
    expect(findings.filter((x) => x.status === "FAIL" && ["medium", "high"].includes(x.severity ?? ""))).toEqual([]);

    const ev = await q<{ claim_type: string; producer: string; claim_key: string; source_url: string; retrieved_at: Date; locator: string }>(
      `select p.claim_type, p.producer, p.claim_key, p.source_url, p.retrieved_at, e.locator
       from audit_findings f join audit_finding_evidence fe on fe.audit_finding_id = f.id
       join evidence e on e.id = fe.evidence_id join evidence_provenance p on p.evidence_id = e.id
       where f.audit_id = $1`,
      [r.auditId],
    );
    expect(ev.length).toBeGreaterThan(20);
    expect(ev.every((e) => e.claim_type === "VERIFIED" && e.producer === "audit" && e.claim_key.startsWith("audit.") && e.locator)).toBe(true);
    expect(ev.every((e) => e.source_url?.startsWith(f.origin) && e.retrieved_at instanceof Date)).toBe(true);
    // Sampled internal links were requested through the fetch layer, politely and once each.
    expect(f.requests.filter((x) => ["/services/", "/areas/", "/about/", "/contact/"].includes(x.path)).length).toBe(4);
    expect((await q(`select 1 from ai_runs`)).length).toBe(0);
    // Every request this audit made stayed on the fixture host.
    const hosts = await q<{ host: string }>(`select distinct host from source_records where trace_id = (select trace_id from audits where id = $1)`, [r.auditId]);
    expect(hosts).toEqual([{ host: f.host }]);
  });

  it("records RENDER_REQUIRED for a JavaScript shell, with zero findings", async () => {
    const f = await site({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": raw(fixture("special/shell-react.html")) });
    const r = await audit(await company("Acme Couriers"), `${f.origin}/`);
    expect(r).toMatchObject({ status: "RENDER_REQUIRED", findings: 0 });
    const [a] = await q<{ status_detail: string; page_source_record_id: string }>(`select * from audits where id = $1`, [r.auditId]);
    expect(a?.status_detail).toContain("#root");
    expect(a?.page_source_record_id).toBeTruthy();
    expect(await q(`select 1 from audit_findings where audit_id = $1`, [r.auditId])).toEqual([]);
    expect(f.requests.map((x) => x.path)).toEqual(["/robots.txt", "/"]);
  });

  it("records NO_CONTENT for an empty page", async () => {
    const f = await site({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": raw(fixture("special/empty.html")) });
    expect(await audit(await company(), `${f.origin}/`)).toMatchObject({ status: "NO_CONTENT", findings: 0 });
  });

  it("records SOURCE_BLOCKED with the robots.txt record as proof, and requests nothing else", async () => {
    const f = await site({ "/robots.txt": robots("User-agent: *\nDisallow: /") }, html("secret"));
    const r = await audit(await company(), `${f.origin}/`);
    expect(r).toMatchObject({ status: "SOURCE_BLOCKED", findings: 0 });
    const [a] = await q<{ block_reason: string; purpose: string }>(
      `select a.block_reason, sr.purpose from audits a join source_records sr on sr.id = a.block_source_record_id where a.id = $1`,
      [r.auditId],
    );
    expect(a).toEqual({ block_reason: "robots_disallow", purpose: "robots" });
    expect(f.requests.map((x) => x.path)).toEqual(["/robots.txt"]);
  });

  it("records a 403 homepage as SOURCE_BLOCKED by the server", async () => {
    const f = await site({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": status(403) });
    const r = await audit(await company(), `${f.origin}/`);
    expect(r.status).toBe("SOURCE_BLOCKED");
    expect((await q<{ block_reason: string }>(`select block_reason from audits where id = $1`, [r.auditId]))[0]?.block_reason).toBe("http_forbidden");
  });

  it("does not audit a Facebook or Linktree presence, and makes no request", async () => {
    const fb = await addCompanyManually(db, { input: { name: "Sunset Braai Spot", website: "https://www.facebook.com/sunsetbraai" }, actor: "test" });
    if (!fb.ok) throw new Error("expected company");
    const before = (await q(`select 1 from source_records where retrieval_method = 'http_fetch'`)).length;
    const r = await audit(fb.companyId);
    expect(r).toMatchObject({ status: "SHARED_PLATFORM", findings: 0 });
    const [a] = await q<{ target_url: string; status_detail: string }>(`select target_url, status_detail from audits where id = $1`, [r.auditId]);
    expect(a?.target_url).toBe("https://www.facebook.com/sunsetbraai");
    expect(a?.status_detail).toContain("facebook.com");
    expect(await audit(await company(), "https://linktr.ee/somebrand")).toMatchObject({ status: "SHARED_PLATFORM", findings: 0 });
    expect((await q(`select 1 from source_records where retrieval_method = 'http_fetch'`)).length).toBe(before);
  });

  it("skips checks disabled in configuration", async () => {
    await pool.query(`update audit_checks set enabled = false, config_origin = 'operator' where key = 'conv.whatsapp_link'`);
    try {
      const f = await site({ "/robots.txt": robots("User-agent: *\nAllow: /"), "/": raw(offline(fixture("controls/lawfirm.html"))) }, html("x"));
      const r = await audit(await company("Mbeki"), `${f.origin}/`);
      expect(r.findings).toBe(35);
      expect(await q(`select 1 from audit_findings where audit_id = $1 and check_key = 'conv.whatsapp_link'`, [r.auditId])).toEqual([]);
    } finally {
      await pool.query(`update audit_checks set enabled = true where key = 'conv.whatsapp_link'`);
    }
  });

  it("runs on the configured thresholds and records them on the audit", async () => {
    const page = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Supplier</title></head><body><h1>Supplier</h1><p>${"We supply valves to plants across the Eastern Cape. ".repeat(10)}</p><a href="/c.pdf">Product catalogue</a></body></html>`;
    const routes = {
      "/robots.txt": robots("User-agent: *\nAllow: /"),
      "/": raw(page),
      "/c.pdf": ((_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(3 * 1024 * 1024) });
        res.end();
      }) as Handler,
    };
    const statusOf = async (auditId: string) =>
      (await q<{ status: string }>(`select status from audit_findings where audit_id = $1 and check_key = 'content.heavy_catalogue'`, [auditId]))[0]?.status;
    const before = await audit(await company("Valves"), `${(await site(routes, html("x"))).origin}/`);
    expect(await statusOf(before.auditId)).toBe("PASS");
    const [a] = await q<{ check_params: Record<string, Record<string, number>> }>(`select check_params from audits where id = $1`, [before.auditId]);
    expect(a?.check_params["content.heavy_catalogue"]).toEqual({ max_pdf_bytes: 10 * 1024 * 1024 });

    await pool.query(`update audit_checks set params = '{"max_pdf_bytes": 2097152}', config_origin = 'operator' where key = 'content.heavy_catalogue'`);
    try {
      const after = await audit(await company("Valves"), `${(await site(routes, html("x"))).origin}/`);
      expect(await statusOf(after.auditId)).toBe("FAIL");
      const [b] = await q<{ check_params: Record<string, Record<string, number>> }>(`select check_params from audits where id = $1`, [after.auditId]);
      expect(b?.check_params["content.heavy_catalogue"]).toEqual({ max_pdf_bytes: 2097152 });

      // Below the check's floor (1 MB) or an unknown key: the audit fails rather than guess.
      await pool.query(`update audit_checks set params = '{"max_pdf_bytes": 1000}' where key = 'content.heavy_catalogue'`);
      const bad = await audit(await company("Valves"), `${(await site(routes, html("x"))).origin}/`);
      expect(bad.status).toBe("FAILED");
      const [c] = await q<{ error_detail: string }>(`select error_detail from audits where id = $1`, [bad.auditId]);
      expect(c?.error_detail).toContain("content.heavy_catalogue");
    } finally {
      await pool.query(`update audit_checks set params = '{"max_pdf_bytes": 10485760}', config_origin = 'default' where key = 'content.heavy_catalogue'`);
    }
  });

  it("measures a heavy catalogue from its declared size without downloading it", async () => {
    const page = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Supplier</title></head><body><h1>Industrial supplier</h1><p>${"We supply valves and fittings to plants across the Eastern Cape. ".repeat(10)}</p><a href="/catalogue.pdf">Download our product catalogue</a><a href="tel:0415550000">041 555 0000</a></body></html>`;
    const f = await site({
      "/robots.txt": robots("User-agent: *\nAllow: /"),
      "/": raw(page),
      "/catalogue.pdf": (_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(48_000_000) });
        res.write("%PDF-1.7");
      },
    });
    const r = await audit(await company("Supplier"), `${f.origin}/`);
    const [finding] = await q<{ status: string; severity: string; detail: string; id: string }>(
      `select * from audit_findings where audit_id = $1 and check_key = 'content.heavy_catalogue'`,
      [r.auditId],
    );
    expect(finding).toMatchObject({ status: "FAIL", severity: "medium" });
    expect(finding?.detail).toContain("45.8 MB");
    const [proof] = await q<{ url: string; declared_length: string; raw_content: string | null; fetch_outcome: string }>(
      `select sr.url, sr.declared_length, sr.raw_content, sr.fetch_outcome from audit_finding_evidence fe
       join evidence e on e.id = fe.evidence_id join source_records sr on sr.id = e.source_record_id where fe.audit_finding_id = $1`,
      [finding?.id],
    );
    expect(proof).toMatchObject({ url: `${f.origin}/catalogue.pdf`, declared_length: "48000000", raw_content: null, fetch_outcome: "UNSUPPORTED_CONTENT_TYPE" });
  });
});
