import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCompanyManually, importCsv } from "@/ingest/companies";
import { adminUrl, createTestDb } from "./harness";

let pool: Pool;
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let teardown: () => Promise<void>;

const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  (await pool.query(text, params)).rows as T[];
const count = async (table: string) => (await q<{ n: number }>(`select count(*)::int as n from ${table}`))[0]?.n ?? 0;

const MIXED = [
  "Company Name,Website,Phone,Email,Industry,City,Notes",
  "Acme Supplies (Pty) Ltd,https://www.acme.co.za/contact,041 123 4567,Info@Acme.co.za,Industrial supplies,Gqeberha,first",
  "Bad Site Co,not a site,,,,,",
  ",acme2.co.za,,,,,",
  "Acme Supplies,acme.co.za,,,,,dup domain",
  "Acme Suplies CC,acmesupplies.co.za,,,,,typo",
  "Bay Pumps,https://www.facebook.com/baypumps,,,,,",
  "Acme Shop,shop.acme.co.za,,,,,",
  "Other Co,other.co.za,+27 41 123 4567,,,,",
  "Too,Few,Columns",
  "Phone Co,phoneco.co.za,123,,,,",
].join("\n");

describe.skipIf(!adminUrl)("company ingestion against real PostgreSQL", () => {
  beforeAll(async () => {
    const t = await createTestDb();
    pool = t.pool;
    db = t.db;
    teardown = t.drop;
  }, 60_000);

  afterAll(async () => {
    await teardown?.();
  });

  describe("CSV import", () => {
    let report: Extract<Awaited<ReturnType<typeof importCsv>>, { ok: true }>["report"];

    beforeAll(async () => {
      const r = await importCsv(db, { content: MIXED, fileName: "prospects.csv", actor: "Khotso" });
      if (!r.ok) throw new Error(r.message);
      report = r.report;
    });

    it("records every row with its outcome and never discards one", async () => {
      expect(report.counts).toEqual({ imported: 5, matched_existing: 1, invalid: 4, failed: 0 });
      expect(report.ignoredColumns).toEqual(["Notes"]);
      const rows = await q<{ row_number: number; status: string; issue_codes: string[]; issue_detail: string | null }>(
        `select row_number, status, issue_codes, issue_detail from csv_import_rows where source_record_id = $1 order by row_number`,
        [report.sourceRecordId],
      );
      expect(rows.map((r) => [r.row_number, r.status])).toEqual([
        [2, "imported"],
        [3, "invalid"],
        [4, "invalid"],
        [5, "matched_existing"],
        [6, "imported"],
        [7, "imported"],
        [8, "imported"],
        [9, "imported"],
        [10, "invalid"],
        [11, "invalid"],
      ]);
      const byRow = Object.fromEntries(rows.map((r) => [r.row_number, r]));
      expect(byRow[3]?.issue_codes).toContain("website_unparseable");
      expect(byRow[4]?.issue_codes).toContain("name_missing");
      expect(byRow[5]?.issue_codes).toContain("domain_exists");
      expect(byRow[7]?.issue_codes).toEqual(["shared_platform_host"]);
      expect(byRow[10]?.issue_codes).toEqual(["column_count"]);
      expect(byRow[11]?.issue_codes).toEqual(["phone_invalid"]);
      for (const r of rows.filter((x) => x.status === "invalid")) expect(r.issue_detail).toBeTruthy();
    });

    it("keeps the CSV file as the source record, attributed to the operator", async () => {
      const [rec] = await q<{ retrieval_method: string; file_name: string; attributed_to: string; raw_content: string; url: string | null }>(
        `select retrieval_method, file_name, attributed_to, raw_content, url from source_records where id = $1`,
        [report.sourceRecordId],
      );
      expect(rec).toMatchObject({ retrieval_method: "csv_import", file_name: "prospects.csv", attributed_to: "Khotso", url: null });
      expect(rec?.raw_content).toBe(MIXED);
    });

    it("writes CSV content as REPORTED evidence with row and column locators", async () => {
      const [acme] = await q<{ id: string; domain: string; display_name: string; normalised_name: string }>(
        `select id, domain, display_name, normalised_name from companies where domain = 'acme.co.za'`,
      );
      expect(acme).toMatchObject({ display_name: "Acme Supplies (Pty) Ltd", normalised_name: "acme supplies" });
      const ev = await q<{ claim_key: string; claim_type: string; producer: string; value: string; locator: string; source_record_id: string }>(
        `select claim_key, claim_type, producer, value, locator, source_record_id from evidence where company_id = $1 order by claim_key`,
        [acme?.id],
      );
      expect(ev.map((e) => e.claim_key)).toEqual([
        "company.domain",
        "company.email",
        "company.industry",
        "company.location",
        "company.name",
        "company.phone",
      ]);
      expect(ev.every((e) => e.claim_type === "REPORTED" && e.producer === "ingest" && e.source_record_id === report.sourceRecordId)).toBe(true);
      expect(ev.find((e) => e.claim_key === "company.domain")?.locator).toBe('row 2, column "Website"');
      const channels = await q<{ kind: string; normalised_value: string }>(
        `select kind, normalised_value from contact_channels where company_id = $1 order by kind`,
        [acme?.id],
      );
      expect(channels).toEqual([
        { kind: "email", normalised_value: "info@acme.co.za" },
        { kind: "phone", normalised_value: "+27411234567" },
      ]);
      expect(await q(`select 1 from evidence where producer = 'ingest' and claim_type <> 'REPORTED'`)).toEqual([]);
    });

    it("imports a shared-platform presence without a domain, keeping the URL as evidence", async () => {
      const [bay] = await q<{ id: string; domain: string | null }>(`select id, domain from companies where display_name = 'Bay Pumps'`);
      expect(bay?.domain).toBeNull();
      const ev = await q<{ value: string }>(`select value from evidence where company_id = $1 and claim_key = 'company.web_presence_url'`, [bay?.id]);
      expect(ev).toEqual([{ value: "https://www.facebook.com/baypumps" }]);
    });

    it("proposes duplicates on name, subdomain and phone, and merges nothing", async () => {
      const cands = await q<{ match_basis: string; matched_value: string; status: string }>(
        `select match_basis, matched_value, status from company_duplicate_candidates order by match_basis`,
      );
      expect(cands.map((c) => c.match_basis).sort()).toEqual(["domain", "normalised_name", "phone"]);
      expect(cands.every((c) => c.status === "proposed")).toBe(true);
      expect(cands.find((c) => c.match_basis === "phone")?.matched_value).toBe("+27411234567");
      expect(await q(`select 1 from companies where status = 'merged'`)).toEqual([]);
      expect(await count("companies")).toBe(5);
    });

    it("rejects re-importing the identical file without writing anything", async () => {
      const before = await count("source_records");
      const r = await importCsv(db, { content: MIXED, fileName: "again.csv", actor: "Khotso" });
      expect(r).toMatchObject({ ok: false, code: "already_imported" });
      expect(await count("source_records")).toBe(before);
    });

    it("matches a domain that already exists without adding evidence to it", async () => {
      const [acme] = await q<{ id: string }>(`select id from companies where domain = 'acme.co.za'`);
      const evBefore = await count("evidence");
      const r = await importCsv(db, { content: "name,website\nACME SUPPLIES,http://acme.co.za\n", fileName: "b.csv", actor: "Khotso" });
      if (!r.ok) throw new Error(r.message);
      expect(r.report.rows).toEqual([
        expect.objectContaining({ rowNumber: 2, status: "matched_existing", companyId: acme?.id }),
      ]);
      expect(await count("evidence")).toBe(evBefore);
    });
  });

  describe("file-level rejection", () => {
    it.each([
      ["no name column", "website,phone\nacme.co.za,041\n", "csv_header"],
      ["malformed quoting", 'name\n"unterminated\n', "csv_unparseable"],
      ["header only", "name,website\n", "csv_no_rows"],
      ["empty file", "", "csv_empty"],
      ["two name columns", "name,company\na,b\n", "csv_header"],
    ])("%s → %s, nothing written", async (_label, content, code) => {
      const before = await count("source_records");
      const r = await importCsv(db, { content, fileName: "x.csv", actor: "Khotso" });
      expect(r).toMatchObject({ ok: false, code });
      expect(await count("source_records")).toBe(before);
    });

    it("requires an operator name", async () => {
      expect(await importCsv(db, { content: "name\nA\n", fileName: "x.csv", actor: "  " })).toMatchObject({ ok: false, code: "actor_missing" });
    });
  });

  describe("failure isolation", () => {
    it("records an unexpected database error on one row and continues with the rest", async () => {
      await pool.query(`
        create function test_explode() returns trigger language plpgsql as $$
        begin if new.display_name = 'Explode Ltd' then raise exception 'simulated failure'; end if; return new; end $$;
        create trigger test_explode before insert on companies for each row execute function test_explode();`);
      try {
        const r = await importCsv(db, {
          content: "name,website\nBefore Co,before.co.za\nExplode Ltd,explode.co.za\nAfter Co,after.co.za\n",
          fileName: "isolation.csv",
          actor: "Khotso",
        });
        if (!r.ok) throw new Error(r.message);
        expect(r.report.rows.map((x) => x.status)).toEqual(["imported", "failed", "imported"]);
        expect(r.report.rows[1]?.issues[0]?.message).toContain("simulated failure");
        expect(await q(`select 1 from companies where domain = 'explode.co.za'`)).toEqual([]);
        expect((await q(`select 1 from companies where domain in ('before.co.za', 'after.co.za')`)).length).toBe(2);
        const [row] = await q<{ status: string; company_id: string | null }>(
          `select status, company_id from csv_import_rows where source_record_id = $1 and row_number = 3`,
          [r.report.sourceRecordId],
        );
        expect(row).toEqual({ status: "failed", company_id: null });
      } finally {
        await pool.query(`drop trigger test_explode on companies; drop function test_explode();`);
      }
    });
  });

  describe("manual entry", () => {
    it("creates a company with REPORTED evidence and trading-as aliases", async () => {
      const r = await addCompanyManually(db, {
        input: { name: "Bay Holdings (Pty) Ltd t/a Coastal Pumps", website: "coastalpumps.co.za", industry: "Pumps" },
        actor: "Khotso",
      });
      if (!r.ok) throw new Error(JSON.stringify(r));
      const [c] = await q<{ display_name: string; created_via: string }>(`select display_name, created_via from companies where id = $1`, [r.companyId]);
      expect(c).toEqual({ display_name: "Coastal Pumps", created_via: "manual" });
      const aliases = await q<{ kind: string; value: string }>(`select kind, value from company_aliases where company_id = $1 order by kind`, [r.companyId]);
      expect(aliases).toEqual([
        { kind: "legal_name", value: "Bay Holdings (Pty) Ltd" },
        { kind: "trading_name", value: "Coastal Pumps" },
      ]);
      const [rec] = await q<{ retrieval_method: string; attributed_to: string }>(
        `select retrieval_method, attributed_to from source_records where id = $1`,
        [r.sourceRecordId],
      );
      expect(rec).toEqual({ retrieval_method: "manual_entry", attributed_to: "Khotso" });
      const ev = await q<{ claim_type: string; locator: string }>(`select claim_type, locator from evidence where company_id = $1`, [r.companyId]);
      expect(ev.every((e) => e.claim_type === "REPORTED")).toBe(true);
      expect(ev.map((e) => e.locator)).toContain('field "website"');
    });

    it("reports an existing domain or invalid input without writing", async () => {
      const before = await count("source_records");
      expect(await addCompanyManually(db, { input: { name: "Coastal", website: "https://coastalpumps.co.za/" }, actor: "K" })).toMatchObject({
        ok: false,
        status: "matched_existing",
      });
      const invalid = await addCompanyManually(db, { input: { name: "(Pty) Ltd", website: "nope", email: "x@" }, actor: "K" });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok && invalid.status === "invalid") {
        expect(invalid.errors.map((e) => e.code).sort()).toEqual(["email_invalid", "name_not_meaningful", "website_no_public_suffix"]);
      }
      expect(await count("source_records")).toBe(before);
    });
  });
});
