// Creates a throwaway database on the local Postgres, applies the migrations and seed,
// and drops it afterwards. Requires DATABASE_URL to point at a server we can CREATE DATABASE on.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/db/schema/index";
import { seed } from "@/db/seed";

export const adminUrl = process.env.DATABASE_URL;

export async function createTestDb() {
  if (!adminUrl) throw new Error("DATABASE_URL is required for database tests");
  const name = `covenant_test_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  admin.on("error", () => {});
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  // The database is force-dropped at teardown; an idle client may hear about it first.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seed(db);
  return {
    pool,
    db,
    async drop() {
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

// Asserts a statement is rejected with the given SQLSTATE (and optionally constraint name).
export async function rejects(p: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  let err: { code?: string; constraint?: string; message?: string } | undefined;
  try {
    await p;
  } catch (e) {
    err = e as typeof err;
  }
  if (!err) throw new Error(`expected rejection with ${code}, but the statement succeeded`);
  if (err.code !== code) throw new Error(`expected ${code}, got ${err.code}: ${err.message}`);
  if (constraint && err.constraint !== constraint) {
    throw new Error(`expected constraint ${constraint}, got ${err.constraint}: ${err.message}`);
  }
}

export const PG = {
  notNull: "23502",
  foreignKey: "23503",
  unique: "23505",
  check: "23514",
} as const;
