// npm run opportunities -- derive <companyId>
// npm run opportunities -- list   <companyId> [--history]
import "./stdout";
import { parseArgs } from "node:util";
import { deriveCompanyOpportunities } from "../commercial/opportunities";
import { getDb, getPool } from "../db/client";
import { getCompanyOpportunities } from "../db/company-scope";

const { values, positionals } = parseArgs({ options: { history: { type: "boolean" } }, allowPositionals: true });
const [command, id] = positionals;

const zar = (n: number | null) => (n === null ? "unpublished" : `R${n.toLocaleString("en-ZA")}`);

try {
  const db = getDb();
  if (command === "derive" && id) {
    const r = await deriveCompanyOpportunities(db, id);
    const d = r.derivation;
    console.log(r.status === "unchanged" ? "Unchanged: the current opportunities still follow from the active signals." : `${d.opportunities.length} opportunit${d.opportunities.length === 1 ? "y" : "ies"} derived, ${r.superseded} superseded`);
    for (const o of d.opportunities) console.log(`  ${o.rank}. ${o.typeKey} → ${o.serviceKey ?? "(no service)"}  relevance ${o.relevance}, confidence ${o.confidence}\n     ${o.rationale}`);
    if (d.unmapped.length) console.log(`Signals with no opportunity mapping: ${d.unmapped.join(", ")}`);
    if (d.belowThreshold.length) console.log(`Below min relevance: ${d.belowThreshold.map((b) => `${b.typeKey} ${b.relevance}`).join(", ")}`);
    console.log(`Rule: ${d.inferenceRule}`);
  } else if (command === "list" && id) {
    const rows = await getCompanyOpportunities(db, id, { includeSuperseded: values.history });
    if (!rows.length) console.log("No opportunities.");
    for (const r of rows) {
      const o = r.opportunity;
      const price = r.priceLowZar === null ? "" : ` (from ${zar(r.priceLowZar)}${r.priceHighZar ? ` to ${zar(r.priceHighZar)}` : ""})`;
      console.log(
        `  ${o.supersededAt ? `[superseded ${o.supersededAt.toISOString().slice(0, 10)}] ` : ""}${o.rank}. ${r.typeName} → ${r.serviceName ?? "(no service)"}${price}, ${o.claimType}, relevance ${o.relevance}, confidence ${o.confidence}, derived ${o.derivedAt.toISOString().slice(0, 10)}\n     ${o.rationale}`,
      );
    }
  } else {
    console.error("Usage: npm run opportunities -- <derive <companyId> | list <companyId> [--history]>");
    process.exitCode = 2;
  }
} finally {
  await getPool().end();
}
