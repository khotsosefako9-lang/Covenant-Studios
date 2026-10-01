import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "@/lib/env";
import * as schema from "./schema/index";

// Created on first use, so importing this module (e.g. during `next build`) does not
// require DATABASE_URL to be set.
let pool: Pool | undefined;
let db: NodePgDatabase<typeof schema> | undefined;

export function getPool(): Pool {
  pool ??= new Pool({ connectionString: loadEnv().DATABASE_URL });
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  db ??= drizzle(getPool(), { schema });
  return db;
}
