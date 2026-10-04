// npm run import:csv -- <file.csv> --by "<operator name>"
import "./stdout";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { getDb, getPool } from "../db/client";
import { importCsv } from "../ingest/companies";

const { values, positionals } = parseArgs({ options: { by: { type: "string" } }, allowPositionals: true });
const file = positionals[0];
if (!file || !values.by) {
  console.error('Usage: npm run import:csv -- <file.csv> --by "<operator name>"');
  process.exit(2);
}

try {
  const result = await importCsv(getDb(), { content: await readFile(file, "utf8"), fileName: basename(file), actor: values.by });
  if (!result.ok) {
    console.error(`Import rejected (${result.code}): ${result.message}`);
    process.exitCode = 1;
  } else {
    const r = result.report;
    console.log(`Source record ${r.sourceRecordId} (trace ${r.traceId})`);
    console.log(
      `imported ${r.counts.imported} · matched existing ${r.counts.matched_existing} · invalid ${r.counts.invalid} · failed ${r.counts.failed}`,
    );
    if (r.ignoredColumns.length) console.log(`Ignored columns: ${r.ignoredColumns.join(", ")}`);
    for (const row of r.rows) {
      if (row.status === "imported" && row.issues.length === 0) continue;
      console.log(`  row ${row.rowNumber}: ${row.status}${row.issues.length ? ` — ${row.issues.map((i) => i.message).join("; ")}` : ""}`);
    }
    if (r.candidates.length) {
      console.log(`${r.candidates.length} possible duplicate(s) proposed for human review:`);
      for (const c of r.candidates) console.log(`  ${c.matchBasis}: ${c.matchedValue} (${c.companyAId} / ${c.companyBId})`);
    }
  }
} finally {
  await getPool().end();
}
