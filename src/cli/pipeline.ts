// npm run pipeline -- <companyId> [<companyId> ...] [--skip-audit]
// npm run pipeline -- --all [--skip-audit]
// Audit → detect → derive → gate for each business, in order, one business at a time.
import "./stdout";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { FetchRun, loadFetchConfig } from "../fetch/fetcher";
import { HostLimiter, realClock } from "../fetch/limiter";
import { runPipeline } from "../pipeline/run";

const { values, positionals } = parseArgs({ options: { all: { type: "boolean" }, "skip-audit": { type: "boolean" } }, allowPositionals: true });

try {
  const db = getDb();
  const ids = values.all ? (await db.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.status, "active"))).map((r) => r.id) : positionals;
  if (!ids.length) {
    console.error("Usage: npm run pipeline -- <companyId> [...] | --all  [--skip-audit]");
    process.exitCode = 2;
  } else {
    const run = values["skip-audit"] ? null : new FetchRun(db, await loadFetchConfig(db), new HostLimiter(realClock), realClock);
    try {
      for (const id of ids) {
        try {
          const r = await runPipeline(db, run, id, { skipAudit: values["skip-audit"] });
          const e = r.evaluation;
          console.log(`${r.companyId}: ${e.previousState} → ${e.state}${e.overridden ? ` (human override; system says ${e.systemState})` : ""}`);
          if (r.audit) console.log(`  audit     ${r.audit.status} (${r.audit.findings} findings)`);
          console.log(`  detect    ${e.steps.detection}`);
          console.log(`  derive    ${e.steps.derivation}`);
          console.log(`  gate      ${e.outcome.gateStatus}${e.outcome.gateBasis ? ` (${e.outcome.gateBasis})` : ""}`);
          for (const reason of e.outcome.reasons) console.log(`    - ${reason}`);
        } catch (err) {
          console.error(`${id}: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      }
    } finally {
      await run?.close();
    }
  }
} finally {
  await getPool().end();
}
