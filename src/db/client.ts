import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "@/lib/env";
import * as schema from "./schema";

const pool = new Pool({ connectionString: loadEnv().DATABASE_URL });

export const db = drizzle(pool, { schema });
export { pool };
