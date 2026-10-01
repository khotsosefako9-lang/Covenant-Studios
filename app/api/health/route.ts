import { pool } from "@/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("select 1");
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
