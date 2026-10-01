import { PgBoss } from "pg-boss";
import { loadEnv } from "../lib/env";

// Worker process: same database as the app, no other infrastructure.
// Job handlers are registered here as pipeline phases are built.
const boss = new PgBoss(loadEnv().DATABASE_URL);

boss.on("error", (err) => console.error("pg-boss error", err));

await boss.start();
console.log("worker started");

const shutdown = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
