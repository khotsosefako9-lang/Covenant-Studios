// npm run score -- explain <leadId> [--score <scoreId>]
// npm run score -- list
// Prints a lead's score decomposed to the evidence: each dimension's raw value, weight,
// decay and contribution, and under each the findings and signals that produced it.
import "./stdout";
import { parseArgs } from "node:util";
import { desc, eq } from "drizzle-orm";
import { getDb, getPool } from "../db/client";
import * as s from "../db/schema/index";
import { explainScore } from "../leads/explain";

const { values, positionals } = parseArgs({ options: { score: { type: "string" } }, allowPositionals: true });
const [command, id] = positionals;
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

try {
  const db = getDb();
  if (command === "explain" && id) {
    const e = await explainScore(db, { leadId: id, scoreId: values.score });
    console.log(`Lead ${e.leadId}, score ${e.scoreId}`);
    console.log(`  computed ${e.computedAt.toISOString()} with ${e.weightSet}, against audit ${e.auditId ?? "(none)"}`);
    console.log(`  total ${e.total.toFixed(2)} (now, after decay: ${e.totalNow.toFixed(2)}), confidence ${pct(e.confidence)}, treatment ${e.treatment ?? "none"}`);
    console.log(`  axes: Opportunity ${e.opportunityAxis ?? "-"}, Intent ${e.intentAxis ?? "-"}`);
    console.log(`  rule: ${e.rule ?? "(not recorded)"}`);
    for (const d of e.dimensions) {
      console.log(`\n  ${d.dimension}`);
      console.log(
        `    value ${d.value} × weight ${d.weight} × decay ${d.decay}${d.decayNow !== d.decay ? ` (now ${d.decayNow})` : ""} × 100 = ${d.contribution.toFixed(2)}${d.contributionNow !== d.contribution ? ` (now ${d.contributionNow.toFixed(2)})` : ""}`,
      );
      console.log(`    confidence inputs: coverage ${d.coverage} × recency ${d.recency} × verifiability ${d.verifiability} = ${(d.coverage * d.recency * d.verifiability).toFixed(3)}`);
      console.log(`    ${d.explanation}`);
      if (d.components) console.log(`    components: ${Object.entries(d.components).map(([k, v]) => `${k} ${v ?? "-"}`).join(", ")}`);
      for (const x of d.signals) console.log(`    signal  ${x.typeKey} (${x.detectedBy}) strength ${x.strength} → ${x.strengthNow} now, observed ${x.observedAt.toISOString().slice(0, 10)}${x.status !== "active" ? ` [${x.status}]` : ""}`);
      for (const f of d.findings) console.log(`    finding ${f.checkKey} ${f.status}${f.severity ? `/${f.severity}` : ""} (confidence ${f.confidence}): ${f.detail}`);
      for (const o of d.opportunities) console.log(`    opportunity #${o.rank} ${o.typeKey} → ${o.serviceKey ?? "(no service)"}, relevance ${o.relevance ?? "-"}${o.superseded ? " [superseded since]" : ""}`);
      for (const c of d.channels) console.log(`    channel ${c.kind} ${c.value} (${c.verification})`);
      for (const ev of d.evidence) console.log(`    evidence ${ev.claimType} ${ev.claim}${ev.value ? `: ${ev.value}` : ""} [${ev.retrievalMethod}${ev.sourceUrl ? ` ${ev.sourceUrl}` : ""}]`);
    }
  } else if (command === "list") {
    const rows = await db
      .select({ lead: s.leads, name: s.companies.displayName, total: s.scores.total, confidence: s.scores.confidence, treatment: s.scores.treatment })
      .from(s.leads)
      .innerJoin(s.companies, eq(s.companies.id, s.leads.companyId))
      .leftJoin(s.scores, eq(s.scores.id, s.leads.currentScoreId))
      .where(eq(s.leads.status, "open"))
      .orderBy(desc(s.scores.total));
    for (const r of rows) console.log(`  ${r.total ?? "  -  "}  ${r.confidence ? pct(Number(r.confidence)) : "-"}  ${r.treatment ?? "-"}  ${r.lead.leadState}  ${r.name}  (${r.lead.id})`);
  } else {
    console.error("Usage: npm run score -- <explain <leadId> [--score <scoreId>] | list>");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  await getPool().end();
}
