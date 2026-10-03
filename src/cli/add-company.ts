// npm run company:add -- --name "Acme Supplies" [--website acme.co.za] [--phone ...] --by "<operator name>"
import { parseArgs } from "node:util";
import { COMPANY_FIELDS, type CompanyInput } from "../core/ingest/validate";
import { getDb, getPool } from "../db/client";
import { addCompanyManually } from "../ingest/companies";

const options: Record<string, { type: "string" }> = { by: { type: "string" } };
for (const f of COMPANY_FIELDS) options[f.replace("_", "-")] = { type: "string" };
const values = parseArgs({ options }).values as Record<string, string | undefined>;
if (!values.by || !values.name) {
  console.error(`Usage: npm run company:add -- --name "<name>" --by "<operator>" [${COMPANY_FIELDS.filter((f) => f !== "name").map((f) => `--${f.replace("_", "-")}`).join(" ")}]`);
  process.exit(2);
}
const input: CompanyInput = {};
for (const f of COMPANY_FIELDS) {
  const v = values[f.replace("_", "-")];
  if (typeof v === "string") input[f] = v;
}

try {
  const r = await addCompanyManually(getDb(), { input, actor: String(values.by) });
  if (r.ok) {
    console.log(`Created company ${r.companyId} (source record ${r.sourceRecordId})`);
    for (const w of r.warnings) console.log(`  note: ${w.message}`);
    for (const c of r.candidates) console.log(`  possible duplicate (${c.matchBasis}): ${c.matchedValue}`);
  } else if (r.status === "matched_existing") {
    console.log(`Not created: ${r.message} (${r.companyId})`);
    process.exitCode = 1;
  } else {
    console.log("Not created:");
    for (const e of r.errors) console.log(`  ${e.field ?? "input"}: ${e.message}`);
    process.exitCode = 1;
  }
} finally {
  await getPool().end();
}
