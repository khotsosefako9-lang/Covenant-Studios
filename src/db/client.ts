import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "@/lib/env";
import * as schema from "./schema/index";

// Created on first use, so importing this module (e.g. during `next build`) does not
// require DATABASE_URL to be set.
let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: loadEnv().DATABASE_URL });
    // An idle client can be terminated by the server (restart, failover). pg emits that on
    // the pool; without a listener it is an uncaught exception that kills the process.
    // The client is discarded and the next query opens a fresh one.
    pool.on("error", (err) => console.error("postgres idle client error:", err.message));
  }
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  db ??= drizzle(getPool(), { schema });
  return db;
}
