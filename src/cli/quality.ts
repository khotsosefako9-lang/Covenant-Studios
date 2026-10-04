// npm run quality — runs the data-quality invariants once and reports. Exit code 1 if any is violated.
import "./stdout";
import { getDb, getPool } from "../db/client";
import { runInvariants } from "../quality/invariants";

try {
  const results = await runInvariants(getDb());
  for (const r of results) {
    const mark = r.status === "ok" ? "ok  " : r.status === "violated" ? "FAIL" : "n/a ";
    console.log(`${mark} ${r.key}${r.status === "violated" ? ` (${r.count})` : ""} — ${r.description}`);
    for (const line of r.sample) console.log(`       ${line}`);
  }
  if (results.some((r) => r.status === "violated")) process.exitCode = 1;
} finally {
  await getPool().end();
}
