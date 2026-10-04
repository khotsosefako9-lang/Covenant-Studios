import { PgBoss } from "pg-boss";
import { getDb } from "../db/client";
import { loadEnv } from "../lib/env";
import { recordInvariantRun } from "../quality/job";

// Worker process: same database as the app, no other infrastructure.
const boss = new PgBoss(loadEnv().DATABASE_URL);

boss.on("error", (err) => console.error("pg-boss error", err));

await boss.start();

// Nightly data-quality invariants (02:13 UTC). Results are recorded in system_events,
// not alerted on; the health page will read them.
const DATA_QUALITY = "data-quality";
await boss.createQueue(DATA_QUALITY);
await boss.schedule(DATA_QUALITY, "13 2 * * *");
await boss.work(DATA_QUALITY, async () => {
  await recordInvariantRun(getDb());
});

console.log("worker started");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
