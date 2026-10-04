// npm run audit -- <companyId> [--url <url>]
// Runs one deterministic audit and prints its findings, most severe first.
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { runAudit } from "../audit/run";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { FetchRun, loadFetchConfig } from "../fetch/fetcher";
import { HostLimiter, realClock } from "../fetch/limiter";

const { values, positionals } = parseArgs({ options: { url: { type: "string" } }, allowPositionals: true });
const [companyId] = positionals;
if (!companyId) {
  console.error("Usage: npm run audit -- <companyId> [--url <url>]");
  process.exit(2);
}

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };
try {
  const db = getDb();
  const run = new FetchRun(db, await loadFetchConfig(db), new HostLimiter(realClock), realClock);
  try {
    const r = await runAudit(db, run, { companyId, targetUrl: values.url });
    const [a] = await db.select().from(s.audits).where(eq(s.audits.id, r.auditId));
    console.log(`Audit ${r.auditId}: ${r.status}${a?.statusDetail ? ` — ${a.statusDetail}` : ""}${a?.errorDetail ? ` — ${a.errorDetail}` : ""}`);
    const findings = await db.select().from(s.auditFindings).where(eq(s.auditFindings.auditId, r.auditId));
    findings.sort((x, y) => (RANK[x.severity ?? ""] ?? 9) - (RANK[y.severity ?? ""] ?? 9));
    for (const f of findings) {
      if (f.status === "PASS") continue;
      console.log(`  [${f.status}${f.severity ? `/${f.severity}` : ""}] ${f.checkKey} (confidence ${f.confidence}): ${f.detail}`);
    }
    console.log(`  ${findings.filter((f) => f.status === "PASS").length} checks passed.`);
  } finally {
    await run.close();
  }
} finally {
  await getPool().end();
}
