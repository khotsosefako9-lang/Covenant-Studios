// The nightly data-quality job body: run every invariant and record the results in
// system_events. Reporting only; nothing alerts on it yet.
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as s from "@/db/schema/index";
import { type InvariantResult, runInvariants } from "./invariants";

export async function recordInvariantRun(db: NodePgDatabase<typeof s>): Promise<InvariantResult[]> {
  const results = await runInvariants(db);
  const violated = results.filter((r) => r.status === "violated");
  await db.insert(s.systemEvents).values({
    level: violated.length ? "error" : "info",
    stage: "data_quality",
    event: violated.length ? "invariants_violated" : "invariants_ok",
    message: violated.length ? `${violated.length} invariant(s) violated: ${violated.map((r) => r.key).join(", ")}` : "All invariants hold",
    context: results,
  });
  return results;
}
