// Migration 0002 changes column types and drops a type on tables that already hold rows.
// This applies 0000–0001 with Phase 2 data in place, then the rest, and checks the data survived.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema/index";
import { seed } from "@/db/seed";
import { adminUrl } from "./harness";

describe.skipIf(!adminUrl)("upgrade from the Phase 2 schema", () => {
  const name = `covenant_upgrade_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  let pool: Pool | undefined;
  let dir: string | undefined;

  afterAll(async () => {
    await pool?.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("keeps existing judgements, disqualifiers and settings through migration 0002", async () => {
    await admin.query(`create database ${name}`);
    const url = new URL(adminUrl as string);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    const db = drizzle(pool, { schema });

    dir = await mkdtemp(join(tmpdir(), "covenant-migrations-"));
    await cp("drizzle", dir, { recursive: true });
    const journalPath = join(dir, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { entries: unknown[] };
    await writeFile(journalPath, JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }));
    await migrate(db, { migrationsFolder: dir });

    // Phase 2 state: old-shape disqualifiers and settings, a judgement on the enum.
    await pool.query(`
      insert into disqualifiers (key, name, detectable_from_website) values
        ('zero_revenue_speculative', 'Zero-revenue / speculative', true),
        ('bureaucratic_procurement', 'Bureaucratic procurement', true);
      insert into settings (key, value, description) values ('ai_monthly_cap_usd', 'null', 'old');
      insert into weight_sets (name, version, is_active, w_buying_signal, w_icp_fit, w_digital_opportunity, w_service_fit, w_commercial_potential, w_contactability, w_evidence_quality)
        values ('phase0_default', 1, true, 0.22, 0.18, 0.15, 0.15, 0.12, 0.10, 0.08);
      insert into companies (domain, display_name, normalised_name, created_via) values ('old.co.za', 'Old', 'old', 'manual');
      insert into leads (company_id) select id from companies;
      insert into scores (lead_id, weight_set_id, total, confidence, evidence_quality)
        select l.id, w.id, 40, 0.5, 0.5 from leads l, weight_sets w;
      insert into judgements (lead_id, context, score_id, verdict, reason_code, actor)
        select lead_id, 'review', id, 'NO', 'too_small', 'operator' from scores;`);

    await migrate(db, { migrationsFolder: "drizzle" });
    await seed(db);

    const j = await pool.query(`select reason_code from judgements`);
    expect(j.rows).toEqual([{ reason_code: "too_small" }]);
    const d = await pool.query(`select key, human_only, config_origin from disqualifiers order by key`);
    expect(d.rows).toContainEqual({ key: "bureaucratic_procurement", human_only: false, config_origin: "default" });
    expect(d.rows).toContainEqual({ key: "zero_revenue_speculative", human_only: true, config_origin: "default" });
    const st = await pool.query(`select key, value from settings where key like 'ai_monthly_cap%'`);
    expect(st.rows).toEqual([{ key: "ai_monthly_cap_zar", value: 500 }]);
    const t = await pool.query(`select 1 from pg_type where typname = 'judgement_reason'`);
    expect(t.rows).toEqual([]);
  }, 60_000);
});
