// `npm run db:setup`: apply migrations, then the idempotent configuration seed.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv } from "../lib/env";
import * as schema from "./schema/index";
import { seed } from "./seed";

const pool = new Pool({ connectionString: loadEnv().DATABASE_URL });
pool.on("error", (err) => console.error("postgres idle client error:", err.message));
const db = drizzle(pool, { schema });
try {
  await migrate(db, { migrationsFolder: "drizzle" });
  await seed(db);
  console.log("migrations applied, configuration seeded");
} finally {
  await pool.end();
}
